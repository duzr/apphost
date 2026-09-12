'use strict';

// A minimal process supervisor: spawn, stop (graceful then forced), restart,
// crash-restart with backoff, and basic status/metrics. Each managed app
// runs as its own process group (spawned with detached: true) so stopping it
// also reaps any children it forks itself (e.g. `npm start` -> node) instead
// of leaving orphans behind — killing just the direct child would not do that.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const pidusage = require('pidusage');
const config = require('./config');

// name -> runtime record (not persisted — rebuilt from the registry on boot)
const runtime = new Map();

function logPaths(name) {
  const dir = path.join(config.LOG_DIR, name);
  return { dir, out: path.join(dir, 'out.log'), err: path.join(dir, 'err.log') };
}

function state(name) {
  const r = runtime.get(name);
  if (!r) return { status: 'stopped', pid: null, startedAt: null, restarts: 0, lastExitCode: null, lastError: null };
  return {
    status: r.status,
    pid: r.pid,
    startedAt: r.startedAt,
    restarts: r.restarts,
    lastExitCode: r.lastExitCode,
    lastError: r.lastError,
  };
}

async function metrics(name) {
  const r = runtime.get(name);
  if (!r || r.status !== 'running' || !r.pid) return null;
  try {
    const stats = await pidusage(r.pid);
    return { cpu: stats.cpu, memory: stats.memory };
  } catch {
    // Process exited between the status check and the stat lookup — not an error.
    return null;
  }
}

function appendLog(filePath, chunk) {
  fs.appendFile(filePath, chunk, () => {});
  fs.stat(filePath, (err, st) => {
    if (err || st.size <= config.LOG_MAX_BYTES) return;
    fs.readFile(filePath, (readErr, data) => {
      if (readErr) return;
      fs.writeFile(filePath, data.subarray(data.length - config.LOG_MAX_BYTES), () => {});
    });
  });
}

function clearRestartTimer(r) {
  if (r && r.restartTimer) {
    clearTimeout(r.restartTimer);
    r.restartTimer = null;
  }
}

async function start(app) {
  const existing = runtime.get(app.name);
  if (existing && existing.status === 'running') return state(app.name);
  clearRestartTimer(existing);

  const { dir, out, err } = logPaths(app.name);
  await fsp.mkdir(dir, { recursive: true });

  const env = {
    ...process.env,
    PORT: String(app.port),
    HOME: config.DATA_DIR,
    NPM_CONFIG_CACHE: config.NPM_CACHE_DIR,
  };

  const child = spawn('/bin/sh', ['-c', app.start], {
    cwd: app.cwd,
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const record = {
    child,
    status: 'running',
    pid: child.pid,
    startedAt: new Date().toISOString(),
    restarts: existing ? existing.restarts : 0,
    lastExitCode: null,
    lastError: null,
    stopping: false,
    restartTimer: null,
  };
  runtime.set(app.name, record);

  child.stdout.on('data', (d) => appendLog(out, d));
  child.stderr.on('data', (d) => appendLog(err, d));

  child.on('exit', (code) => {
    record.pid = null;
    record.lastExitCode = code;
    if (record.stopping) {
      record.status = 'stopped';
      return;
    }
    record.status = 'crashed';
    if (code !== 0) {
      record.restarts += 1;
      const delaySeconds = Math.min(30, 2 ** Math.min(record.restarts, 5));
      record.restartTimer = setTimeout(() => {
        start(app).catch((e) => {
          record.status = 'crashed';
          record.lastError = e.message;
        });
      }, delaySeconds * 1000);
    }
  });

  child.on('error', (e) => {
    record.status = 'crashed';
    record.lastError = e.message;
  });

  return state(app.name);
}

function stop(name) {
  return new Promise((resolve) => {
    const r = runtime.get(name);
    clearRestartTimer(r);
    if (!r || r.status !== 'running' || !r.pid) {
      if (r) r.status = 'stopped';
      return resolve(state(name));
    }
    r.stopping = true;
    const pid = r.pid;
    const forceKillTimer = setTimeout(() => {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }, config.STOP_GRACE_MS);
    r.child.once('exit', () => {
      clearTimeout(forceKillTimer);
      resolve(state(name));
    });
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      clearTimeout(forceKillTimer);
      resolve(state(name));
    }
  });
}

async function restart(app) {
  await stop(app.name);
  return start(app);
}

function remove(name) {
  runtime.delete(name);
}

module.exports = { start, stop, restart, state, metrics, remove, logPaths };
