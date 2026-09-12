'use strict';

const express = require('express');
const registry = require('./registry');
const supervisor = require('./supervisor');
const apps = require('./apps');
const logs = require('./logs');
const { ManifestError } = require('./manifest');

const router = express.Router();
router.use(express.json());

function handleError(res, err) {
  if (err instanceof ManifestError) {
    return res.status(400).json({ error: err.message });
  }
  // eslint-disable-next-line no-console
  console.error(err);
  return res.status(500).json({ error: 'Internal error' });
}

router.get('/health', (_req, res) => res.json({ status: 'ok' }));

router.get('/apps', async (_req, res) => {
  try {
    res.json(await apps.listApps());
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/apps', async (req, res) => {
  try {
    res.status(201).json(await apps.registerApp(req.body || {}));
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/apps/:name/start', async (req, res) => {
  try {
    res.json(await apps.startApp(req.params.name));
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/apps/:name/stop', async (req, res) => {
  try {
    res.json(await apps.stopApp(req.params.name));
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/apps/:name/restart', async (req, res) => {
  try {
    res.json(await apps.restartApp(req.params.name));
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/apps/:name/redeploy', async (req, res) => {
  try {
    res.json(await apps.redeployApp(req.params.name));
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/apps/:name', async (req, res) => {
  try {
    await apps.deleteApp(req.params.name, { purge: req.query.purge === 'true' });
    res.status(204).end();
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/apps/:name/logs', async (req, res) => {
  if (!registry.get(req.params.name)) return res.status(404).json({ error: 'Not found' });
  try {
    res.json(await logs.tail(req.params.name, Number(req.query.lines) || 200));
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/apps/:name/logs/stream', (req, res) => {
  if (!registry.get(req.params.name)) return res.status(404).end();
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const { out } = supervisor.logPaths(req.params.name);
  logs.streamFile(out, res);
});

module.exports = router;
