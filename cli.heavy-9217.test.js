'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/**
 * kosmos#9217 slice 1: `kosmos heavy` (the Mac and Linux CLI). Against a stub board that records requests: start and end
 * send the action, the label, the --pid and the pane, with the agent token in its header; a bare `kosmos heavy` lists;
 * bad arguments are refused before any request. The Windows CLI is a separate change.
 *
 *   node --test cli.heavy-9217.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFile } = require('node:child_process');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-heavy-9217-'));
process.on('exit', () => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* best effort */ } });
const CLI = path.join(__dirname, 'install', 'kosmos');
const SKIP_POSIX_SHELL = require('./test-support/skip-on-win32').skipOnWin32('it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do');   // kosmos#8378
const HEALTH = '<title>Kosmos</title>Agent Workforce';
const TOKEN = 'ab'.repeat(32);

function runCli(args, env) {
  return new Promise((resolve, reject) => {
    execFile(CLI, args, { env, timeout: 20000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code (' + (err.signal || err.code) + '). ' + (stderr || ''))); return; }
      resolve({ code: err ? err.code : 0, out: (stdout || '') + (stderr || '') });
    });
  });
}
function withBoard(answer, fn) {
  const hits = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (!req.url.startsWith('/api/')) { res.writeHead(200, { 'content-type': 'text/html' }); res.end(HEALTH); return; }
      hits.push({ method: req.method, url: req.url, body, token: req.headers['x-kosmos-agent-token'] || '' });
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(answer(req.method, body)));
    });
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      let failure = null;
      try { await fn(server.address().port, hits); } catch (e) { failure = e; }
      server.close(() => (failure ? reject(failure) : resolve()));
    });
  });
}
const envFor = (port) => ({ ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port), TMUX_PANE: '%42', KOSMOS_AGENT_TOKEN: TOKEN });
const answerOk = (method, body) => {
  if (method === 'GET') return { ok: true, jobs: [{ agent: 'ada', label: 'full test run', pid: 4242, since: Date.UTC(2026, 10, 27, 15, 5) }] };
  const b = JSON.parse(body);
  return b.action === 'start' ? { ok: true, job: { label: b.label, pid: b.pid || null, since: 1 } } : { ok: true, ended: 1 };
};

test('kosmos heavy start sends the action, label, pid and pane with the agent token, and says it is recorded', { skip: SKIP_POSIX_SHELL }, () =>
  withBoard(answerOk, async (port, hits) => {
    const r = await runCli(['heavy', 'start', 'full test run', '--pid', '4242'], envFor(port));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Recorded: full test run\. It shows on the board as running while process 4242 runs/);
    const sent = hits.filter((h) => h.method === 'POST' && h.url === '/api/heavy');
    assert.equal(sent.length, 1);
    assert.deepEqual(JSON.parse(sent[0].body), { action: 'start', label: 'full test run', pid: 4242, from_pane: '%42' });
    assert.equal(sent[0].token, TOKEN);
  }));

test('kosmos heavy end sends end (with no pid when none is given) and says it ended', { skip: SKIP_POSIX_SHELL }, () =>
  withBoard(answerOk, async (port, hits) => {
    const r = await runCli(['heavy', 'end'], envFor(port));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Ended: it no longer shows on the board/);
    assert.deepEqual(JSON.parse(hits.find((h) => h.method === 'POST').body), { action: 'end', label: '', from_pane: '%42' });
  }));

test('a bare kosmos heavy lists what is running', { skip: SKIP_POSIX_SHELL }, () =>
  withBoard(answerOk, async (port, hits) => {
    const r = await runCli(['heavy'], envFor(port));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^full test run \(ada, since \d\d:\d\d, process 4242\)$/m);
    assert.equal(hits[0].method, 'GET');
  }));

test('the board\'s refusal is said in its words and exits 1', { skip: SKIP_POSIX_SHELL }, () =>
  withBoard(() => ({ error: 'a job cannot start with -' }), async (port) => {
    const r = await runCli(['heavy', 'start', 'x'], envFor(port));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /Kosmos did not record that: a job cannot start with -\./);
  }));

test('bad arguments are refused before any request', { skip: SKIP_POSIX_SHELL }, () =>
  withBoard(answerOk, async (port, hits) => {
    for (const args of [['heavy', 'start'], ['heavy', 'begin', 'x'], ['heavy', 'start', 'a', 'b'], ['heavy', 'end', '--pid']]) {
      const r = await runCli(args, envFor(port));
      assert.equal(r.code, 2, args.join(' ') + ': ' + r.out);
    }
    const bad = await runCli(['heavy', 'start', 'x', '--pid', 'abc'], envFor(port));
    assert.equal(bad.code, 1, bad.out);
    assert.match(bad.out, /a process id is a whole number above 1/);
    assert.deepEqual(hits.filter((h) => h.url === '/api/heavy'), [], 'nothing reached the board');
  }));

test('kosmos heavy --help (and -h) prints the heavy usage, exits 0, and reads nothing', { skip: SKIP_POSIX_SHELL }, () =>
  withBoard(answerOk, async (port, hits) => {
    for (const args of [['heavy', '--help'], ['heavy', '-h'], ['heavy', 'start', '--help']]) {
      const r = await runCli(args, envFor(port));
      assert.equal(r.code, 0, args.join(' ') + ': ' + r.out);
      assert.match(r.out, /^\s*Usage: kosmos heavy \| kosmos heavy start /m, args.join(' ') + ' printed: ' + r.out.slice(0, 200));
    }
    assert.deepEqual(hits, [], 'a --help asked the board something');
  }));

test('a bare end with only process-tied jobs left says how to end them; the list shows the display name', { skip: SKIP_POSIX_SHELL }, () =>
  withBoard((method) => (method === 'GET'
    ? { ok: true, jobs: [{ agent: 'ada-discord', name: 'Ada', label: 'suite', pid: null, since: Date.UTC(2026, 10, 27, 15, 5) }] }
    : { ok: true, ended: 0, others: 2 }), async (port) => {
    const r = await runCli(['heavy', 'end'], envFor(port));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Your 2 recorded jobs are tied to a process: end each with kosmos heavy end --pid N/);
    const p = await runCli(['heavy', 'end', '--pid', '77'], envFor(port));
    assert.match(p.out, /Nothing of yours was recorded as running for that process\./, 'control: with a pid it says the plain sentence');
    const l = await runCli(['heavy'], envFor(port));
    assert.match(l.out, /^suite \(Ada, since \d\d:\d\d\)$/m);
  }));
