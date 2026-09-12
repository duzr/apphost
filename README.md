# Node App Host

Runs and manages multiple Node.js applications inside a single container.
Each app is its own OS process, supervised (start/stop/restart/crash-restart)
by `server.js`; incoming requests are routed to the right process by Host
header, so every app gets its own `https://<name>.apps.home` address without
needing its own Kubernetes Deployment, Service, or Ingress object.

See `deployments/nodeapps/` for the Kubernetes manifests and the main
repository README for the operator-facing runbook (building the image,
adding DNS, registering apps).

## How an app is deployed

1. Its git repo must contain an `apphost.json` file at the repo root:

   ```json
   {
     "name": "my-app",
     "start": "node index.js",
     "install": "npm ci --omit=dev"
   }
   ```

   - `name` — lowercase letters, digits, hyphens. Becomes `<name>.apps.home`. Required.
   - `start` — shell command used to run the app. Required.
   - `install` — shell command run once after clone/redeploy, before starting. Optional
     (omit it for an app with no dependencies to install).

2. The app **must** listen on `process.env.PORT` — the host assigns the port
   at deploy time and there's no way to know it in advance.

3. In the management UI (`https://apphost.home`), click **Add app** and give
   it the repo's git URL (and branch, if not the default). The host clones
   it, runs `install`, allocates a port, and starts it.

4. To ship an update, push to the app's repo and click **Redeploy** — this
   does a `git fetch` + hard reset to the latest commit, re-runs `install`,
   and restarts the process. There's no webhook; redeploys are manual by
   design (see the main README for why).

## Local development

```bash
cd apphost
npm install
DATA_DIR=./.data SSH_DIR=./.data/ssh MGMT_HOST=localhost npm start
```

Then visit `http://localhost:3000` (Host-based subdomain routing needs real
DNS or `/etc/hosts` entries to exercise locally — `curl -H "Host: foo.apps.home" http://localhost:3000`
is the easiest way to test the proxy path without that).

## Building the image

```bash
docker buildx build --platform linux/arm64 -t <your-registry>/nodeapp-host:<tag> --push apphost/
```

Then set that image in `deployments/nodeapps/apphost.yaml` and re-apply.

## Design notes

- **No Kubernetes API access.** Apps are proxied to by Host header from
  inside this one process (`src/proxy.js`), not by creating a Service/Ingress
  per app — so the pod needs zero RBAC and no cluster credentials at all.
- **No PM2.** A ~150-line supervisor (`src/supervisor.js`) covers exactly
  what's needed (spawn, graceful-then-forced stop, crash-restart with
  backoff, log capture) without a second daemon process, a control socket,
  or PM2's much larger dependency tree.
- **Everything persists to the PVC** (`/data`): cloned repos, `registry.json`
  (the list of apps and their desired start/stop state), and logs. This
  cluster's nodes get power-cycled routinely (see `scripts/shutdown.sh`/
  `scripts/startup.sh`), so the host restores every previously-running app on
  boot — that's the normal path, not a recovery edge case.
