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
 *   1. wait for the board to be up. NOTE: cmd_open STARTS it (`healthy || cmd_start`);
 *      this helper only POLLS (waitForBoard) - it cannot start server.js itself.
 *      Kosmos.cmd already launches server.js concurrently (its own last line), so
 *      the start is covered there; here we only wait for that to come up;
 *   2. read the durable board token from `store.ROOT/board.token` - present only
 *      on an ENFORCING board - purely to decide whether to mint (cmd_open gates on
 *      `_bt` non-empty);
 *   3. POST /api/board-nonce to mint a SINGLE-USE, short-TTL nonce, and open
 *      `<url>/?boot=<nonce>` (cmd_open: same);
 *   4. on a non-enforcing board, open the PLAIN url unchanged. On an enforcing
 *      board a failed mint opens nothing (kosmos#6464; cmd_open still falls back
 *      to the plain url when the board answers without a nonce).
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
 * behavior, never a crash with no url. EXCEPT ON AN ENFORCING BOARD (#1765, a
 * token on disk), where nothing is opened and no address is printed (exit
 * OPENER_REFUSED_EXIT) when: a listener cannot prove it holds this account's
 * token (see boardProven below), the mint fails right after a passing proof
 * (kosmos#6464), nothing answers within the wait, or the helper fails before it
 * could check (main's catch). A board.token that is there but cannot be read is
 * treated as enforcing (kosmos#6464): nothing is opened.
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
// A single fallback port for STANDALONE/TEST use only. Production never reaches it:
// open-board.cmd always passes --port, baked from server.js by the build (the build
// reads the real default from source precisely to avoid a hand-typed copy, so this
// is not a second authority for the port - it is the "no one told us" fallback).
const DEFAULT_PORT = '16180';

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
    // ANY OTHER error (EACCES, EBUSY, EISDIR: the file is there but cannot be read)
    // is the "enforcing but token unreadable" case. kosmos#6464: it returns null, not
    // '', and the callers open NOTHING (exit OPENER_REFUSED_EXIT): with no token this
    // helper cannot check what answers, and the plain address would hand whatever
    // does the sign-in cookie (#2007 used to open the plain url here, with this note).
    if (e && e.code !== 'ENOENT') {
      process.stderr.write('kosmos-open-board: board.token exists but could not be read (' + (e.code || (e && e.message) || e) + '), so this computer cannot check that Kosmos is what answers; nothing was opened. Opening Kosmos again in a minute usually works.\n');
      return null;
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
      // kosmos#6464: the board never redirects the mint, and fetch would carry the board token to wherever a
      // listener pointed it, past the proof. 'manual': the 3xx comes back as a failed mint (not r.ok), never followed.
      redirect: 'manual',
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

/* #1765: before the board token goes to the mint, the listener on the port proves it already holds that token
 * (app/engine/boardproof.js: an HMAC over a fresh random nonce, checked here with our own copy). Every account on a
 * Windows computer uses the same port, so whatever answers there is not always this account's board.
 *
 * When the check does not pass, NOTHING is opened (resolveOpenUrl returns null), not even the plain url: a browser
 * pointed at that address would hand the listener the board's sign-in cookie, which is scoped
 * to 127.0.0.1 and not to the port. install/kosmos's cmd_open refuses the same way. A boardproof module that will
 * not load cannot check, so it refuses too (the module ships beside this file's engine in every bundle).
 * `proveBoard` is the test seam: (url, token, timeoutMs) resolving a boolean or { ok, why }. */
/* The exit code that means "refused: nothing opened, no address" (#1765). Not 1, which node uses for a crash, so the
 * launcher cannot mistake one for the other (KosmosLauncher.cs OpenerRefusedExit). */
const OPENER_REFUSED_EXIT = 10;
const PROOF_TIMEOUT_MS = 7500; // half the mint's cap, as install/kosmos gives its proof half the request's -m

async function boardProven({ appDir, url, token, proveBoard }) {
  let boardproof;
  try { boardproof = require(path.join(appDir, 'engine', 'boardproof')); }
  catch (e) { return { ok: false, why: 'the check could not load (' + ((e && e.message) || e) + ')', nothingThere: false }; }
  return boardproof.checkBoard(url, token, { timeoutMs: PROOF_TIMEOUT_MS, prove: typeof proveBoard === 'function' ? proveBoard : undefined });
}

/* The sentence for a check that did not pass: a board that is not answering reads differently from a listener that
 * answered and could not prove itself. */
function refusalWords(url, r) {
  const w = String((r && r.why) || '');
  if (r && r.nothingThere) {
    return 'Kosmos did not answer the check that it is your Kosmos (' + w + '), so nothing was opened and nothing was sent. Try again in a minute.';
  }
  return 'whatever is answering at ' + url + ' could not show it is your Kosmos (' + w + '), so nothing was opened and nothing was sent to it. If Kosmos is restarting, try again in a minute.';
}

async function resolveOpenUrl({ appDir, port, timeoutMs, proveBoard }) {
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + timeoutMs;

  if (!(await waitForBoard(url, deadline))) {
    // #1765: on an enforcing board (a token on disk), an address nothing has answered for is not opened either: a
    // listener that took the connection and never answered would get the sign-in cookie.
    // kosmos#6464: only '' is no token; null (there, but unreadable) refuses too.
    if (readBoardToken(appDir) !== '') {
      process.stderr.write('kosmos-open-board: Kosmos did not answer in time, so nothing was opened. Try again in a minute.\n');
      return null;
    }
    process.stderr.write('kosmos-open-board: the board did not answer in time; opening the plain url\n');
    return url;
  }
  const token = readBoardToken(appDir);
  // kosmos#6464: a token that is there but cannot be read (null) proves nothing: open nothing (it said why).
  if (token === null) return null;
  if (!token) {
    // Non-enforcing board (or no store): the plain url authenticates fine.
    return url;
  }
  // #1765: the token goes only to a listener that proves it already holds it. Not proven: open nothing (null).
  const proof = await boardProven({ appDir, url, token, proveBoard });
  if (!proof.ok) {
    process.stderr.write('kosmos-open-board: ' + refusalWords(url, proof) + '\n');
    return null;
  }
  /* kosmos#6464: the proof covers this one mint, sent straight after it, and nothing later: the mint is never tried
   * again here (a retry would need a proof of its own). A mint that fails right after a passing proof means the
   * listener changed or misbehaved between the two, so nothing is opened: the plain address would hand whatever
   * answers there the sign-in cookie, as a failed proof would. Opening Kosmos again proves afresh. */
  const nonce = await mintNonce(url, token);
  if (!nonce) {
    process.stderr.write('kosmos-open-board: Kosmos showed it is your Kosmos but then did not sign you in, so nothing was opened. Try again in a minute.\n');
    return null;
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
  // Resolve only once the launch OUTCOME is known: 'spawn' (started - then unref so
  // the browser outlives this short-lived launcher and the console window can exit)
  // or 'error' (failed to start - PRINT the diagnostic BEFORE resolving). main()
  // awaits this, so the process cannot exit before the error message is written -
  // the race a bare unref+async-handler had, and the synchronous failure check
  // cmd_open gets from `open ... || die`. The child is returned in the result so a
  // test can still await its exit.
  return new Promise((resolve) => {
    let settled = false;
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      process.stderr.write('kosmos-open-board: could not launch the browser (' + (e && e.message || e) + '); open it yourself: ' + url + '\n');
      resolve({ child, ok: false });
    });
    child.on('spawn', () => {
      if (settled) return;
      settled = true;
      child.unref();
      resolve({ child, ok: true });
    });
  });
}

async function main() {
  // Default appDir is the zip-root layout (this script ships beside app/); the
  // .cmd passes --app explicitly, so this default only serves standalone/test use.
  const appDir = argValue('--app', path.join(__dirname, 'app'));
  const port = argValue('--port', DEFAULT_PORT);
  const timeoutMs = Number(argValue('--timeout-ms', '20000')) || 20000;
  const open = await resolveOpenUrl({ appDir, port, timeoutMs });
  // #1765: nothing showed it is this account's board (resolveOpenUrl said why): open nothing and print no address.
  // The launcher reads OPENER_REFUSED_EXIT as that refusal and shows why instead of loading anything
  // (KosmosLauncher.cs OpenerRefusedExit, ResolveBoardAddress, OpenInBrowserInstead).
  if (open === null) { process.exitCode = OPENER_REFUSED_EXIT; return; }
  // #1118: `--print-url` is Kosmos.exe's board window asking for the address to load in itself,
  // instead of a browser. It gets the RESOLVED url (nonced on an enforcing board) and nothing is
  // opened. This is the one case where stdout carries the nonce, and it is safe for the same reason
  // the browser's argv is: the launcher reads this stdout over a private pipe and never shows or
  // logs it, the nonce is single-use and short-TTL, and the durable token never leaves this process.
  // Only that flag does this; the plain run below keeps the nonce off stdout.
  if (process.argv.includes('--print-url')) {
    process.stdout.write(open + '\n');
    return;
  }
  // Print the PLAIN url as the human message (mirrors cmd_open's `say "$URL"`),
  // then OPEN the resolved url (nonced on an enforcing board). Printing the plain
  // url rather than the nonced one keeps the single-use boot nonce out of any
  // captured console log - the same reason cmd_open says the plain url and opens
  // the nonce silently. Await the open so a launch failure's diagnostic is written
  // before the process exits.
  process.stdout.write(`http://127.0.0.1:${port}\n`);
  await openInBrowser(open);
}

// Exported for the test; only run when invoked directly (mirrors the repo's
// require-vs-run idiom so a test can drive resolveOpenUrl against a fixture board).
if (require.main === module) {
  main().catch(async (e) => {
    // Never crash without opening SOMETHING: the launcher's whole job is to get a
    // browser onto the board, and the plain url is the honest worst case (the
    // pre-fix behavior). Await the open so its own diagnostic is written first.
    process.stderr.write('kosmos-open-board: ' + (e && e.message || e) + '\n');
    // #1765: on an enforcing board (a token on disk) nothing has shown it is this account's board: open nothing.
    if (readBoardToken(argValue('--app', path.join(__dirname, 'app'))) !== '') { process.exitCode = OPENER_REFUSED_EXIT; return; }
    const url = `http://127.0.0.1:${argValue('--port', DEFAULT_PORT)}`;
    process.stdout.write(url + '\n');
    // --print-url: the window loads the plain url itself; opening a browser too would be two Kosmoses.
    if (!process.argv.includes('--print-url')) await openInBrowser(url);
  });
}

module.exports = { resolveOpenUrl, readBoardToken, mintNonce, waitForBoard, openInBrowser, boardProven, refusalWords, PROOF_TIMEOUT_MS, OPENER_REFUSED_EXIT };
