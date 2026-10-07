'use strict';
/**
 * kosmos#4787 slice 3: `kosmos task repeat <project> <n> --reviewer <agent|none>` names who is told when a run is missed,
 * with or without a frequency. The Mac CLI against a stub board that records every request, and the Windows CLI through
 * its own main() with an injected fetch (the board's half is server.task-repeat-4787.test.js).
 *
 *   node --test cli.task-reviewer-4787.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFile } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');
/* #4796: a fresh data root, so the live board's token never travels to this test's stub board. */
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-task-reviewer-'));
test.after(() => fs.rmSync(DATA, { recursive: true, force: true }));
const AGENT = 'cd'.repeat(16);

function runCli(args, env) {
  return new Promise((resolve, reject) => {
    execFile(CLI, args, { env, timeout: 20000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code (' + (err.signal || err.code) + '). ' + (stderr || ''))); return; }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

async function withBoard(answer, fn) {
  const hits = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (!req.url.startsWith('/api/')) { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<title>Kosmos</title>Agent Workforce'); return; }
      /* The CLI's health probe asks /api/health first (install/kosmos, the probe near line 289); it is the board being
         looked for, not the action under test, so it answers as a board does and is not counted. */
      if (req.url === '/api/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ app: 'kosmos' })); return; }
      hits.push({ method: req.method, url: req.url, body: raw, agentToken: req.headers['x-kosmos-agent-token'] || null });
      const [status, body] = answer(req);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const env = { ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(server.address().port), TMUX_PANE: '%42', KOSMOS_AGENT_TOKEN: AGENT };
  try { return await fn(env, hits); } finally { await new Promise((r) => server.close(r)); }
}

const win = require('./tools/windows/kosmos-cli');
const realHook = require('./engine/kosmos-report-hook');
async function runWin(argv, answer) {
  const calls = []; const out = []; const err = [];
  const code = await win.main(argv, {
    env: { KOSMOS_AGENT_TOKEN: AGENT },
    hook: { resolveUrl: () => 'http://127.0.0.1:1', readBoardToken: () => 'B4787', agentToken: realHook.agentToken },
    out: (s) => out.push(s), err: (s) => err.push(s),
    fetch: async (url, init) => { calls.push({ route: url.replace('http://127.0.0.1:1', ''), body: init.body }); const a = answer(); return { status: a.status || 200, text: async () => a.body }; },
  });
  return { code, calls, out: out.join('\n'), err: err.join('\n') };
}
const OK = { task: { number: 3, repeat: { every: 'day', at: '09:00' } }, words: 'every day at 9am' };

test('#4787 slice 3 Mac CLI: --reviewer alone sends only the reviewer, never an empty frequency, and says who is told', () =>
  withBoard(() => [200, OK], async (env, hits) => {
    let r = await runCli(['task', 'repeat', 'p1', '3', '--reviewer', 'ada'], env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /ada will be told when task 3 on p1 misses a run\./);
    const sent = JSON.parse(hits[0].body);
    assert.equal(sent.reviewer, 'ada');
    assert.equal('every' in sent, false, 'no frequency given: the rule is left as it is');
    assert.equal(hits[0].url, '/api/project/p1/task/3/repeat');
    r = await runCli(['task', 'repeat', 'p1', '3', '--reviewer', 'none'], env);
    assert.match(r.stdout, /Nobody is told now when task 3 on p1 misses a run\./);
    // With a frequency, both go in one request, and the line is the rule's.
    r = await runCli(['task', 'repeat', 'p1', '3', 'daily', '--at', '09:00', '--reviewer', 'ada'], env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.deepEqual(JSON.parse(hits[2].body).every, 'daily');
    assert.equal(JSON.parse(hits[2].body).reviewer, 'ada');
    assert.match(r.stdout, /now repeats every day at 9am/);
  }));

test('#4787 slice 3 Mac CLI: --reviewer with no value is refused before the board', () =>
  withBoard(() => [200, OK], async (env, hits) => {
    const r = await runCli(['task', 'repeat', 'p1', '3', '--reviewer'], env);
    assert.equal(r.code, 2, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /--reviewer each need a value/);
    assert.equal(hits.length, 0);
  }));

test('#4787 slice 3 Windows: the same words, the same request', async () => {
  let r = await runWin(['task', 'repeat', 'p1', '3', '--reviewer', 'ada'], () => ({ body: JSON.stringify(OK) }));
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /ada will be told when task 3 on p1 misses a run\./);
  const sent = JSON.parse(r.calls[0].body);
  assert.equal(sent.reviewer, 'ada');
  assert.equal('every' in sent, false);
  r = await runWin(['task', 'repeat', 'p1', '3', '--reviewer', 'none'], () => ({ body: JSON.stringify(OK) }));
  assert.match(r.out, /Nobody is told now when task 3 on p1 misses a run\./);
  r = await runWin(['task', 'repeat', 'p1', '3', '--reviewer'], () => ({ body: '{}' }));
  assert.equal(r.code, 2);
  assert.equal(r.calls.length, 0);
  r = await runWin(['task', 'repeat', 'p1', '3', 'daily', '--at', '09:00', '--reviewer', 'ada'], () => ({ body: JSON.stringify(OK) }));
  assert.match(r.out, /now repeats every day at 9am/);
  assert.equal(JSON.parse(r.calls[0].body).every, 'daily');
});

test('#4787 slice 3 review 1: a rule and a reviewer together say both (Mac and Windows)', async () => {
  await withBoard(() => [200, OK], async (env) => {
    const r = await runCli(['task', 'repeat', 'p1', '3', 'daily', '--at', '09:00', '--reviewer', 'ada'], env);
    assert.match(r.stdout, /now repeats every day at 9am\. ada will be told when it misses a run\./);
  });
  const w = await runWin(['task', 'repeat', 'p1', '3', 'daily', '--at', '09:00', '--reviewer', 'ada'], () => ({ body: JSON.stringify(OK) }));
  assert.match(w.out, /now repeats every day at 9am\. ada will be told when it misses a run\./);
});

test('#4787 slice 3 review 2: --at or --on with no frequency is refused before the board, never dropped (Mac and Windows)', async () => {
  await withBoard(() => [200, OK], async (env, hits) => {
    const r = await runCli(['task', 'repeat', 'p1', '3', '--reviewer', 'ada', '--at', '10:00'], env);
    assert.equal(r.code, 2, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /--at and --on go with how often/);
    assert.equal(hits.length, 0);
  });
  const w = await runWin(['task', 'repeat', 'p1', '3', '--reviewer', 'ada', '--on', 'mon'], () => ({ body: '{}' }));
  assert.equal(w.code, 2);
  assert.match(w.err, /--at and --on go with how often/);
  assert.equal(w.calls.length, 0);
});
