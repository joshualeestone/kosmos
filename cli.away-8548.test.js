'use strict';

/**
 * kosmos#8548: `kosmos away [--hook]` asks GET /api/away for what reached the agent while it was not running, with its
 * token and pane. --hook asks for the startup window, prints only the SessionStart hook JSON, only on a 200, and always
 * exits 0, within its 1 s cap. Driven against a stub board.
 *
 *   node --test cli.away-8548.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-away-8548-'));
process.on('exit', () => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* best effort */ } });

const CLI = path.join(__dirname, 'install', 'kosmos');
const SKIP_POSIX_SHELL = require('./test-support/skip-on-win32').skipOnWin32('it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do');   // kosmos#8378
const TOKEN = 'cd'.repeat(16);
const envFor = (port) => ({ ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port), TMUX_PANE: '%7', KOSMOS_AGENT_TOKEN: TOKEN });
const HOOKJSON = JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'Kosmos: while this agent was not running x' } });

function runCli(args, env) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const child = execFile(CLI, args, { env, timeout: 30000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('no exit code (' + (err.signal || err.code) + '). ' + (stderr || ''))); return; }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '', ms: Date.now() - t0 });
    });
    child.stdin.end('');
  });
}

function withStubBoard(fn, reply) {
  const seen = [];
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/away')) {
      seen.push({ method: req.method, url: req.url, headers: req.headers });
      const r = typeof reply === 'function' ? reply(req) : reply;
      if (r.hang) return;   // never answers
      res.writeHead(r.status, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(r.text);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<title>Kosmos</title>Agent Workforce');
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      let failure = null;
      try { await fn(server.address().port, seen); } catch (e) { failure = e; }
      server.closeAllConnections();
      server.close(() => (failure ? reject(failure) : resolve()));
    });
  });
}

test('bare: a GET with the agent token and the pane, as=text, and the board\'s words printed', { skip: SKIP_POSIX_SHELL }, () => withStubBoard(async (port, seen) => {
  const out = await runCli(['away'], envFor(port));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, 'GET');
  assert.match(seen[0].url, /^\/api\/away\?as=text&from_pane=%257$/);
  assert.equal(seen[0].headers['x-kosmos-agent-token'], TOKEN);
  assert.equal(out.stdout, 'Nothing arrived for you while you were not running.\n');
}, { status: 200, text: 'Nothing arrived for you while you were not running.\n' }));

test('bare: a refusal prints the board\'s words and exits 1', { skip: SKIP_POSIX_SHELL }, () => withStubBoard(async (port) => {
  const out = await runCli(['away'], envFor(port));
  assert.equal(out.code, 1);
  assert.match(out.stdout, /^refused for the test/);
}, { status: 403, text: 'refused for the test\n' }));

test('--hook asks for the startup window and prints only the JSON on a 200, exit 0', { skip: SKIP_POSIX_SHELL }, () => withStubBoard(async (port, seen) => {
  const out = await runCli(['away', '--hook'], envFor(port));
  assert.equal(out.code, 0);
  assert.match(seen[0].url, /^\/api\/away\?as=hook&at=startup&from_pane=%257$/);
  assert.equal(out.stdout, HOOKJSON + '\n');
  assert.equal(out.stderr, '');
  assert.equal(seen[0].headers['x-kosmos-board-token'], undefined, 'with an agent token, only the agent token is sent');
}, { status: 200, text: HOOKJSON }));

test('--hook says nothing and exits 0 on a refusal, other words, an empty answer, or a board that does not answer in time', { skip: SKIP_POSIX_SHELL }, async () => {
  for (const reply of [{ status: 403, text: HOOKJSON }, { status: 200, text: 'not the hook json' }, { status: 200, text: '' }]) {
    await withStubBoard(async (port) => {
      const out = await runCli(['away', '--hook'], envFor(port));
      assert.deepEqual([out.code, out.stdout], [0, ''], JSON.stringify(reply));
    }, reply);
  }
  await withStubBoard(async (port) => {
    const out = await runCli(['away', '--hook'], envFor(port));
    assert.deepEqual([out.code, out.stdout], [0, '']);
    assert.ok(out.ms < 3000, 'the 1 s cap holds a startup for about a second: ' + out.ms + ' ms');
  }, { hang: true });
});

test('--help prints the usage and never asks the board; an unknown argument is a usage error', { skip: SKIP_POSIX_SHELL }, () => withStubBoard(async (port, seen) => {
  for (const args of [['away', '--help'], ['away', '-h']]) {
    const out = await runCli(args, envFor(port));
    assert.equal(out.code, 0, args.join(' '));
    assert.match(out.stdout, /^Usage: kosmos away \[--hook\]/, args.join(' '));
  }
  assert.equal((await runCli(['away', '--all'], envFor(port))).code, 2);
  assert.equal(seen.length, 0);
}, { status: 200, text: '' }));
