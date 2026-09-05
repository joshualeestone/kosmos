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

/* 📌 THE CALLER MOVED, THE GUARD DID NOT (#2086). This used to read the
   open-board.cmd heredoc out of the build script. That shim is gone: the entry
   point is a signable PE binary now (a .cmd cannot carry an Authenticode
   signature), and the launcher starts the helper itself with an argv array,
   which is also why the nested-quoting the shim existed to avoid is moot. The
   #2007 property is unchanged and still the thing under test -- only the file
   that has to satisfy it changed, so this now reads the launcher's source. */
const LAUNCHER_SRC = fs.readFileSync(path.join(REPO, 'tools', 'windows', 'KosmosLauncher.cs'), 'utf8');

test('the launcher runs the helper and NOT the pre-fix plain open (#2007)', () => {
  assert.match(LAUNCHER_SRC, /--port " \+ port \+ " --app/,
    'the launcher does not run the helper with --port and --app');
  assert.match(LAUNCHER_SRC, /"open-board\.js"/,
    'the launcher does not name the #2007 helper');
  assert.match(LAUNCHER_SRC, /runtime\\\\node\.exe/,
    'the launcher does not use the bundled node.exe');
  /* The whole bug: the pre-fix path opened the PLAIN url with no nonce. In a
     .cmd that was `start "" http://...`; the binary's equivalent is handing a
     url straight to the shell to open. Either way it is "a browser is pointed at
     the board without a boot nonce", which on the enforcing Windows board is a
     403 and an agents pane that reads as broken.
     ⚠️ MATCHES A URL BEING LAUNCHED, NOT A URL BEING PRINTED. The launcher
     legitimately PRINTS http://127.0.0.1:<port> twice, telling a person where to
     go if no browser opens, so a bare url match here would fail on correct code. */
  assert.doesNotMatch(LAUNCHER_SRC, /Process\.Start\(\s*"http:/,
    'the launcher opens the PLAIN url directly - the #2007 bug is back');
  assert.doesNotMatch(LAUNCHER_SRC, /UseShellExecute\s*=\s*true/,
    'the launcher shell-executes something; that is how a bare url gets opened');
});

test('#2086: the build stages the committed launcher and refuses a stale one', () => {
  // The entry point is a binary the build COPIES rather than writes, so the two
  // properties that replace "did the heredoc say the right thing" are: it comes
  // from the committed file, and its baked-in port cannot silently disagree with
  // the board's.
  assert.match(WIN, /cp "\$LAUNCHER" "\$STAGE\/Kosmos\.exe"/,
    'the build no longer stages the committed launcher');
  assert.match(WIN, /LAUNCHER_PORT" = "\$PORT_DEFAULT/,
    'the build no longer compares the launcher port against the board default');
  assert.doesNotMatch(WIN, /\$STAGE\/Kosmos\.cmd/,
    'the build writes a .cmd entry point again - it cannot be signed (#2086)');
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
      // The permission only forces EACCES for a NON-root user; root reads a 000
      // file regardless, defeating the permission (not the logic), so assert only
      // when the file is genuinely unreadable to THIS process. On non-root that is
      // true and the treatment runs; on root it is readable and we skip honestly.
      const isUnreadable = (() => { try { fs.readFileSync(tokFile); return false; } catch { return true; } })();
      if (isUnreadable) {
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
    // openInBrowser resolves on 'spawn' (after unref) with { child, ok }; await
    // the child's exit so the recorder stub has finished writing before we read.
    const { child, ok } = await helper.openInBrowser(url);
    assert.equal(ok, true, 'the spawn should have succeeded');
    await new Promise((resolve) => child.on('exit', resolve));
    assert.equal(fs.readFileSync(out, 'utf8'), url, 'the opener was not handed the resolved url');
  } finally {
    if (prev === undefined) delete process.env.KOSMOS_OPEN_BIN; else process.env.KOSMOS_OPEN_BIN = prev;
  }
});

test('openInBrowser reports a launch FAILURE (diagnostic not lost to process exit)', async () => {
  // The #2007 iteration-5 WARNING: a bare unref + async 'error' handler could let
  // the short-lived process exit before the handler wrote its diagnostic. Now
  // openInBrowser awaits the spawn/error outcome, so a failed launch resolves
  // { ok: false } and the stderr note is written before the caller returns. Point
  // the seam at a binary that cannot exist so spawn emits 'error' (ENOENT).
  const prev = process.env.KOSMOS_OPEN_BIN;
  process.env.KOSMOS_OPEN_BIN = '/nonexistent/definitely-not-a-real-opener';
  const origWrite = process.stderr.write.bind(process.stderr);
  let err = '';
  process.stderr.write = (chunk) => { err += String(chunk); return true; };
  try {
    const { ok } = await helper.openInBrowser('http://127.0.0.1:16180/?boot=abc123');
    assert.equal(ok, false, 'a launch that cannot spawn should resolve ok:false');
    assert.match(err, /could not launch the browser/, 'the launch-failure diagnostic was not written');
  } finally {
    process.stderr.write = origWrite;
    if (prev === undefined) delete process.env.KOSMOS_OPEN_BIN; else process.env.KOSMOS_OPEN_BIN = prev;
  }
});

test('a mint that returns a non-2xx (stale/wrong token -> 403) falls back to plain', async () => {
  // The realistic enforcing-board failure: the board token on disk is stale, so
  // POST /api/board-nonce returns 403 (not a malformed body). mintNonce must treat
  // !r.ok as no-nonce and resolveOpenUrl fall back to the plain url.
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/') { res.writeHead(200); res.end('board'); return; }
    if (req.method === 'POST' && req.url === '/api/board-nonce') { res.writeHead(403); res.end('{"error":"nope"}'); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const { appDir } = makeAppDir({ withToken: true });
  try {
    const url = await helper.resolveOpenUrl({ appDir, port, timeoutMs: 4000 });
    assert.equal(url, `http://127.0.0.1:${port}`, 'a 403 mint should fall back to the plain url');
  } finally { server.close(); }
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
    // Runs ~4.8s, not ~2.5s: at ~2.4s (after the first 2s probe aborts + a 400ms
    // sleep) the deadline is not yet reached, so a SECOND probe launches and runs
    // its full 2s abort (to ~4.4s) before the loop re-checks the deadline and exits.
    // The point is it is BOUNDED (well under the 12s ceiling) and never hangs - the
    // exact timing is a property of PROBE_TIMEOUT_MS, not a correctness concern.
    const url = await helper.resolveOpenUrl({ appDir, port, timeoutMs: 2500 });
    assert.equal(url, `http://127.0.0.1:${port}`, 'a hung board did not fall back to the plain url');
    assert.ok(Date.now() - t0 < 12000, 'the helper hung on an unresponsive board instead of timing out');
  } finally { server.close(); }
});

test('main() end-to-end: stdout is the PLAIN url, the opener gets the NONCED url', async () => {
  // main() holds the security-relevant coupling "print the plain url (nonce stays
  // out of logs), open the nonced url". resolveOpenUrl/openInBrowser are tested in
  // isolation but nothing exercises main(), so a regression that printed the nonced
  // url to stdout would pass silently. Run the helper as a real subprocess (the
  // production invocation) against a fixture enforcing board.
  const { execFile } = require('node:child_process');
  const napms = (ms) => new Promise((r) => setTimeout(r, ms));
  const { server, port } = await startFixtureBoard();      // returns a hex nonce
  const { appDir } = makeAppDir({ withToken: true });        // enforcing (token present)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kob-main-'));
  const out = path.join(dir, 'opened.txt');
  const stub = path.join(dir, 'opener.sh');
  fs.writeFileSync(stub, `#!/bin/bash\nprintf '%s' "$1" > ${JSON.stringify(out)}\n`);
  fs.chmodSync(stub, 0o755);
  try {
    const stdout = await new Promise((resolve, reject) => {
      execFile(
        process.execPath,
        [path.join(__dirname, 'tools', 'kosmos-open-board.js'), '--port', String(port), '--app', appDir, '--timeout-ms', '4000'],
        { env: { ...process.env, KOSMOS_OPEN_BIN: stub } },
        (err, so) => (err ? reject(err) : resolve(so)),
      );
    });
    // stdout is the human message: the PLAIN url, and NO nonce.
    assert.equal(stdout.trim(), `http://127.0.0.1:${port}`, 'stdout was not the plain url');
    assert.doesNotMatch(stdout, /boot=/, 'the single-use nonce leaked into stdout');
    // The opener (a detached grandchild) receives the NONCED url. It may lag the
    // subprocess exit, so poll briefly rather than reading once and racing.
    let opened = '';
    for (let i = 0; i < 40 && !opened; i++) { try { opened = fs.readFileSync(out, 'utf8'); } catch (_e) { /* not yet */ } if (!opened) await napms(100); }
    assert.match(opened, new RegExp(`^http://127\\.0\\.0\\.1:${port}/\\?boot=[0-9a-f]+$`), 'the opener did not receive the nonced url');
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
