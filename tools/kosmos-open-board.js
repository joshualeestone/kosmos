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
 * itself and sends it in a fetch() header - never as a subprocess argument. That
 * header is REQUIRED, not decorative: on an ENFORCING board the server gates every
 * /api/ path (board-nonce included) on the board token via its sensitive-route
 * check (server.js: `sensitive = pathname.startsWith('/api/') ...`, then a 403 if
 * `!tokenOk`). The helper only reaches the mint when board.token was present, i.e.
 * on an enforcing board, so the mint would 403 without this header. Never drop it.
 *
 * WHY THIS OPENS THE BROWSER ITSELF rather than printing the url for the .cmd to
 * open: capturing a quoted command's stdout in cmd.exe needs a `for /f "usebackq"`
 * with nested quotes, which is the single most error-prone thing to write in a
 * .cmd from a Mac where it cannot be run. Opening here keeps open-board.cmd to one
 * plain `node.exe <script> <args>` line - the smallest possible untestable
 * surface - and puts every branch that can go wrong in node, which IS testable on
 * a Mac. The PLAIN url is printed to stdout as a human message (mirroring
 * cmd_open's `say "$URL"`, which keeps the single-use boot nonce out of any
 * captured console log); the nonced url is opened silently. All diagnostics go to
 * stderr.
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
const PROBE_TIMEOUT_MS = 2000; // per-probe cap, mirrors cmd_open's `healthy` -m 2
const MINT_TIMEOUT_MS = 15000; // mint cap, mirrors cmd_open's mint -m 15

async function waitForBoard(url, deadline) {
  while (Date.now() < deadline) {
    try {
      // AbortSignal.timeout bounds each in-flight probe: without it a board that
      // ACCEPTS the tcp connection but never answers would hang this fetch forever
      // (the deadline is only checked BETWEEN iterations, not during one), and no
      // browser would ever open - the exact "crash with no url" the fallback is
      // meant to prevent. cmd_open bounds each curl the same way (-m 2).
      const r = await fetch(url + '/', { method: 'GET', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      if (r && typeof r.status === 'number') return true;
    } catch (_e) { /* not up yet, or the probe timed out; retry until the deadline */ }
    await sleep(400);
  }
  return false;
}

function readBoardToken(appDir) {
  // store.ROOT is a lazy getter computing the per-platform data root (%APPDATA%
  // on Windows), so this resolves the same path the server used to WRITE the
  // token. A missing store module or ROOT is a layout with no board -> not
  // enforcing -> plain url (the safe default), and it is SILENT.
  let root;
  try {
    const store = require(path.join(appDir, 'engine', 'store'));
    root = store && store.ROOT;
  } catch (_e) {
    return '';
  }
  if (!root) return '';
  try {
    return fs.readFileSync(path.join(root, 'board.token'), 'utf8').trim() || '';
  } catch (e) {
    // ENOENT is the NORMAL non-enforcing state: the board writes board.token only
    // on the enforcing path, so a missing file simply means "not enforcing" and the
    // plain url is correct - warning there would fire on every non-enforcing board.
    // ANY OTHER error (EACCES: the file exists but cannot be read) is the genuine
    // "enforcing but token unreadable" case, which silently reproduces the #2007
    // symptom (plain url -> 403), so it earns a stderr note for Windows debugging.
    // The return is '' either way, so the plain-url contract is unchanged.
    if (e && e.code !== 'ENOENT') {
      process.stderr.write('kosmos-open-board: board.token exists but could not be read (' + (e.code || (e && e.message) || e) + '); opening the plain url (this will 403 if the board is enforcing)\n');
    }
    return '';
  }
}

async function mintNonce(url, token) {
  try {
    const r = await fetch(url + '/api/board-nonce', {
      method: 'POST',
      headers: { 'x-kosmos-board-token': token },
      // Bound the mint too (a board that accepts but never answers must not hang
      // the launcher); mirrors cmd_open's `-m 15` on the mint.
      signal: AbortSignal.timeout(MINT_TIMEOUT_MS),
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
  // Print the PLAIN url as the human message (mirrors cmd_open's `say "$URL"`),
  // then OPEN the resolved url (nonced on an enforcing board). Printing the plain
  // url rather than the nonced one keeps the single-use boot nonce out of any
  // captured console log - the same reason cmd_open says the plain url and opens
  // the nonce silently.
  process.stdout.write(`http://127.0.0.1:${port}\n`);
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
