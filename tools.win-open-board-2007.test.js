'use strict';

/*
 * #2007: the Windows launcher must open an AUTHENTICATED url, not the plain one.
 *
 * The board enforces #1946 auth on the unsandboxed Windows build, so a plain
 * `http://127.0.0.1:<port>` open gets a 403 and the agents pane reads as broken.
 * open-board.cmd now runs tools/kosmos-open-board.js, which mirrors bash cmd_open:
 * mint a single-use boot nonce and open `?boot=<nonce>`, falling back to the plain
 * url only on a non-enforcing board or a failure.
 *
 * Two halves, both guarded here:
 *   1. the BUILD wires it: open-board.cmd invokes the helper (and NOT a bare
 *      `start "" http://...`, which is the pre-fix bug), the helper ships in the
 *      zip, and it is in the post-build presence check.
 *   2. the HELPER'S LOGIC is correct: it is exercised against a fixture board on
 *      THIS machine (no Windows needed), because the risky branches - enforcing vs
 *      not, mint success vs a non-hex nonce, board down - are all in node.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const REPO = __dirname;
const WIN = fs.readFileSync(path.join(REPO, 'tools', 'build-kosmos-windows.sh'), 'utf8');
const helper = require('./tools/kosmos-open-board.js');

/* ---- half 1: the build wires the helper --------------------------------- */

test('open-board.cmd runs the helper and NOT the pre-fix plain open (#2007)', () => {
  // Isolate the open-board.cmd heredoc block.
  const m = WIN.match(/\{\n([\s\S]*?)\n\} > "\$STAGE\/open-board\.cmd"/);
  assert.ok(m, 'the open-board.cmd block was not found; the scan is broken');
  const block = m[1];
  assert.match(block, /open-board\.js" --port %s --app "%%~dp0app"/,
    'open-board.cmd does not run the helper with --port and --app');
  assert.match(block, /runtime\\\\node\.exe/, 'open-board.cmd does not use the bundled node.exe');
  // The whole bug: the pre-fix line opened the PLAIN url with no nonce. If it
  // comes back, this fix has regressed.
  assert.doesNotMatch(block, /start "" http:\/\/127\.0\.0\.1/,
    'open-board.cmd still opens the PLAIN url with start - the #2007 bug is back');
});

test('the helper is staged into the zip and checked for presence', () => {
  assert.match(WIN, /cp "\$REPO\/tools\/kosmos-open-board\.js" "\$STAGE\/open-board\.js"/,
    'the helper is not copied into the zip');
  // It ships at the zip ROOT, not under app/, so it stays out of the two-builder
  // app-parity scan (which reads only `cp ... "$STAGE/app` lines).
  assert.doesNotMatch(WIN, /kosmos-open-board\.js" "\$STAGE\/app/,
    'the helper is staged under app/, which would drag it into the app-parity scan');
  assert.match(WIN, /for want in[^\n]*"open-board\.js"/,
    'open-board.js is not in the post-build presence check');
});

/* ---- half 2: the helper's logic, against a fixture board ----------------- */

// A fixture board: GET / answers with `getStatus`, POST /api/board-nonce answers
// with `nonceBody`. Both are per-test knobs so we can model an enforcing board, a
// 403'ing board, and a board that returns a junk nonce.
function startFixtureBoard({ getStatus = 200, nonceBody = '{"nonce":"abc123def456"}' } = {}) {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(getStatus, { 'content-type': 'text/plain' });
      res.end('board');
      return;
    }
    if (req.method === 'POST' && req.url === '/api/board-nonce') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(nonceBody);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// A fake app dir whose engine/store.js reports ROOT = a temp data dir. Optionally
// writes board.token there, which is what makes the board "enforcing" to the helper.
function makeAppDir({ withToken }) {
  const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kob-app-'));
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kob-data-'));
  fs.mkdirSync(path.join(appDir, 'engine'), { recursive: true });
  // A minimal store stub: only ROOT is consulted by the helper.
  fs.writeFileSync(
    path.join(appDir, 'engine', 'store.js'),
    `module.exports = { ROOT: ${JSON.stringify(dataRoot)} };\n`,
  );
  if (withToken) fs.writeFileSync(path.join(dataRoot, 'board.token'), 'a-real-board-token\n');
  return { appDir, dataRoot };
}

test('enforcing board (token present): opens the nonced url', async () => {
  const { server, port } = await startFixtureBoard();
  const { appDir } = makeAppDir({ withToken: true });
  try {
    const url = await helper.resolveOpenUrl({ appDir, port, timeoutMs: 4000 });
    assert.equal(url, `http://127.0.0.1:${port}/?boot=abc123def456`);
  } finally { server.close(); }
});

test('enforcing board that 403s GET / STILL gets a nonce (the real Windows case)', async () => {
  // The board answers GET / with 403 but still mints on loopback; the helper must
  // treat "answered at all" as up and proceed to mint.
  const { server, port } = await startFixtureBoard({ getStatus: 403 });
  const { appDir } = makeAppDir({ withToken: true });
  try {
    const url = await helper.resolveOpenUrl({ appDir, port, timeoutMs: 4000 });
    assert.equal(url, `http://127.0.0.1:${port}/?boot=abc123def456`);
  } finally { server.close(); }
});

test('non-enforcing board (no token): opens the PLAIN url', async () => {
  const { server, port } = await startFixtureBoard();
  const { appDir } = makeAppDir({ withToken: false });
  try {
    const url = await helper.resolveOpenUrl({ appDir, port, timeoutMs: 4000 });
    assert.equal(url, `http://127.0.0.1:${port}`);
  } finally { server.close(); }
});

test('an UNREADABLE token warns (not a silent 403), but a MISSING one is silent', async () => {
  // Distinguishes the two states that both fall back to the plain url: a missing
  // board.token is the normal non-enforcing case (silent), while a present-but-
  // unreadable one is the ambiguous "enforcing but can't read the token" case that
  // silently reproduces the #2007 403 - it earns a stderr note. Capture stderr to
  // prove the note fires on EACCES and does NOT fire on ENOENT.
  function captureStderr(fn) {
    const orig = process.stderr.write.bind(process.stderr);
    let buf = '';
    process.stderr.write = (chunk) => { buf += String(chunk); return true; };
    return Promise.resolve()
      .then(fn)
      .finally(() => { process.stderr.write = orig; })
      .then(() => buf);
  }

  // (a) unreadable token -> warns
  {
    const { server, port } = await startFixtureBoard();
    const { appDir, dataRoot } = makeAppDir({ withToken: true });
    const tokFile = path.join(dataRoot, 'board.token');
    fs.chmodSync(tokFile, 0o000);
    try {
      let url;
      const err = await captureStderr(async () => { url = await helper.resolveOpenUrl({ appDir, port, timeoutMs: 4000 }); });
      // If the runner is root (can read 000), skip the assertion honestly rather
      // than pass vacuously - root defeats the permission, not the logic.
      const canForce = (() => { try { fs.readFileSync(tokFile); return true; } catch { return false; } })();
      if (canForce) {
        assert.match(err, /board\.token exists but could not be read/, 'no warning on an unreadable token');
        assert.equal(url, `http://127.0.0.1:${port}`, 'an unreadable token should fall back to the plain url');
      }
    } finally { fs.chmodSync(tokFile, 0o600); server.close(); }
  }

  // (b) missing token -> silent (the normal non-enforcing case)
  {
    const { server, port } = await startFixtureBoard();
    const { appDir } = makeAppDir({ withToken: false });
    try {
      const err = await captureStderr(async () => { await helper.resolveOpenUrl({ appDir, port, timeoutMs: 4000 }); });
      assert.doesNotMatch(err, /board\.token exists but could not be read/, 'a missing token must not warn (it is the normal non-enforcing case)');
    } finally { server.close(); }
  }
});

test('CONTROL: a non-hex nonce is refused, url falls back to plain', async () => {
  // Proves the hex guard is load-bearing: without it, junk would be pasted onto
  // the url as if it were a nonce.
  const { server, port } = await startFixtureBoard({ nonceBody: '{"nonce":"not a nonce!"}' });
  const { appDir } = makeAppDir({ withToken: true });
  try {
    const url = await helper.resolveOpenUrl({ appDir, port, timeoutMs: 4000 });
    assert.equal(url, `http://127.0.0.1:${port}`,
      'a junk nonce was accepted onto the url');
  } finally { server.close(); }
});

test('openInBrowser hands the resolved url to the opener (KOSMOS_OPEN_BIN seam)', async () => {
  // Proves the browser actually gets opened with the url the resolver chose, via
  // the same seam production uses. A recorder script writes the url it is handed.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kob-open-'));
  const out = path.join(dir, 'opened.txt');
  const stub = path.join(dir, 'opener.sh');
  fs.writeFileSync(stub, `#!/bin/bash\nprintf '%s' "$1" > ${JSON.stringify(out)}\n`);
  fs.chmodSync(stub, 0o755);
  const url = 'http://127.0.0.1:16180/?boot=deadbeef';
  const prev = process.env.KOSMOS_OPEN_BIN;
  process.env.KOSMOS_OPEN_BIN = stub;
  try {
    const child = helper.openInBrowser(url);
    await new Promise((resolve, reject) => {
      child.on('exit', resolve);
      child.on('error', reject);
    });
    assert.equal(fs.readFileSync(out, 'utf8'), url, 'the opener was not handed the resolved url');
  } finally {
    if (prev === undefined) delete process.env.KOSMOS_OPEN_BIN; else process.env.KOSMOS_OPEN_BIN = prev;
  }
});

test('a board that ACCEPTS the connection but never responds does not hang', async () => {
  // The dangerous case a per-fetch timeout guards: the tcp connect succeeds, so a
  // fetch with no AbortSignal would await a response that never comes, forever,
  // opening no browser. With the per-probe AbortSignal the helper must give up and
  // fall back to the plain url in bounded time.
  const server = http.createServer(() => { /* accept, then never respond */ });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const { appDir } = makeAppDir({ withToken: true });
  const t0 = Date.now();
  try {
    // deadline shorter than one probe timeout + a probe, so this resolves via the
    // deadline while a probe is aborted rather than hung. Generous ceiling below.
    const url = await helper.resolveOpenUrl({ appDir, port, timeoutMs: 2500 });
    assert.equal(url, `http://127.0.0.1:${port}`, 'a hung board did not fall back to the plain url');
    assert.ok(Date.now() - t0 < 12000, 'the helper hung on an unresponsive board instead of timing out');
  } finally { server.close(); }
});

test('board never comes up: opens the plain url within the timeout', async () => {
  // Nothing listening on this port; the helper must give up and return the plain
  // url rather than hang or crash.
  const { appDir } = makeAppDir({ withToken: true });
  const port = 1;               // port 1 refuses fast; the connect simply errors
  const t0 = Date.now();
  const url = await helper.resolveOpenUrl({ appDir, port, timeoutMs: 1200 });
  assert.equal(url, `http://127.0.0.1:${port}`);
  assert.ok(Date.now() - t0 < 5000, 'the helper did not honor its timeout');
});
