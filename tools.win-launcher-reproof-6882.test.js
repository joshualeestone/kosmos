'use strict';
/**
 * #6882 (#6464 ask 3): the Windows board window proves the board again before it reuses its sign-in.
 *
 *   node --test tools.win-launcher-reproof-6882.test.js
 *
 * The window's web profile keeps the board's sign-in cookie, scoped to 127.0.0.1 and not to the port, so every later
 * request to the board's address carries it to whatever answers there then. Before #6882 the board was proven only
 * when the window first resolved its address (the opener, #1765). Now:
 *   - every navigation to the board (a crashed page's reload, F5, the page's own reload, the retry of a failed load)
 *     is checked in OnNavigationStarting before it leaves;
 *   - a board load that failed is checked, and shows why instead of WebView2's error page when the board does not prove;
 *   - "open Kosmos.exe again" with no signed-in address checks before the open page is left talking to the port;
 *   - the page's own polling is watched on the badge's timer;
 * and a failed check shows NotConfirmedPage, whose words (and the browser fallback's) now fit every way there.
 *
 * Two halves, as tools.win-launcher-board-proof-1765.test.js does it:
 *   - the SOURCE (every platform): each reuse site checks before it reuses, and what it does when the check fails;
 *   - a PROBE compiled beside KosmosLauncher.cs (Windows only): the check run for real against a stand-in board that
 *     STOPS PROVING between the first load and the reuse, against the real board (server.js) that stops and is
 *     replaced on its own port by a squatter, against nothing and against a listener that never answers; the three
 *     rules over every outcome; and the token on disk read as no token, unreadable, or read.
 */
require('./test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync, execFile } = require('node:child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-reproof-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');

const test = require('node:test');
const assert = require('node:assert/strict');
const boardproof = require('./engine/boardproof');
const { TOKEN_HEADERS, freePort } = require('./test-support/proof-listener-1765');

const REPO = __dirname;
const LAUNCHER = path.join(REPO, 'tools', 'windows', 'KosmosLauncher.cs');
const SOURCE = fs.readFileSync(LAUNCHER, 'utf8');
const WINDOWS_ONLY = { skip: process.platform !== 'win32' && 'the probe needs the Windows C# compiler' };
const TOKEN = 'BOARDTOKEN_reproof_6882_' + '7'.repeat(32);

function method(signature) {
  const at = SOURCE.indexOf(signature);
  assert.notEqual(at, -1, signature + ' is gone from KosmosLauncher.cs');
  const end = SOURCE.indexOf('\n    }\n', at);
  assert.notEqual(end, -1, 'the end of ' + signature + ' is gone');
  return SOURCE.slice(at, end);
}
function inOrder(text, parts, what) {
  let at = -1;
  for (const p of parts) {
    const next = text.indexOf(p, at + 1);
    assert.ok(next > at, what + ': "' + p + '" is missing or out of order');
    at = next;
  }
}
// The C# string constant's value, as written (the concatenated pieces joined).
function constText(name) {
  const at = SOURCE.indexOf('string ' + name + ' =');
  assert.notEqual(at, -1, name + ' is gone');
  const end = SOURCE.indexOf(';\n', at);
  return [...SOURCE.slice(at, end).matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).join('');
}

/* ---- the source ------------------------------------------------------------ */

test('#6882: the instrument is reading the launcher', () => {
  assert.ok(SOURCE.length > 100000, 'KosmosLauncher.cs read back only ' + SOURCE.length + ' bytes');
});

test('#6882: every navigation to the board is checked before it leaves, and cancelled when the check fails', () => {
  const nav = method('internal void OnNavigationStarting(ICoreWebView2NavigationStartingEventArgs args)');
  const gate = nav.indexOf('if (mode != KosmosLauncher.ComputerMode.Connect && KosmosLauncher.IsBoardAddress(uri, port))');
  assert.notEqual(gate, -1, 'board navigations are not gated');
  // Before anything that could let a board navigation through: the window's own pages, the link rules, the old rule.
  for (const later of ['if (runsBoard && KosmosLauncher.IsWindowOwnPage(uri)) return;', 'if (mode == KosmosLauncher.ComputerMode.Connect || runsBoard)',
    'if (KosmosLauncher.IsBoardAddress(uri, port) || KosmosLauncher.IsWindowOwnPage(uri)) return;']) {
    assert.ok(nav.indexOf(later) > gate, 'a board navigation can return before the check: ' + later);
  }
  const block = nav.slice(gate, nav.indexOf('boardNavs[boardNav] = uri;', gate));
  inOrder(block, ['args.put_Cancel(1);',
    'if (!KosmosLauncher.MayNavigateSignedIn(KosmosLauncher.CheckBoardBeforeReuse(port, KosmosLauncher.ReuseProofTimeoutMs)))',
    'BeginInvoke(new Action(ShowNotConfirmed));', 'return;', 'args.put_Cancel(0);'], 'the navigation check');
  assert.equal((SOURCE.match(/put_Cancel\(0\)/g) || []).length, 1, 'something else lets a cancelled navigation go');
  // The crashed page's reload has no path of its own: it is a navigation, so it meets the check above.
  const failed = method('internal void OnProcessFailed(ICoreWebView2ProcessFailedEventArgs args)');
  assert.match(failed, /webView\.Reload\(\)/);
  assert.match(SOURCE, /webView\.add_NavigationStarting\(new NavigationStarting\(this\), out token\);/, 'the check never hears a navigation');
  assert.match(SOURCE, /public class NavigationStarting : ICoreWebView2NavigationStartingEventHandler\n\{[\s\S]*?try \{ form\.OnNavigationStarting\(args\); \}/);
});

test('#6882: a board load that failed is checked, and a cancelled one is not taken for a failure', () => {
  const done = method('internal void OnNavigationCompleted(ICoreWebView2NavigationCompletedEventArgs args)');
  inOrder(done, ['bool boardNav = boardNavs.Remove(navId);', 'if (boardNav && success == 0)',
    'if (failure != COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED) CheckThenShowNotConfirmed(KosmosLauncher.MayNavigateSignedIn);',
    // before the early return that skips a window whose mode is not chosen yet: those load the board too
    'if (mode != KosmosLauncher.ComputerMode.Connect && mode != KosmosLauncher.ComputerMode.Run && mode != KosmosLauncher.ComputerMode.Both) return;'],
  'the failed board load');
  const later = method('void CheckThenShowNotConfirmed(Func<KosmosLauncher.ReuseCheck, bool> mayStay)');
  assert.match(later, /ThreadPool\.QueueUserWorkItem/, 'the check blocks the window');
  assert.match(later, /if \(navigatedToBoard && !mayStay\(check\)\) ShowNotConfirmed\(\);/);
});

test('#6882: "open Kosmos.exe again" with no signed-in address checks before it leaves the open page talking to the port', () => {
  const again = method('internal void SignInAgain(string keepPage = null)');
  inOrder(again, ['fresh = resolveBoardAddress();',
    'if (fresh == null || !fresh.Contains("?boot=")) check = KosmosLauncher.CheckBoardBeforeReuse(port, KosmosLauncher.ReuseProofTimeoutMs);',
    'BeginInvoke(', 'if (boardNotConfirmed) return;',
    'if (fresh != null && fresh.Contains("?boot=") && webView != null) webView.Navigate(',
    'else if (!KosmosLauncher.MayKeepPageOpen(check)) ShowNotConfirmed();'], 'the sign-in that named no address');
  // The check is made on the sign-in's own thread, not the window's.
  assert.ok(again.indexOf('CheckBoardBeforeReuse') < again.indexOf('BeginInvoke('), 'the check runs on the window\'s thread');
});

test('#6882: the page\'s own polling is watched on the badge timer, and only an answer that does not prove stops it', () => {
  assert.match(method('void StartBadge()'), /badgeTimer\.Tick \+= \(sender, args\) => \{ RefreshBadge\(\); WatchBoard\(\); \};/, 'nothing watches the page\'s polling');
  const watch = method('void WatchBoard()');
  inOrder(watch, ['if (mode == KosmosLauncher.ComputerMode.Connect || !navigatedToBoard || boardNotConfirmed || watchInFlight) return;',
    'watchInFlight = true;', 'ThreadPool.QueueUserWorkItem', 'KosmosLauncher.CheckBoardBeforeReuse(boardPort, KosmosLauncher.ReuseProofTimeoutMs)',
    'watchInFlight = false;', 'if (navigatedToBoard && KosmosLauncher.WatchShowsNotConfirmed(check)) ShowNotConfirmed();'], 'the watch');
});

test('#6882: a failed check shows NotConfirmedPage and forgets the board, so nothing reloads it until Kosmos.exe is opened again', () => {
  const show = method('void ShowNotConfirmed()');
  inOrder(show, ['if (mode == KosmosLauncher.ComputerMode.Connect || boardNotConfirmed || webView == null) return;',
    'boardNotConfirmed = true;', 'navigatedToBoard = false;', 'boardAddress = null;',
    'webView.NavigateToString(KosmosLauncher.NotConfirmedPage);'], 'ShowNotConfirmed');
  // Opening Kosmos.exe again starts over from the opener, and the address it brings back navigates again
  // (NavigateToBoard does nothing while navigatedToBoard is still set).
  assert.match(method('internal void SignInAgain(string keepPage = null)'),
    /if \(boardNotConfirmed && !signingInAgain && resolveBoardAddress != null\)\s*\{\s*boardNotConfirmed = false;[\s\S]*?ResolveBoardAddressInBackground\(\);/);
  assert.match(method('void NavigateToBoard()'), /if \(navigatedToBoard\) return;/);
});

test('#6882: the check reads board.token afresh and hands it only to the proof', () => {
  const check = method('internal static ReuseCheck CheckBoardBeforeReuse(int port, int timeoutMs)');
  assert.match(check, /TaskbarBadge\.ReadBoardTokenState\(out token\)/);
  assert.equal((check.match(/\btoken\b/g) || []).length, 3, 'the token goes somewhere other than the proof: ' + check);
  assert.match(check, /BoardProof\.Check\(port, token, timeoutMs\)/);
  // Its definition, ReadBoardToken, and the check.
  assert.equal((SOURCE.match(/ReadBoardTokenState\(out /g) || []).length, 3, 'board.token is read somewhere new (ReadBoardToken and the check only)');
  // Holds keeps its meaning for every other caller.
  assert.match(method('internal static bool Holds(int port, string token, int timeoutMs)'), /return Check\(port, token, timeoutMs\) == Answer\.Proves;/);
  // The board token is still put in a header in one place only (#1765).
  assert.equal([...SOURCE.matchAll(/Headers\[BoardTokenHeader\]\s*=/g)].length, 1);
});

test('#6882: the refusal page and the browser box say "could not sign you in", which fits every way there, with no em dash', () => {
  const page = constText('NotConfirmedPage');
  const box = constText('BrowserNotConfirmedMessage');
  for (const [name, text] of [['NotConfirmedPage', page], ['BrowserNotConfirmedMessage', box]]) {
    assert.match(text, /Kosmos could not sign you in to your own Kosmos/, name);
    assert.doesNotMatch(text, /could not confirm it was reaching/, name + ' still reads as only the opener\'s refusal');
    assert.doesNotMatch(text, /\u2014|\\u2014/, name + ' has an em dash');
    assert.match(text, /open Kosmos\.exe again in a minute/, name + ' no longer says what to do');
  }
  assert.match(page, /so this window is not showing it\./);
  assert.match(box, /so it did not open your browser\./);
});

/* ---- the probe ------------------------------------------------------------- */

const PROBE = `
using System;
class ReproofProbe {
  static int Main(string[] a) {
    switch (a[0]) {
      case "check": {
        int timeout = a[2] == "window" ? KosmosLauncher.ReuseProofTimeoutMs : int.Parse(a[2]);
        Console.Write(KosmosLauncher.CheckBoardBeforeReuse(int.Parse(a[1]), timeout));
        break;
      }
      case "answer": {
        string token = new System.IO.StreamReader(Console.OpenStandardInput(), new System.Text.UTF8Encoding(false)).ReadToEnd();
        Console.Write(BoardProof.Check(int.Parse(a[1]), token, int.Parse(a[2])));
        break;
      }
      case "rules": {
        foreach (KosmosLauncher.ReuseCheck c in Enum.GetValues(typeof(KosmosLauncher.ReuseCheck)))
          Console.Write(c + ":" + (KosmosLauncher.MayNavigateSignedIn(c) ? 1 : 0) + (KosmosLauncher.MayKeepPageOpen(c) ? 1 : 0) + (KosmosLauncher.WatchShowsNotConfirmed(c) ? 1 : 0) + "\\n");
        break;
      }
      case "token": { string t; Console.Write(TaskbarBadge.ReadBoardTokenState(out t) + ":" + (t == null ? "<null>" : t)); break; }
    }
    return 0;
  }
}
`;

let probeExe = null;
let probeDir = null;
const needsProbe = (t) => { if (!probeExe) { t.skip('no probe (not Windows, or no compiler)'); return false; } return true; };

// A data folder for the probe's board.token: `token` written as given, 'folder' for a folder in its place, null for none.
function dataWith(token) {
  const data = fs.mkdtempSync(path.join(SANDBOX, 'data-'));
  fs.mkdirSync(path.join(data, 'Kosmos'), { recursive: true });
  if (token === 'folder') fs.mkdirSync(path.join(data, 'Kosmos', 'board.token'));
  else if (token != null) fs.writeFileSync(path.join(data, 'Kosmos', 'board.token'), token);
  const env = { ...process.env, AGENT_WORKFORCE_DATA: data };
  delete env.AGENT_WORKFORCE_HOME;
  return env;
}
// Asynchronously, so a listener in this process can answer while the probe waits on it.
function probeAsync(args, env, input) {
  return new Promise((resolve, reject) => {
    const child = execFile(probeExe, args, { encoding: 'utf8', windowsHide: true, env: env || process.env, timeout: 60000 },
      (err, so, se) => (err ? reject(new Error('the probe failed: ' + err.message + so + se)) : resolve(so)));
    child.stdin.end(input || '');
  });
}

// A listener on `port` (0 for any) that answers the proof the way the real board does while `proving` is set, and like a
// squatter (200 with a proof-shaped answer that is not the proof) once it is cleared: the board stopped and something
// else holds the port, without the test having to win a race for the port. Records every request.
function switchable(port, opts) {
  const o = opts || {};
  const state = { proving: true, seen: [] };
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    state.seen.push({ url: req.url, headers: { ...req.headers } });
    const u = new URL(req.url, 'http://127.0.0.1');
    if (o.status) { res.writeHead(o.status, o.status >= 300 && o.status < 400 ? { location: 'http://127.0.0.1:1/elsewhere' } : {}); res.end('{}'); return; }
    if (state.proving && u.pathname === boardproof.PROOF_PATH) {
      const out = boardproof.answer(Object.fromEntries(u.searchParams), function* () { yield TOKEN; }, req.socket.localPort, req.socket.localAddress);
      res.writeHead(out.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out.body));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ proof: 'c'.repeat(boardproof.PROOF_HEX), counts: { waiting: 1 } }));
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port || 0, '127.0.0.1', () => resolve({
      port: server.address().port,
      state,
      carriedToken: () => state.seen.filter((r) => r.url.includes(TOKEN) || TOKEN_HEADERS.some((h) => String(r.headers[h] || '').includes(TOKEN))),
      close: () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(() => r()); }),
    }));
  });
}

test('#6882: the probe compiles beside the launcher', WINDOWS_ONLY, (t) => {
  const csc = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  if (!fs.existsSync(csc)) { t.skip('no .NET Framework compiler on this machine'); return; }
  probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-reproof-probe-'));
  fs.writeFileSync(path.join(probeDir, 'ReproofProbe.cs'), PROBE);
  const out = path.join(probeDir, 'probe.exe');
  const built = spawnSync(csc, ['/nologo', '/target:exe', '/main:ReproofProbe', '/out:' + out, LAUNCHER, path.join(probeDir, 'ReproofProbe.cs')], { encoding: 'utf8', windowsHide: true });
  assert.equal(built.status, 0, 'the probe did not compile: ' + built.stdout + built.stderr);
  probeExe = out;
});

test('#6882: the three rules, over every way a check can come out', WINDOWS_ONLY, async (t) => {
  if (!needsProbe(t)) return;
  // navigate, keep the open page, watch-stops-it
  assert.equal(await probeAsync(['rules']), [
    'Proved:110',          // the board proved: go on
    'NotEnforcing:110',    // no board.token: the board issued no sign-in to protect
    'NoListener:010',      // nothing on the port: a page may wait for it, a navigation may not race a squatter for it
    'NoAnswer:000',        // held open or cut: a squatter can look like this, so no reuse; the timer does not act (a busy board)
    'NotProven:001',       // an answer that is not the proof: no reuse, and the timer stops the page
    'TokenUnreadable:000', // an enforcing board this process cannot prove (#6464); the timer does not act (antivirus)
  ].join('\n') + '\n');
});

test('#6882: a board that proved at the first load and then STOPS proving is not reused, and never gets the token', WINDOWS_ONLY, async (t) => {
  if (!needsProbe(t)) return;
  const env = dataWith(TOKEN);
  const board = await switchable(0);
  try {
    assert.equal(await probeAsync(['check', String(board.port), 'window'], env), 'Proved', 'CONTROL: the board proves while it holds the token');
    board.state.proving = false;
    assert.equal(await probeAsync(['check', String(board.port), 'window'], env), 'NotProven', 'the board stopped proving and the check still passed');
    assert.ok(board.state.seen.length >= 2 && board.state.seen.every((r) => r.url.startsWith(boardproof.PROOF_PATH)), 'the check asked something other than the proof');
    assert.deepEqual(board.carriedToken(), [], 'the board token left this process');
  } finally { await board.close(); }
});

test('#6882: the real board (server.js) proves; once it stops, nothing listening reads as such within the window\'s bound; a squatter on its port does not prove', WINDOWS_ONLY, async (t) => {
  if (!needsProbe(t)) return;
  const env = dataWith(TOKEN);
  const { start, server, boardAuthState } = require('./server');
  await start(0);
  boardAuthState.on = true;
  boardAuthState.token = TOKEN;
  const port = server.address().port;
  try {
    assert.equal(await probeAsync(['check', String(port), 'window'], env), 'Proved', 'the real board did not prove the token it holds');
  } finally {
    if (server.closeAllConnections) server.closeAllConnections();
    await new Promise((r) => server.close(() => r()));
  }
  // The board restarting: nothing on the port. Windows takes about 2 s to refuse a loopback connection, and the window's
  // own bound must outlast that, or a restart would read as a listener holding the check open.
  const t0 = Date.now();
  assert.equal(await probeAsync(['check', String(port), 'window'], env), 'NoListener');
  assert.ok(Date.now() - t0 < 3000 + 4000, 'the check did not keep to its bound');
  // Something else takes the board's own port.
  const squatter = await switchable(port);
  squatter.state.proving = false;
  try {
    assert.equal(await probeAsync(['check', String(port), 'window'], env), 'NotProven');
    assert.deepEqual(squatter.carriedToken(), [], 'the board token reached the squatter');
  } finally { await squatter.close(); }
});

test('#6882: a listener that never answers is NoAnswer, within the bound, never NoListener', WINDOWS_ONLY, async (t) => {
  if (!needsProbe(t)) return;
  const sockets = new Set();
  const silent = http.createServer(() => { /* never answers */ });
  silent.on('connection', (s) => sockets.add(s));
  await new Promise((r) => silent.listen(0, '127.0.0.1', r));
  try {
    const t0 = Date.now();
    assert.equal(await probeAsync(['check', String(silent.address().port), '1500'], dataWith(TOKEN)), 'NoAnswer');
    assert.ok(Date.now() - t0 < 1500 + 4000, 'the check did not keep to its bound: ' + (Date.now() - t0) + ' ms');
  } finally { for (const s of sockets) s.destroy(); silent.close(); }
  // CONTROL: a free port is NoListener, so the arm above could tell them apart.
  assert.equal(await probeAsync(['check', String(await freePort()), 'window'], dataWith(TOKEN)), 'NoListener');
});

test('#6882: a refusal (404, another account\'s board) or a redirect is an answer that did not prove', WINDOWS_ONLY, async (t) => {
  if (!needsProbe(t)) return;
  for (const status of [404, 403, 307]) {
    const l = await switchable(0, { status });
    try {
      assert.equal(await probeAsync(['answer', String(l.port), '3000'], process.env, TOKEN), 'NotProven', String(status));
      assert.equal(l.state.seen.length, 1, 'a ' + status + ' was followed or retried');
    } finally { await l.close(); }
  }
});

test('#6882: board.token on disk: none and empty enforce nothing, a folder in its place is unreadable, and a read token is trimmed', WINDOWS_ONLY, async (t) => {
  if (!needsProbe(t)) return;
  assert.equal(await probeAsync(['token'], dataWith(null)), 'None:<null>');
  assert.equal(await probeAsync(['token'], dataWith('  \n')), 'None:<null>');
  assert.equal(await probeAsync(['token'], dataWith('folder')), 'Unreadable:<null>');
  assert.equal(await probeAsync(['token'], dataWith(TOKEN + '\r\n')), 'Read:' + TOKEN);
  // And what the check makes of each, against a squatter that would fail any proof.
  const sq = await switchable(0);
  sq.state.proving = false;
  try {
    assert.equal(await probeAsync(['check', String(sq.port), 'window'], dataWith(null)), 'NotEnforcing');
    assert.equal(await probeAsync(['check', String(sq.port), 'window'], dataWith('folder')), 'TokenUnreadable');
    assert.equal(await probeAsync(['check', String(sq.port), 'window'], dataWith(TOKEN)), 'NotProven', 'CONTROL: with the token, the squatter is checked');
    assert.equal(sq.state.seen.length, 1, 'the check asked the listener without a token to prove with');
  } finally { await sq.close(); }
});

test.after(() => {
  if (probeDir) fs.rmSync(probeDir, { recursive: true, force: true });
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});
