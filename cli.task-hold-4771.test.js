'use strict';
/**
 * #4771: the Mac CLI's `kosmos task hold|unhold` and the "[on hold]" marker in `kosmos task list`, driven against a
 * fake board (the Windows twin is tools.windows-kosmos-cli-570.test.js). The harness is cli.task-2662.test.js's.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFile } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');
// A sandboxed KOSMOS_HOME whose runtime/bin/node is this node, as cli.agent-create-3734.test.js does: the list's
// formatter runs on the CLI's own runtime, and without one the CLI prints the raw answer.
const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-hold-')));
fs.mkdirSync(path.join(HOME, 'runtime', 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(HOME, 'runtime', 'bin', 'node'));
test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));

function runCli(args, env) {
  return new Promise((resolve, reject) => {
    execFile(CLI, args, { env, timeout: 20000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code (' + (err.signal || err.code) + '). ' + (stderr || ''))); return; }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

/* A board that records each hold write and answers from `answer` (status, body), and serves a task list. */
function board(answer) {
  const writes = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const hold = /^\/api\/project\/([^/]+)\/task\/(\d+)\/hold$/.exec(req.url);
      if (req.method === 'POST' && hold) {
        writes.push({ project: hold[1], n: hold[2], body: JSON.parse(raw || 'null') });
        const [status, body] = answer(writes[writes.length - 1]);
        res.writeHead(status, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(body));
      }
      if (req.method === 'GET' && req.url.startsWith('/api/tasks')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ project: 'p1', tasks: [
          { number: 1, sentence: 'held itself', onHold: true },
          { number: 2, sentence: 'in a paused project', projectPaused: true },
          { number: 3, sentence: 'real work' },
          { number: 4, sentence: 'finished while held', onHold: true, isClosed: true },
        ] }));
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<title>Kosmos</title>Agent Workforce');
    });
  });
  return { server, writes };
}

async function withBoard(answer, fn) {
  const b = board(answer);
  await new Promise((r) => b.server.listen(0, '127.0.0.1', r));
  const env = { ...process.env, KOSMOS_HOME: HOME, KOSMOS_PORT: String(b.server.address().port), TMUX_PANE: '%42', KOSMOS_NO_LEGACY_MIGRATION: '1' };
  try { return await fn(env, b.writes); } finally { await new Promise((r) => b.server.close(r)); }
}

test('#4771 Mac CLI: task hold / unhold POST {onHold} to the task\'s hold route and say what happened', async () => {
  await withBoard((w) => [200, { task: { number: Number(w.n), ...(w.body.onHold ? { onHold: true } : {}) } }], async (env, writes) => {
    const on = await runCli(['task', 'hold', 'p1', '3'], env);
    assert.equal(on.code, 0, on.stdout + on.stderr);
    assert.match(on.stdout, /Put task 3 on p1 on hold/);
    const off = await runCli(['task', 'unhold', 'p1', '3'], env);
    assert.equal(off.code, 0, off.stdout + off.stderr);
    assert.match(off.stdout, /Took task 3 on p1 off hold/);
    assert.deepEqual(writes.map((x) => [x.project, x.n, x.body]), [['p1', '3', { onHold: true }], ['p1', '3', { onHold: false }]]);
  });
});

test('#4771 Mac CLI: a refused unhold says the board\'s reason and exits non-zero; a non-number is sent nowhere', async () => {
  await withBoard(() => [403, { error: 'the person put this task on hold, so only they can take it off, on the screen' }], async (env, writes) => {
    const r = await runCli(['task', 'unhold', 'p1', '3'], env);
    assert.notEqual(r.code, 0, 'a refusal exited 0');
    assert.match(r.stdout, /could not change that task: the person put this task on hold, so only they can take it off, on the screen/);
    const bad = await runCli(['task', 'hold', 'p1', 'two'], env);
    assert.notEqual(bad.code, 0);
    assert.equal(writes.length, 1, 'a non-number task was sent to the board');
  });
});

test('#4771 Mac CLI: task list marks held work "[on hold]"; a plain task is the control', async () => {
  await withBoard(() => [500, {}], async (env) => {
    const r = await runCli(['task', 'list', 'p1'], env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const lines = r.stdout.split('\n');
    assert.ok(lines.includes('[1] [on hold] held itself'), r.stdout);
    assert.ok(lines.includes('[2] [on hold] in a paused project'), r.stdout);
    assert.ok(lines.includes('[3] real work'), 'control: a task not held is marked: ' + r.stdout);
    assert.ok(lines.includes('[4] [done] finished while held'), r.stdout);
  });
});
