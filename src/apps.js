'use strict';

// Ties together the registry (persisted metadata), the supervisor (running
// processes) and git (fetching/updating app code) behind the operations the
// API exposes: register, start, stop, restart, redeploy, delete, list.

const path = require('node:path');
const fsp = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const config = require('./config');
const registry = require('./registry');
const supervisor = require('./supervisor');
const git = require('./git');
const { readManifest, ManifestError } = require('./manifest');

const execFileAsync = promisify(execFile);

function toApiShape(record) {
  return {
    name: record.name,
    repoUrl: record.repoUrl,
    branch: record.branch || null,
    port: record.port,
    url: `https://${record.name}.${config.APPS_DOMAIN}`,
    enabled: record.enabled,
    createdAt: record.createdAt,
    lastDeployedAt: record.lastDeployedAt,
    commit: record.commit,
    ...supervisor.state(record.name),
  };
}

async function listApps() {
  const records = registry.list().sort((a, b) => a.name.localeCompare(b.name));
  return Promise.all(
    records.map(async (r) => ({ ...toApiShape(r), metrics: await supervisor.metrics(r.name) })),
  );
}

function getOrThrow(name) {
  const record = registry.get(name);
  if (!record) throw new ManifestError(`No app named "${name}".`);
  return record;
}

async function runInstall(appDir, installCmd) {
  if (!installCmd) return;
  await execFileAsync('/bin/sh', ['-c', installCmd], {
    cwd: appDir,
    env: { ...process.env, HOME: config.DATA_DIR, NPM_CONFIG_CACHE: config.NPM_CACHE_DIR },
    timeout: config.INSTALL_TIMEOUT_MS,
  });
}

async function registerApp({ repoUrl, branch }) {
  if (typeof repoUrl !== 'string' || !repoUrl.trim()) {
    throw new ManifestError('repoUrl is required.');
  }

  const stagingDir = path.join(config.STAGING_DIR, `clone-${Date.now()}`);
  await fsp.mkdir(config.STAGING_DIR, { recursive: true });
  try {
    await git.clone(repoUrl.trim(), stagingDir, branch || undefined);
  } catch (err) {
    throw new ManifestError(`git clone failed: ${err.message}`);
  }

  let manifest;
  try {
    manifest = await readManifest(stagingDir);
  } catch (err) {
    await fsp.rm(stagingDir, { recursive: true, force: true });
    throw err;
  }

  if (registry.get(manifest.name)) {
    await fsp.rm(stagingDir, { recursive: true, force: true });
    throw new ManifestError(`An app named "${manifest.name}" is already registered.`);
  }

  const appDir = path.join(config.APPS_DIR, manifest.name);
  await fsp.mkdir(config.APPS_DIR, { recursive: true });
  await fsp.rename(stagingDir, appDir);

  try {
    await runInstall(appDir, manifest.install);
  } catch (err) {
    await fsp.rm(appDir, { recursive: true, force: true });
    throw new ManifestError(`Install command failed: ${err.message}`);
  }

  const record = {
    name: manifest.name,
    repoUrl: repoUrl.trim(),
    branch: branch || null,
    cwd: appDir,
    start: manifest.start,
    install: manifest.install,
    port: registry.allocatePort(),
    enabled: true,
    createdAt: new Date().toISOString(),
    lastDeployedAt: new Date().toISOString(),
    commit: await git.currentCommit(appDir),
  };
  await registry.upsert(record);
  await supervisor.start(record);
  return toApiShape(record);
}

async function redeployApp(name) {
  const record = getOrThrow(name);
  await supervisor.stop(name);
  let commit;
  try {
    commit = await git.pull(record.cwd);
  } catch (err) {
    throw new ManifestError(`git pull failed: ${err.message}`);
  }
  const manifest = await readManifest(record.cwd);
  if (manifest.name !== name) {
    throw new ManifestError('apphost.json "name" must not change after an app is registered.');
  }
  try {
    await runInstall(record.cwd, manifest.install);
  } catch (err) {
    throw new ManifestError(`Install command failed: ${err.message}`);
  }

  const updated = {
    ...record,
    start: manifest.start,
    install: manifest.install,
    commit,
    lastDeployedAt: new Date().toISOString(),
  };
  await registry.upsert(updated);
  if (updated.enabled) await supervisor.start(updated);
  return toApiShape(updated);
}

async function startApp(name) {
  const record = getOrThrow(name);
  const updated = { ...record, enabled: true };
  await registry.upsert(updated);
  await supervisor.start(updated);
  return toApiShape(updated);
}

async function stopApp(name) {
  const record = getOrThrow(name);
  const updated = { ...record, enabled: false };
  await registry.upsert(updated);
  await supervisor.stop(name);
  return toApiShape(updated);
}

async function restartApp(name) {
  const record = getOrThrow(name);
  await supervisor.restart(record);
  return toApiShape(record);
}

async function deleteApp(name, { purge }) {
  const record = getOrThrow(name);
  await supervisor.stop(name);
  supervisor.remove(name);
  await registry.remove(name);
  if (purge) await fsp.rm(record.cwd, { recursive: true, force: true });
}

/** Called once at boot to bring back apps that were running before the pod restarted. */
async function restoreOnBoot() {
  await Promise.all(
    registry
      .list()
      .filter((record) => record.enabled)
      .map((record) => supervisor.start(record).catch((err) => {
        // eslint-disable-next-line no-console
        console.error(`Failed to restore app "${record.name}":`, err.message);
      })),
  );
}

module.exports = {
  listApps,
  registerApp,
  redeployApp,
  startApp,
  stopApp,
  restartApp,
  deleteApp,
  restoreOnBoot,
};
