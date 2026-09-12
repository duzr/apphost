'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const config = require('./config');

class ManifestError extends Error {}

/**
 * Reads and validates the apphost.json manifest an app repo must carry at
 * its root. Kept intentionally tiny (three fields) rather than pulling in a
 * schema-validation library for a shape this small.
 */
async function readManifest(appDir) {
  const manifestPath = path.join(appDir, 'apphost.json');
  let raw;
  try {
    raw = await fs.readFile(manifestPath, 'utf8');
  } catch {
    throw new ManifestError('Repository is missing an apphost.json file at its root.');
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new ManifestError('apphost.json is not valid JSON.');
  }

  const { name, start, install } = data;

  if (typeof name !== 'string' || !config.NAME_PATTERN.test(name)) {
    throw new ManifestError(
      'apphost.json "name" must be lowercase alphanumeric characters and hyphens ' +
        '(e.g. "my-app") — it becomes <name>.apps.home.',
    );
  }
  if (config.RESERVED_NAMES.has(name)) {
    throw new ManifestError(`"${name}" is a reserved name and can't be used.`);
  }
  if (typeof start !== 'string' || !start.trim()) {
    throw new ManifestError('apphost.json "start" must be a non-empty shell command.');
  }
  if (install !== undefined && (typeof install !== 'string' || !install.trim())) {
    throw new ManifestError('apphost.json "install", if present, must be a non-empty shell command.');
  }

  return { name, start: start.trim(), install: install ? install.trim() : null };
}

module.exports = { readManifest, ManifestError };
