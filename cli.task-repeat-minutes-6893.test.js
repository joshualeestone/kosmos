'use strict';
/* kosmos#6893: both CLIs take a task that repeats every so many minutes ("30m", "2h"): the word goes to the board as the
   frequency (the board makes and checks the rule), --at and --on are refused with it, and the old words still work. The
   Mac CLI against a stub board that records every request, the Windows CLI through its main() with a fake fetch. */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFile } = require('node:child_process');
const taskrepeat = require('./engine/taskrepeat');

const CLI = path.join(__dirname, 'install', 'kosmos');
/* #4796: a fresh data root, so the live board's token never travels to this test's stub board. */
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-task-repeat-min-'));
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
const OK = { task: { number: 3, repeat: { every: 'minutes', n: 30 } }, words: 'every 30 minutes' };

test('#6893 Mac CLI: 30m and 2h go to the board as the frequency, which makes the minutes rule', () =>
  withBoard(() => [200, OK], async (env, hits) => {
    for (const [word, n] of [['30m', 30], ['45min', 45], ['2h', 120]]) {
      const r = await runCli(['task', 'repeat', 'p1', '3', word], env);
      assert.equal(r.code, 0, word + ': ' + r.stdout + r.stderr);
      const sent = JSON.parse(hits[hits.length - 1].body);
      assert.equal(sent.every, word);
      assert.equal('at' in sent, false);
      assert.deepEqual(taskrepeat.fromWords(sent.every, { at: sent.at, on: sent.on }), { every: 'minutes', n }, word);
    }
    // CONTROL: the old words still go through.
    const r = await runCli(['task', 'repeat', 'p1', '3', 'hourly'], env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(JSON.parse(hits[hits.length - 1].body).every, 'hourly');
  }));

test('#6893 Mac CLI: a minutes rule refuses --at and --on before asking the board; a wrong word names the new form', () =>
  withBoard(() => [200, OK], async (env, hits) => {
    for (const args of [['30m', '--at', '09:00'], ['--at', '09:00', '30m'], ['30m', '--on', 'mon'], ['30min', '--at', '09:00'], ['2Hours', '--on', 'tue']]) {
      const r = await runCli(['task', 'repeat', 'p1', '3', ...args], env);
      assert.equal(r.code, 2, args.join(' '));
      assert.match(r.stdout + r.stderr, /A task every so many minutes takes no --at or --on/, args.join(' '));
    }
    // Review 3: two frequencies are refused (the second would silently replace the first).
    for (const two of [['30m', 'daily'], ['hourly', 'daily'], ['2h', '30m']]) {
      const twice = await runCli(['task', 'repeat', 'p1', '3', ...two], env);
      assert.equal(twice.code, 2, two.join(' '));
      assert.match(twice.stdout + twice.stderr, /Say how often once/, two.join(' '));
    }
    const r = await runCli(['task', 'repeat', 'p1', '3', 'fortnightly'], env);
    assert.equal(r.code, 2);
    assert.match(r.stdout + r.stderr, /every so many minutes \(30m, 2h\)/);
    assert.equal(hits.length, 0, 'none of these reached the board');
    // CONTROL: a daily rule with --at is still fine (the refusal is the minutes rule's only), and so is a weekly rule
    // whose reviewer's name ends in m, h or s after a time (review 1: the first version refused it).
    let ok = await runCli(['task', 'repeat', 'p1', '3', 'daily', '--at', '09:00'], env);
    assert.equal(ok.code, 0, ok.stdout + ok.stderr);
    ok = await runCli(['task', 'repeat', 'p1', '3', 'weekly', '--on', 'mon', '--at', '09:00', '--reviewer', 'sam'], env);
    assert.equal(ok.code, 0, ok.stdout + ok.stderr);
    ok = await runCli(['task', 'repeat', 'p1', '3', 'daily', '--at', '9h', '--reviewer', 'tom'], env);
    assert.equal(ok.code, 0, 'a value is never read as a frequency, even one shaped like 9h: ' + ok.stdout + ok.stderr);
    assert.equal(hits.length, 3);
    // Any case.
    ok = await runCli(['task', 'repeat', 'p1', '3', '30M'], env);
    assert.equal(ok.code, 0, ok.stdout + ok.stderr);
  }));

test('#6893 Windows CLI: the same words, the same body, the same refusals', async () => {
  const ok = () => ({ body: JSON.stringify(OK) });
  let r = await runWin(['task', 'repeat', 'p1', '3', '30m'], ok);
  assert.equal(r.code, 0, r.err);
  const sent = JSON.parse(r.calls[r.calls.length - 1].body);
  assert.equal(sent.every, '30m');
  assert.deepEqual(taskrepeat.fromWords(sent.every, { at: sent.at }), { every: 'minutes', n: 30 });
  r = await runWin(['task', 'repeat', 'p1', '3', '30MIN'], ok);
  assert.equal(r.code, 0, r.err);
  r = await runWin(['task', 'repeat', 'p1', '3', 'weekly', '--on', 'mon', '--at', '09:00', '--reviewer', 'sam'], ok);
  assert.equal(r.code, 0, r.err);
  r = await runWin(['task', 'repeat', 'p1', '3', '30m', '--at', '09:00'], ok);
  assert.equal(r.code, 2);
  assert.match(r.err, /A task every so many minutes takes no --at or --on/);
  r = await runWin(['task', 'repeat', 'p1', '3', '30m', 'daily'], ok);
  assert.equal(r.code, 2);
  assert.match(r.err, /Say how often once/);
  r = await runWin(['task', 'repeat', 'p1', '3', 'fortnightly'], ok);
  assert.equal(r.code, 2);
  assert.match(r.err, /every so many minutes \(30m, 2h\)/);
  // CONTROL
  r = await runWin(['task', 'repeat', 'p1', '3', 'daily', '--at', '09:00'], ok);
  assert.equal(r.code, 0, r.err);
});
