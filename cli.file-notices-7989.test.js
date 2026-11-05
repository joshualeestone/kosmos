'use strict';

/**
 * kosmos#7989 slice 3: `kosmos file-notices [--hook]` takes the agent's own file-owner notices (POST
 * /api/file-notices/take) with its token and pane. --hook prints only the hook's JSON, only on a 200, and always exits
 * 0, within its 1 s cap. Driven against a stub board.
 *
 *   node --test cli.file-notices-7989.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-fn-7989-'));
process.on('exit', () => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* best effort */ } });

const CLI = path.join(__dirname, 'install', 'kosmos');
const TOKEN = 'cd'.repeat(16);
const envFor = (port) => ({ ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port), TMUX_PANE: '%7', KOSMOS_AGENT_TOKEN: TOKEN });
const HOOKJSON = JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'Kosmos file-owner notice' } });

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
    if (req.url.startsWith('/api/file-notices/take')) {
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

test('bare: a POST with the agent token and the pane, as=text, and the board\'s words printed', () => withStubBoard(async (port, seen) => {
  const out = await runCli(['file-notices'], envFor(port));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, 'POST');
  assert.match(seen[0].url, /^\/api\/file-notices\/take\?as=text&from_pane=%257$/);
  assert.equal(seen[0].headers['x-kosmos-agent-token'], TOKEN);
  assert.equal(out.stdout, 'No file notices are waiting for you.\n');
}, { status: 200, text: 'No file notices are waiting for you.\n' }));

test('--hook prints the JSON on a 200 and exits 0', () => withStubBoard(async (port, seen) => {
  const out = await runCli(['file-notices', '--hook'], envFor(port));
  assert.equal(out.code, 0);
  assert.match(seen[0].url, /as=hook/);
  assert.equal(out.stdout, HOOKJSON + '\n');
  assert.equal(out.stderr, '');
}, { status: 200, text: HOOKJSON }));

test('--hook says nothing and exits 0 on a refusal, other words, or a board that does not answer in time', async () => {
  await withStubBoard(async (port) => {
    const out = await runCli(['file-notices', '--hook'], envFor(port));
    assert.deepEqual([out.code, out.stdout], [0, '']);
  }, { status: 403, text: HOOKJSON });
  await withStubBoard(async (port) => {
    const out = await runCli(['file-notices', '--hook'], envFor(port));
    assert.deepEqual([out.code, out.stdout], [0, '']);
  }, { status: 200, text: 'not json' });
  await withStubBoard(async (port) => {
    const out = await runCli(['file-notices', '--hook'], envFor(port));
    assert.deepEqual([out.code, out.stdout], [0, '']);
    assert.ok(out.ms < 3000, 'the 1 s cap holds a turn for about a second, not the 15 s a verb waits: ' + out.ms + ' ms');
  }, { hang: true });
});

test('--hook with an agent token sends only the agent token, so no board token is read on every turn', () => withStubBoard(async (port, seen) => {
  const out = await runCli(['file-notices', '--hook'], envFor(port));
  assert.equal(out.code, 0);
  assert.equal(seen[0].headers['x-kosmos-agent-token'], TOKEN);
  assert.equal(seen[0].headers['x-kosmos-board-token'], undefined);
}, { status: 200, text: '' }));

test('--help prints the usage and never asks the board, so it cannot take (clear) the notices', () => withStubBoard(async (port, seen) => {
  for (const args of [['file-notices', '--help'], ['file-notices', '-h']]) {
    const out = await runCli(args, envFor(port));
    assert.equal(out.code, 0, args.join(' '));
    assert.match(out.stdout, /^Usage: kosmos file-notices \[--hook\]/, args.join(' '));
  }
  assert.equal(seen.length, 0);
}, { status: 200, text: '' }));

test('--hook against a port with nothing listening says nothing, exits 0, and stays inside its cap', async () => {
  const closed = await new Promise((resolve) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const out = await runCli(['file-notices', '--hook'], envFor(closed));
  assert.deepEqual([out.code, out.stdout], [0, '']);
  assert.ok(out.ms < 3000, 'a refused board must not hold the turn past the cap and its retries: ' + out.ms + ' ms');
});

test('an unknown argument is a usage error before the board is asked', () => withStubBoard(async (port, seen) => {
  const out = await runCli(['file-notices', '--all'], envFor(port));
  assert.equal(out.code, 2);
  assert.equal(seen.length, 0);
}, { status: 200, text: '' }));
