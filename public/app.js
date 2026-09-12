'use strict';

const POLL_INTERVAL_MS = 3000;

const appsBody = document.getElementById('apps-body');
const appsTable = document.getElementById('apps-table');
const emptyState = document.getElementById('empty-state');

const addAppDialog = document.getElementById('add-app-dialog');
const addAppForm = document.getElementById('add-app-form');
const addAppError = document.getElementById('add-app-error');

const logsDialog = document.getElementById('logs-dialog');
const logsTitle = document.getElementById('logs-title');
const logsContent = document.getElementById('logs-content');
let logsSource = null;

document.getElementById('add-app-btn').addEventListener('click', () => {
  addAppError.hidden = true;
  addAppForm.reset();
  addAppDialog.showModal();
});
document.getElementById('add-app-cancel').addEventListener('click', () => addAppDialog.close());
document.getElementById('logs-close').addEventListener('click', closeLogs);

function closeLogs() {
  if (logsSource) {
    logsSource.close();
    logsSource = null;
  }
  logsDialog.close();
}

async function api(path, options) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}

function formatBytes(bytes) {
  if (bytes == null) return '—';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}

function formatCpu(cpu) {
  return cpu == null ? '—' : `${cpu.toFixed(1)}%`;
}

function formatUptime(startedAt) {
  if (!startedAt) return '—';
  const seconds = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

function renderRow(app) {
  const tr = document.createElement('tr');

  const nameTd = document.createElement('td');
  nameTd.className = 'app-name';
  nameTd.innerHTML = `<a href="${app.url}" target="_blank" rel="noopener">${app.name}</a>
    <small>${formatUptime(app.startedAt)} uptime · ${app.commit ? app.commit.slice(0, 7) : 'no commit'}</small>`;
  tr.appendChild(nameTd);

  const statusTd = document.createElement('td');
  statusTd.innerHTML = `<span class="badge ${app.status}">${app.status}</span>`;
  tr.appendChild(statusTd);

  const cpuTd = document.createElement('td');
  cpuTd.textContent = formatCpu(app.metrics && app.metrics.cpu);
  tr.appendChild(cpuTd);

  const memTd = document.createElement('td');
  memTd.textContent = formatBytes(app.metrics && app.metrics.memory);
  tr.appendChild(memTd);

  const restartsTd = document.createElement('td');
  restartsTd.textContent = app.restarts;
  tr.appendChild(restartsTd);

  const commitTd = document.createElement('td');
  commitTd.textContent = app.commit ? app.commit.slice(0, 7) : '—';
  tr.appendChild(commitTd);

  const actionsTd = document.createElement('td');
  actionsTd.className = 'actions';
  actionsTd.appendChild(actionButton('Start', () => api(`/apps/${app.name}/start`, { method: 'POST' })));
  actionsTd.appendChild(actionButton('Stop', () => api(`/apps/${app.name}/stop`, { method: 'POST' })));
  actionsTd.appendChild(actionButton('Restart', () => api(`/apps/${app.name}/restart`, { method: 'POST' })));
  actionsTd.appendChild(actionButton('Redeploy', () => api(`/apps/${app.name}/redeploy`, { method: 'POST' })));
  actionsTd.appendChild(actionButton('Logs', () => openLogs(app.name), false));
  actionsTd.appendChild(
    actionButton(
      'Delete',
      () => {
        if (!confirm(`Delete "${app.name}"? This stops it and removes it from the host.`)) return Promise.resolve();
        return api(`/apps/${app.name}?purge=true`, { method: 'DELETE' });
      },
      true,
      'danger',
    ),
  );
  tr.appendChild(actionsTd);

  return tr;
}

function actionButton(label, handler, refresh = true, extraClass = '') {
  const btn = document.createElement('button');
  btn.textContent = label;
  if (extraClass) btn.className = extraClass;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      await handler();
      if (refresh) await loadApps();
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
    }
  });
  return btn;
}

async function openLogs(name) {
  logsTitle.textContent = `${name} — logs`;
  logsContent.textContent = 'Loading…';
  logsDialog.showModal();
  try {
    const { stdout, stderr } = await api(`/apps/${name}/logs?lines=200`);
    logsContent.textContent = [stdout, stderr].filter(Boolean).join('\n--- stderr ---\n') || '(no output yet)';
    logsContent.scrollTop = logsContent.scrollHeight;
  } catch (err) {
    logsContent.textContent = `Failed to load logs: ${err.message}`;
    return;
  }
  logsSource = new EventSource(`/api/apps/${name}/logs/stream`);
  logsSource.onmessage = (event) => {
    logsContent.textContent += JSON.parse(event.data);
    logsContent.scrollTop = logsContent.scrollHeight;
  };
}

async function loadApps() {
  const apps = await api('/apps');
  appsTable.hidden = apps.length === 0;
  emptyState.hidden = apps.length !== 0;
  appsBody.innerHTML = '';
  for (const app of apps) appsBody.appendChild(renderRow(app));
}

addAppForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  addAppError.hidden = true;
  const formData = new FormData(addAppForm);
  const repoUrl = formData.get('repoUrl').trim();
  const branch = formData.get('branch').trim();
  try {
    await api('/apps', { method: 'POST', body: JSON.stringify({ repoUrl, branch: branch || undefined }) });
    addAppDialog.close();
    await loadApps();
  } catch (err) {
    addAppError.textContent = err.message;
    addAppError.hidden = false;
  }
});

loadApps().catch((err) => {
  emptyState.hidden = false;
  emptyState.textContent = `Failed to load apps: ${err.message}`;
});
setInterval(() => loadApps().catch(() => {}), POLL_INTERVAL_MS);
