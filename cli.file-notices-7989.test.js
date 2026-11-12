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
const SKIP_POSIX_SHELL = require('./test-support/skip-on-win32').skipOnWin32('it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do');   // kosmos#8378
const TOKEN = 'cd'.repeat(16);
const envFor = (port) => ({ ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port), TMUX_PANE: '%7', KOSMOS_AGENT_TOKEN: TOKEN });
const HOOKJSON = JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'Kosmos file-owner notice' } });
const IDS = 'aaaaaaaaaaaa,bbbbbbbbbbbb';
const HOOKBODY = 'ack:' + IDS + '\n' + HOOKJSON;
let ackN = 0;
const ackPath = () => path.join(DATA, 'ack-' + (ackN++));

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

test('bare: a POST with the agent token and the pane, as=text, and the board\'s words printed', { skip: SKIP_POSIX_SHELL }, () => withStubBoard(async (port, seen) => {
  const out = await runCli(['file-notices'], envFor(port));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, 'POST');
  assert.match(seen[0].url, /^\/api\/file-notices\/take\?as=text&from_pane=%257$/);
  assert.equal(seen[0].headers['x-kosmos-agent-token'], TOKEN);
  assert.equal(out.stdout, 'No file notices are waiting for you.\n');
}, { status: 200, text: 'No file notices are waiting for you.\n' }));

test('--hook prints only the JSON on a 200, exits 0, and keeps the ids it was handed in --ack-file', { skip: SKIP_POSIX_SHELL }, () => withStubBoard(async (port, seen) => {
  const f = ackPath();
  const out = await runCli(['file-notices', '--hook', '--ack-file', f], envFor(port));
  assert.equal(out.code, 0);
  assert.match(seen[0].url, /as=hook&from_pane=%257&ack=$/, 'no file yet: nothing acknowledged');
  assert.equal(out.stdout, HOOKJSON + '\n');
  assert.equal(out.stderr, '');
  assert.equal(fs.readFileSync(f, 'utf8'), IDS + '\n');
  await runCli(['file-notices', '--hook', '--ack-file', f], envFor(port));
  assert.match(seen[1].url, /&ack=aaaaaaaaaaaa,bbbbbbbbbbbb$/, 'the next call sends them back');
}, { status: 200, text: HOOKBODY }));

test('--hook: a count-only answer (no ids) prints the JSON and leaves an empty ack line', { skip: SKIP_POSIX_SHELL }, () => withStubBoard(async (port) => {
  const f = ackPath();
  fs.writeFileSync(f, IDS + '\n');
  const out = await runCli(['file-notices', '--hook', '--ack-file', f], envFor(port));
  assert.deepEqual([out.code, out.stdout], [0, HOOKJSON + '\n']);
  assert.equal(fs.readFileSync(f, 'utf8'), '\n');
}, { status: 200, text: 'ack:\n' + HOOKJSON }));

test('--ack-file: emptied on an empty 200, left alone on a refusal or bad answer, and ignored when it holds other characters', { skip: SKIP_POSIX_SHELL }, async () => {
  const f = ackPath();
  fs.writeFileSync(f, IDS + '\n');
  await withStubBoard(async (port) => {
    assert.deepEqual((await runCli(['file-notices', '--hook', '--ack-file', f], envFor(port))).stdout, '');
  }, { status: 403, text: HOOKBODY });
  assert.equal(fs.readFileSync(f, 'utf8'), IDS + '\n', 'a refusal leaves the ids to send again');
  await withStubBoard(async (port) => {
    assert.deepEqual((await runCli(['file-notices', '--hook', '--ack-file', f], envFor(port))).stdout, '');
  }, { status: 200, text: 'ack:zz\n' + HOOKJSON });
  assert.equal(fs.readFileSync(f, 'utf8'), IDS + '\n', 'an ack line with other characters is not believed');
  await withStubBoard(async (port) => {
    await runCli(['file-notices', '--hook', '--ack-file', f], envFor(port));
  }, { status: 200, text: '' });
  assert.equal(fs.readFileSync(f, 'utf8'), '', 'an empty 200: nothing is waiting, nothing to acknowledge');
  fs.writeFileSync(f, 'x&admin=1\n');
  await withStubBoard(async (port, seen) => {
    await runCli(['file-notices', '--hook', '--ack-file', f], envFor(port));
    assert.match(seen[0].url, /&ack=$/, 'a file holding other characters sends no ack');
  }, { status: 200, text: '' });
  await withStubBoard(async (port, seen) => {
    for (const bad of [['file-notices', '--ack-file', f], ['file-notices', '--hook', '--ack-file']]) {
      assert.equal((await runCli(bad, envFor(port))).code, 2, bad.join(' '));
    }
    assert.equal(seen.length, 0);
  }, { status: 200, text: '' });
});

test('--hook says nothing and exits 0 on a refusal, other words, or a board that does not answer in time', { skip: SKIP_POSIX_SHELL }, async () => {
  await withStubBoard(async (port) => {
    const out = await runCli(['file-notices', '--hook'], envFor(port));
    assert.deepEqual([out.code, out.stdout], [0, '']);
  }, { status: 403, text: HOOKBODY });
  await withStubBoard(async (port) => {
    const out = await runCli(['file-notices', '--hook'], envFor(port));
    assert.deepEqual([out.code, out.stdout], [0, '']);
  }, { status: 200, text: HOOKJSON });   // the JSON without its ack line is not the hook answer
  await withStubBoard(async (port) => {
    const out = await runCli(['file-notices', '--hook'], envFor(port));
    assert.deepEqual([out.code, out.stdout], [0, '']);
    assert.ok(out.ms < 3000, 'the 1 s cap holds a turn for about a second, not the 15 s a verb waits: ' + out.ms + ' ms');
  }, { hang: true });
});

test('--hook with an agent token sends only the agent token, so no board token is read on every turn', { skip: SKIP_POSIX_SHELL }, () => withStubBoard(async (port, seen) => {
  const out = await runCli(['file-notices', '--hook'], envFor(port));
  assert.equal(out.code, 0);
  assert.equal(seen[0].headers['x-kosmos-agent-token'], TOKEN);
  assert.equal(seen[0].headers['x-kosmos-board-token'], undefined);
}, { status: 200, text: '' }));

test('--help prints the usage and never asks the board, so it cannot take (clear) the notices', { skip: SKIP_POSIX_SHELL }, () => withStubBoard(async (port, seen) => {
  for (const args of [['file-notices', '--help'], ['file-notices', '-h']]) {
    const out = await runCli(args, envFor(port));
    assert.equal(out.code, 0, args.join(' '));
    assert.match(out.stdout, /^Usage: kosmos file-notices \[--hook \[--ack-file <path>\]\]/, args.join(' '));
  }
  assert.equal(seen.length, 0);
}, { status: 200, text: '' }));

test('--hook against a port with nothing listening says nothing, exits 0, and stays inside its cap', { skip: SKIP_POSIX_SHELL }, async () => {
  const closed = await new Promise((resolve) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const out = await runCli(['file-notices', '--hook'], envFor(closed));
  assert.deepEqual([out.code, out.stdout], [0, '']);
  assert.ok(out.ms < 3000, 'a refused board must not hold the turn past the cap and its retries: ' + out.ms + ' ms');
});

test('an unknown argument is a usage error before the board is asked', { skip: SKIP_POSIX_SHELL }, () => withStubBoard(async (port, seen) => {
  const out = await runCli(['file-notices', '--all'], envFor(port));
  assert.equal(out.code, 2);
  assert.equal(seen.length, 0);
}, { status: 200, text: '' }));
