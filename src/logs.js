'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const supervisor = require('./supervisor');

async function tailFile(filePath, lines) {
  try {
    const data = await fsp.readFile(filePath, 'utf8');
    return data.split('\n').slice(-lines).join('\n');
  } catch {
    return '';
  }
}

async function tail(name, lines = 200) {
  const { out, err } = supervisor.logPaths(name);
  const [stdout, stderr] = await Promise.all([tailFile(out, lines), tailFile(err, lines)]);
  return { stdout, stderr };
}

/** Streams newly-appended bytes of `filePath` to an SSE response until the client disconnects. */
function streamFile(filePath, res) {
  let offset = 0;
  try {
    offset = fs.statSync(filePath).size;
  } catch {
    /* file doesn't exist yet — start from 0 */
  }

  const interval = setInterval(() => {
    fs.stat(filePath, (statErr, st) => {
      if (statErr) return;
      if (st.size < offset) {
        offset = 0; // file was truncated by the size-cap in supervisor.js
      }
      if (st.size <= offset) return;
      const stream = fs.createReadStream(filePath, { start: offset, end: st.size - 1 });
      let chunks = '';
      stream.on('data', (chunk) => {
        chunks += chunk.toString('utf8');
      });
      stream.on('end', () => {
        if (chunks) res.write(`data: ${JSON.stringify(chunks)}\n\n`);
      });
      offset = st.size;
    });
  }, 1000);

  res.on('close', () => clearInterval(interval));
}

module.exports = { tail, streamFile };
