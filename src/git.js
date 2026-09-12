'use strict';

const path = require('node:path');
const simpleGit = require('simple-git');
const config = require('./config');

function sshCommand() {
  const keyPath = path.join(config.SSH_DIR, 'id_ed25519');
  const knownHosts = path.join(config.SSH_DIR, 'known_hosts');
  // StrictHostKeyChecking stays on: known_hosts is provisioned up front by
  // setup.sh, so an unexpected host key here means something worth stopping for.
  return `ssh -i ${keyPath} -o UserKnownHostsFile=${knownHosts} -o StrictHostKeyChecking=yes`;
}

function gitEnv() {
  // HOME must point somewhere writable: the container filesystem is
  // read-only outside /data (see apphost.yaml's readOnlyRootFilesystem), and
  // git/ssh may try to write cache/state under $HOME.
  return {
    ...process.env,
    HOME: config.DATA_DIR,
    GIT_SSH_COMMAND: sshCommand(),
    GIT_TERMINAL_PROMPT: '0',
  };
}

async function clone(repoUrl, destDir, branch) {
  const git = simpleGit().env(gitEnv());
  const args = branch ? ['--branch', branch, '--single-branch', '--depth', '1'] : ['--depth', '1'];
  await git.clone(repoUrl, destDir, args);
}

async function pull(cwd) {
  const git = simpleGit(cwd).env(gitEnv());
  await git.fetch(['--depth', '1']);
  await git.reset(['--hard', 'FETCH_HEAD']);
  return currentCommit(cwd);
}

async function currentCommit(cwd) {
  const git = simpleGit(cwd);
  const log = await git.log({ maxCount: 1 });
  return log.latest ? log.latest.hash : null;
}

module.exports = { clone, pull, currentCommit };
