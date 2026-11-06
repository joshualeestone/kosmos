'use strict';
/**
 * kosmos#1765: the board's routes for "this board runs from a folder other people on this PC may be able to change".
 * A real board in a sandbox, as server.storecheck-7248 does. From a source checkout there is no bundle root, so the
 * board asks nothing and the route answers no notice on every computer; the asking itself is
 * engine/win32runfolder.test.js, the launcher's answer tools.win-inplace-acl-1765.test.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const store = require('./engine/store');
const { stopBoard } = require('./test-support/board-child');

const REPO = __dirname;

test('#1765: GET /api/board/run-folder answers no notice from a source checkout, and dismiss answers', async () => {
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-runfolder-1765-'));
  fs.mkdirSync(path.join(sb, 'data', store.APP, 'profiles'), { recursive: true });
  fs.mkdirSync(path.join(sb, 'workers'), { recursive: true });
  fs.writeFileSync(path.join(sb, 'panes.txt'), '');
  const child = spawn(process.execPath, [path.join(REPO, 'server.js')], {
    env: {
      ...process.env,
      PORT: '0',
      AGENT_WORKFORCE_DATA: path.join(sb, 'data'),
      AGENT_WORKFORCE_WORKERS: path.join(sb, 'workers'),
      AGENT_WORKFORCE_LAUNCH: path.join(sb, 'launch'),
      AGENT_WORKFORCE_PROJECTS: path.join(sb, 'projects'),
      AGENT_WORKFORCE_TMUX_BIN: path.join(REPO, 'test-support', 'fake-tmux.sh'),
      AGENT_WORKFORCE_FAKE_PANES: path.join(sb, 'panes.txt'),
      AGENT_WORKFORCE_DRY_RUN: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  try {
    const url = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('the board did not start in 60 s:\n' + out + '\n' + err)), 60000);
      const look = () => {
        const m = /Kosmos on (http:\/\/[^\s]+)/.exec(out);
        if (m) { clearTimeout(t); resolve(m[1].replace(/\/$/, '')); }
      };
      child.stdout.on('data', look);
      child.on('exit', () => { clearTimeout(t); reject(new Error('the board exited before it started:\n' + out + '\n' + err)); });
    });
    const got = await fetch(url + '/api/board/run-folder');
    assert.equal(got.status, 200);
    assert.deepEqual(await got.json(), { notice: null });
    const dis = await fetch(url + '/api/board/run-folder/dismiss', { method: 'POST' });
    assert.equal(dis.status, 200);
    assert.deepEqual(await dis.json(), { dismissed: true });
    assert.doesNotMatch(out + err, /could not check its own folder at start/, 'the start hook failed: ' + err);
  } finally {
    await stopBoard(child);
    try { fs.rmSync(sb, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});
