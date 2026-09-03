'use strict';

/*
 * #2007: the Windows launcher's browser-open, mirroring bash `cmd_open`
 * (install/kosmos). Windows has no bash, so the launcher cannot reuse cmd_open;
 * this is its faithful node analog, bundled into the zip and run by the bundled
 * node.exe from open-board.cmd.
 *
 * THE BUG THIS FIXES: open-board.cmd used to `start "" http://127.0.0.1:<port>`
 * - the PLAIN url, no nonce. #1946 board auth ENFORCES on the Windows build (it
 * runs unsandboxed), so an unauthenticated browser gets a 403 and the board's
 * agents pane shows "we cannot read your agents ... status 403". The bug wore the
 * costume of the expected "no agents on Windows" state.
 *
 * WHAT cmd_open DOES, AND WHAT THIS MIRRORS, step for step:
 *   1. ensure the board is up (cmd_open: `healthy || cmd_start`);
 *   2. read the durable board token from `store.ROOT/board.token` - present only
 *      on an ENFORCING board - purely to decide whether to mint (cmd_open gates on
 *      `_bt` non-empty);
 *   3. POST /api/board-nonce to mint a SINGLE-USE, short-TTL nonce, and open
 *      `<url>/?boot=<nonce>` (cmd_open: same);
 *   4. on a non-enforcing board, or any failure, open the PLAIN url unchanged
 *      (cmd_open falls back the same way).
 *
 * WHY A NONCE, NOT THE TOKEN, ON THE URL: #1979 deliberately removed the durable
 * token from the browser argv (macOS `ps` exposes argv cross-account; the durable
 * token is a forever-secret, a nonce is single-use and short-TTL). Putting
 * `?token=<durable>` on the Windows url would REOPEN that residual on Windows, so
 * this mirrors the nonce flow, not the pre-#1979 token flow.
 *
 * THE TOKEN NEVER TOUCHES ARGV HERE: this process reads board.token off disk
 * itself and, if it sends it at all, sends it in a fetch() header - never as a
 * subprocess argument. (The mint route is loopback-only and does not currently
 * require the header; it is sent anyway to match cmd_open and stay correct if the
 * route ever checks it.)
 *
 * WHY THIS OPENS THE BROWSER ITSELF rather than printing the url for the .cmd to
 * open: capturing a quoted command's stdout in cmd.exe needs a `for /f "usebackq"`
 * with nested quotes, which is the single most error-prone thing to write in a
 * .cmd from a Mac where it cannot be run. Opening here keeps open-board.cmd to one
 * plain `node.exe <script> <args>` line - the smallest possible untestable
 * surface - and puts every branch that can go wrong in node, which IS testable on
 * a Mac. The url is also printed to stdout for logs and for a person who wants to
 * open it themselves; all diagnostics go to stderr.
 *
 * THE OPENER IS SEAMED (KOSMOS_OPEN_BIN), exactly like cmd_open's KOSMOS_OPEN_BIN,
 * so a test drives the open without launching a real browser. In production the
 * platform default is used (Windows: `cmd /c start "" <url>`).
 *
 * Any failure degrades to the plain url, so the worst case is the pre-fix
 * behavior, never a crash with no url.
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* The board is "answering" as soon as it returns ANY http response, including a
 * 403 - a 403 means the board is up AND enforcing, which is exactly the case that
 * needs a nonce. Mirrors cmd_open ensuring the board is up before it mints. */
async function waitForBoard(url, deadline) {
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url + '/', { method: 'GET' });
      if (r && typeof r.status === 'number') return true;
    } catch (_e) { /* not up yet */ }
    await sleep(400);
  }
  return false;
}

function readBoardToken(appDir) {
  // store.ROOT is a lazy getter computing the per-platform data root (%APPDATA%
  // on Windows), so this resolves the same path the server used to WRITE the
  // token. Any failure (no store, non-enforcing board, unreadable file) means
  // "not enforcing" -> plain url, which is the safe default.
  try {
    const store = require(path.join(appDir, 'engine', 'store'));
    const root = store && store.ROOT;
    if (!root) return '';
    const tok = fs.readFileSync(path.join(root, 'board.token'), 'utf8').trim();
    return tok || '';
  } catch (_e) {
    return '';
  }
}

async function mintNonce(url, token) {
  try {
    const r = await fetch(url + '/api/board-nonce', {
      method: 'POST',
      headers: { 'x-kosmos-board-token': token },
    });
    if (!r || !r.ok) return '';
    const body = await r.json();
    const nonce = body && body.nonce;
    // The board mints a hex nonce; anything else is not one and must not be
    // pasted onto the url as if it were.
    return typeof nonce === 'string' && /^[0-9a-f]+$/.test(nonce) ? nonce : '';
  } catch (_e) {
    return '';
  }
}

async function resolveOpenUrl({ appDir, port, timeoutMs }) {
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + timeoutMs;

  if (!(await waitForBoard(url, deadline))) {
    process.stderr.write('kosmos-open-board: the board did not answer in time; opening the plain url\n');
    return url;
  }
  const token = readBoardToken(appDir);
  if (!token) {
    // Non-enforcing board (or no store): the plain url authenticates fine.
    return url;
  }
  const nonce = await mintNonce(url, token);
  if (!nonce) {
    process.stderr.write('kosmos-open-board: could not mint a boot nonce; opening the plain url (may 403 on an enforcing board)\n');
    return url;
  }
  return `${url}/?boot=${nonce}`;
}

/* Open a url in the platform browser. Seamed on KOSMOS_OPEN_BIN (a test seam,
 * same name/role as cmd_open's) so a test can observe the open without launching a
 * browser. On Windows the opener is cmd's `start` builtin, which needs an empty ""
 * title first so a quoted url is not mistaken for the window title. Detached +
 * unref so the launcher window is free to exit. */
function openInBrowser(url) {
  const seam = process.env.KOSMOS_OPEN_BIN;
  let cmd;
  let args;
  if (seam) {
    cmd = seam;
    args = [url];
  } else if (process.platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '', url];
  } else if (process.platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
  child.on('error', (e) => {
    process.stderr.write('kosmos-open-board: could not launch the browser (' + (e && e.message || e) + '); open it yourself: ' + url + '\n');
  });
  // Detach so the launcher's console window is free to exit while the browser
  // stays open. Returned so a test can await it (production never does).
  child.unref();
  return child;
}

async function main() {
  // Default appDir is the zip-root layout (this script ships beside app/); the
  // .cmd passes --app explicitly, so this default only serves standalone/test use.
  const appDir = argValue('--app', path.join(__dirname, 'app'));
  const port = argValue('--port', '16180');
  const timeoutMs = Number(argValue('--timeout-ms', '20000')) || 20000;
  const open = await resolveOpenUrl({ appDir, port, timeoutMs });
  // Print the url (for logs / a person who wants to open it themselves), then open.
  process.stdout.write(open + '\n');
  openInBrowser(open);
}

// Exported for the test; only run when invoked directly (mirrors the repo's
// require-vs-run idiom so a test can drive resolveOpenUrl against a fixture board).
if (require.main === module) {
  main().catch((e) => {
    // Never crash without opening SOMETHING: the launcher's whole job is to get a
    // browser onto the board, and the plain url is the honest worst case (the
    // pre-fix behavior).
    process.stderr.write('kosmos-open-board: ' + (e && e.message || e) + '\n');
    const url = `http://127.0.0.1:${argValue('--port', '16180')}`;
    process.stdout.write(url + '\n');
    openInBrowser(url);
  });
}

module.exports = { resolveOpenUrl, readBoardToken, mintNonce, waitForBoard, openInBrowser };
