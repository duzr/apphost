'use strict';

// Persists the list of registered apps (name, repo, port, start command,
// desired enabled/disabled state) to a JSON file on the PVC. This is the
// source of truth used to recreate running processes after a pod restart —
// this cluster's nodes get power-cycled routinely, so surviving a restart
// isn't an edge case here, it's the normal case.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const config = require('./config');

let apps = new Map();
let loaded = false;

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  if (!fs.existsSync(config.REGISTRY_FILE)) return;
  const raw = fs.readFileSync(config.REGISTRY_FILE, 'utf8');
  const list = raw.trim() ? JSON.parse(raw) : [];
  for (const record of list) apps.set(record.name, record);
}

async function persist() {
  await fsp.mkdir(path.dirname(config.REGISTRY_FILE), { recursive: true });
  const tmpFile = `${config.REGISTRY_FILE}.tmp`;
  await fsp.writeFile(tmpFile, JSON.stringify(Array.from(apps.values()), null, 2));
  // Atomic rename so a power loss mid-write can't corrupt the registry.
  await fsp.rename(tmpFile, config.REGISTRY_FILE);
}

function list() {
  ensureLoaded();
  return Array.from(apps.values());
}

function get(name) {
  ensureLoaded();
  return apps.get(name);
}

async function upsert(record) {
  ensureLoaded();
  apps.set(record.name, record);
  await persist();
}

async function remove(name) {
  ensureLoaded();
  apps.delete(name);
  await persist();
}

function allocatePort() {
  ensureLoaded();
  const used = new Set(Array.from(apps.values(), (a) => a.port));
  for (let p = config.APP_PORT_RANGE_START; p <= config.APP_PORT_RANGE_END; p += 1) {
    if (!used.has(p)) return p;
  }
  throw new Error('No free ports left in APP_PORT_RANGE — raise APP_PORT_RANGE_END.');
}

module.exports = { list, get, upsert, remove, allocatePort };
