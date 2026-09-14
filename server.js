'use strict';

const http = require('node:http');
const path = require('node:path');
const express = require('express');
const config = require('./src/config');
const routes = require('./src/routes');
const proxy = require('./src/proxy');
const apps = require('./src/apps');

const app = express();

// Anything that isn't the management host itself and matches a registered
// app's subdomain gets proxied straight through, before it ever reaches the
// management API or static UI.
app.use((req, res, next) => {
  const hostname = proxy.hostOf(req);
  if (hostname !== config.MGMT_HOST && proxy.isAppHost(hostname)) {
    return proxy.proxyRequest(req, res);
  }
  return next();
});

app.use('/api', routes);
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);

server.on('upgrade', (req, socket, head) => {
  const hostname = proxy.hostOf(req);
  if (hostname !== config.MGMT_HOST && proxy.isAppHost(hostname)) {
    proxy.proxyUpgrade(req, socket, head);
  } else {
    socket.destroy();
  }
});

async function main() {
  await apps.restoreOnBoot();
  server.listen(config.MGMT_PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`apphost listening on :${config.MGMT_PORT}`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', err);
  process.exit(1);
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
