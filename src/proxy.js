'use strict';

// The only "router" between apps.home subdomains and running processes:
// Traefik forwards every *.apps.home request to this one container on one
// port, and this module dispatches it to 127.0.0.1:<app port> by Host
// header. Apps never get their own Kubernetes Service — this is what makes
// the whole platform work without any Kubernetes API access.

const httpProxy = require('http-proxy');
const config = require('./config');
const registry = require('./registry');

const proxy = httpProxy.createProxyServer({ ws: true, xfwd: true });

proxy.on('error', (_err, _req, res) => {
  if (res && typeof res.writeHead === 'function' && !res.headersSent) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
  }
  if (res && typeof res.end === 'function') res.end('Bad gateway: app is not running.');
});

function appNameForHost(hostname) {
  const suffix = `.${config.APPS_DOMAIN}`;
  if (!hostname || !hostname.endsWith(suffix)) return null;
  return hostname.slice(0, -suffix.length);
}

function targetFor(hostname) {
  const name = appNameForHost(hostname);
  if (!name) return null;
  const record = registry.get(name);
  if (!record) return null;
  return `http://127.0.0.1:${record.port}`;
}

function isAppHost(hostname) {
  return Boolean(appNameForHost(hostname));
}

function hostOf(req) {
  return (req.headers.host || '').split(':')[0].toLowerCase();
}

function proxyRequest(req, res) {
  const target = targetFor(hostOf(req));
  if (!target) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Unknown app.');
    return;
  }
  proxy.web(req, res, { target });
}

function proxyUpgrade(req, socket, head) {
  const target = targetFor(hostOf(req));
  if (!target) {
    socket.destroy();
    return;
  }
  proxy.ws(req, socket, head, { target });
}

module.exports = { isAppHost, proxyRequest, proxyUpgrade, hostOf };
