'use strict';

const path = require('node:path');

const DATA_DIR = process.env.DATA_DIR || '/data';

module.exports = {
  DATA_DIR,
  APPS_DIR: path.join(DATA_DIR, 'apps'),
  STAGING_DIR: path.join(DATA_DIR, 'staging'),
  REGISTRY_FILE: path.join(DATA_DIR, 'registry.json'),
  LOG_DIR: path.join(DATA_DIR, 'logs'),
  NPM_CACHE_DIR: path.join(DATA_DIR, 'npm-cache'),
  SSH_DIR: process.env.SSH_DIR || '/keys',

  MGMT_HOST: process.env.MGMT_HOST || 'apphost.home',
  APPS_DOMAIN: process.env.APPS_DOMAIN || 'apps.home',
  MGMT_PORT: Number(process.env.PORT) || 3000,

  APP_PORT_RANGE_START: Number(process.env.APP_PORT_RANGE_START) || 4000,
  APP_PORT_RANGE_END: Number(process.env.APP_PORT_RANGE_END) || 4999,

  // Subdomain labels must be valid single DNS labels — this both keeps the
  // resulting <name>.apps.home hostname well-formed and blocks path/host
  // header injection tricks in registration input.
  NAME_PATTERN: /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/,
  RESERVED_NAMES: new Set(['apphost', 'www', 'api']),

  STOP_GRACE_MS: Number(process.env.STOP_GRACE_MS) || 10_000,
  LOG_MAX_BYTES: Number(process.env.LOG_MAX_BYTES) || 5 * 1024 * 1024,
  INSTALL_TIMEOUT_MS: Number(process.env.INSTALL_TIMEOUT_MS) || 10 * 60 * 1000,
};
