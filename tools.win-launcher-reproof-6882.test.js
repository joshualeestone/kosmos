'use strict';
/**
 * #6882 (#6464 ask 3): the Windows board window proves the board again before it reuses its sign-in.
 *
 *   node --test tools.win-launcher-reproof-6882.test.js
 *
 * The window's web profile keeps the board's sign-in cookie, scoped to 127.0.0.1 and not to the port, so every later
 * request to the board's address carries it to whatever answers there then. Before #6882 the board was proven only
 * when the window first resolved its address (the opener, #1765). Now:
 *   - the navigations the window starts itself (a crashed page's reload, F5 and the other reload keys, a failed
 *     board load's one retry) are proved BEFORE they start (CheckNavigationAgain); a sign-in load is proved by the
 *     opener just before it;
 *   - every board navigation is held in OnNavigationStarting until a check says its page may be shown. Measured on
 *     the Windows box: WebView2 has already sent the request by then, so this guards what is shown, not what is sent;
 *   - a board load that failed is checked, and shows why instead of WebView2's error page when the board does not prove;
 *   - "open Kosmos again" with no signed-in address checks before the open page is left talking to the port;
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

test('#6882: every navigation to the board is held until a check says its page may be shown', () => {
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
    // no board page loads while the window shows why or starts over (Back to one in the history)
    'if (boardNotConfirmed || !navigatedToBoard) return;',
    'bool checkedAlready = (boardRedirect != 0 && boardNavs.ContainsKey(boardNav)) || (navigationApproved != null && navigationApproved == uri)',
    // a sign-in load the opener proved a moment ago goes: held and replayed, its spent ?boot= code would sign nobody in
    '|| (signInLoadApproved && KosmosLauncher.IsSignInLoad(uri));',
    'navigationApproved = null;', 'signInLoadApproved = false;',
    'KosmosLauncher.NavigationDecision(KosmosLauncher.CheckBoardBeforeReuse(port, KosmosLauncher.ReuseQuickCheckMs))',
    'if (step == KosmosLauncher.NavigationStep.Refuse) { BeginInvoke(new Action(ShowNotConfirmed)); return; }',
    'if (step == KosmosLauncher.NavigationStep.CheckAgain) { string waiting = uri; BeginInvoke(new Action(() => CheckNavigationAgain(waiting))); return; }',
    'args.put_Cancel(0);'], 'the navigation check');
  assert.equal((SOURCE.match(/put_Cancel\(0\)/g) || []).length, 1, 'something else lets a cancelled navigation go');
  // The quick check waits on the window's own thread, so it is short; the full one has the opener's own budget.
  const quick = Number((SOURCE.match(/internal const int ReuseQuickCheckMs = (\d+);/) || [])[1]);
  const full = Number((SOURCE.match(/internal const int ReuseProofTimeoutMs = (\d+);/) || [])[1]);
  const opener = fs.readFileSync(path.join(REPO, 'tools', 'kosmos-open-board.js'), 'utf8');
  assert.equal(full, Number(opener.match(/const PROOF_TIMEOUT_MS = (\d+);/)[1]), 'the full check refuses a board the opener\'s own check would pass');
  assert.ok(quick > 0 && quick <= 2000 && quick < full, 'the quick check can freeze the window for ' + quick + ' ms');
  // A page that is not the board's reloads as before; a board page's reload is proved first (the test below).
  assert.match(method('internal void OnProcessFailed(ICoreWebView2ProcessFailedEventArgs args)'), /webView\.Reload\(\)/);
  assert.match(SOURCE, /webView\.add_NavigationStarting\(new NavigationStarting\(this\), out token\);/, 'the check never hears a navigation');
  assert.match(SOURCE, /public class NavigationStarting : ICoreWebView2NavigationStartingEventHandler\n\{[\s\S]*?try \{ form\.OnNavigationStarting\(args\); \}/);
});

test('#6882: a navigation the quick check could not settle waits for the full check, then goes once or shows why', () => {
  const again = method('void CheckNavigationAgain(string uri)');
  inOrder(again, ['navigationWaiting = uri;', 'navigationWaitingVisit = boardVisit;', 'if (navigationCheckInFlight) return;', 'navigationCheckInFlight = true;', 'int visit = boardVisit;',
    'ThreadPool.QueueUserWorkItem', 'KosmosLauncher.CheckBoardPatiently(boardPort, KosmosLauncher.ReuseProofTimeoutMs, KosmosLauncher.ReuseWaitForBoardMs)',
    'navigationCheckInFlight = false;', 'string waiting = navigationWaiting;',
    'if (waiting == null || navigationWaitingVisit != boardVisit || mode == KosmosLauncher.ComputerMode.Connect || webView == null) { navigationWaiting = null; return; }',
    // one that came on a later visit than this check is checked for itself, never dropped
    'if (visit != boardVisit) { CheckNavigationAgain(waiting); return; }',
    'navigationWaiting = null;',
    'if (!KosmosLauncher.MayNavigateSignedIn(check)) { ShowNotConfirmed(); return; }',
    // approved, or the re-issued navigation would meet a slow quick check again and wait for ever
    'webView.get_Source(out onScreen);', 'signInLoadApproved = KosmosLauncher.IsSignInLoad(waiting);',
    // a reload of the document on screen is a Reload (a Navigate to it would load nothing), approved as what loads
    'if (KosmosLauncher.SameDocument(onScreen, waiting)) { navigationApproved = onScreen; webView.Reload(); }',
    'else { navigationApproved = waiting; webView.Navigate(waiting); }'], 'the full check of a navigation');
  // get_Source sits in ICoreWebView2's own slot for it (WebView2.h: its second method).
  const coreAt = SOURCE.indexOf('public interface ICoreWebView2\n{');
  assert.notEqual(coreAt, -1);
  assert.ok(SOURCE.slice(coreAt).startsWith('public interface ICoreWebView2\n{\n    void get_Settings(out ICoreWebView2Settings settings);\n    void get_Source([MarshalAs(UnmanagedType.LPWStr)] out string uri);'),
    'get_Source is not ICoreWebView2\'s second method');
  // The full check waits for a board restarting as long as the opener waits for the board.
  const opener = fs.readFileSync(path.join(REPO, 'tools', 'kosmos-open-board.js'), 'utf8');
  assert.equal(Number((SOURCE.match(/internal const int ReuseWaitForBoardMs = (\d+);/) || [])[1]), Number(opener.match(/argValue\('--timeout-ms', '(\d+)'\)/)[1]),
    'the window gives up on a restarting board sooner, or later, than the opener does');
  assert.match(method('void CheckThenShowNotConfirmed(Func<KosmosLauncher.ReuseCheck, bool> mayStay)'),
    /KosmosLauncher\.CheckBoardPatiently\(boardPort, KosmosLauncher\.ReuseProofTimeoutMs, KosmosLauncher\.ReuseWaitForBoardMs\)/, 'a failed load during a restart is refused without waiting for the board');
  // A board navigation that goes replaces the one waiting.
  assert.match(method('internal void OnNavigationStarting(ICoreWebView2NavigationStartingEventArgs args)'), /args\.put_Cancel\(0\);\s*navigationWaiting = null;/);
});

test('#6882: the reloads the window starts itself (a crashed page, F5 and the other reload keys) wait for the board to prove BEFORE they start', () => {
  // WebView2 has already sent a page's request when NavigationStarting is raised (measured), so these do not rely on it.
  const failed = method('internal void OnProcessFailed(ICoreWebView2ProcessFailedEventArgs args)');
  inOrder(failed, ['committedPage = null;', 'string onScreen = BoardPageOnScreen();',
    'if (onScreen != null) { BeginInvoke(new Action(() => CheckNavigationAgain(onScreen))); return; }',
    'webView.Reload();'], 'the crashed page\'s reload');
  const onScreen = method('string BoardPageOnScreen()');
  inOrder(onScreen, ['if (mode == KosmosLauncher.ComputerMode.Connect || !navigatedToBoard || boardNotConfirmed || webView == null) return null;',
    'webView.get_Source(out onScreen);', 'return KosmosLauncher.IsBoardAddress(onScreen, port) ? onScreen : null;'], 'BoardPageOnScreen');
  const keys = method('internal void OnAcceleratorKeyPressed(ICoreWebView2AcceleratorKeyPressedEventArgs args)');
  inOrder(keys, ['args.get_KeyEventKind(out kind);',
    'if (kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN && kind != COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN) return;',
    'args.get_VirtualKey(out key);', 'KosmosLauncher.GetKeyState(KosmosLauncher.VirtualKeyControl) & 0x8000',
    'KosmosLauncher.GetKeyState(KosmosLauncher.VirtualKeyAlt) & 0x8000', 'if (!KosmosLauncher.IsReloadKey(key, control, alt)) return;', 'string onScreen = BoardPageOnScreen();', 'if (onScreen == null) return;',
    'args.put_Handled(1);', 'CheckNavigationAgain(onScreen);'], 'the reload keys');
  assert.match(SOURCE, /controller\.add_AcceleratorKeyPressed\(new AcceleratorKeyPressed\(this\), out token\);/, 'the window never hears a reload key');
  assert.match(SOURCE, /public class AcceleratorKeyPressed : ICoreWebView2AcceleratorKeyPressedEventHandler\n\{[\s\S]*?try \{ form\.OnAcceleratorKeyPressed\(args\); \}/);
  // WebView2.h 1.0.4191.47: the ids and the method order, as the header declares them (a declaration out of order
  // calls the wrong method with no compile error).
  assert.match(SOURCE, /\[ComImport, Guid\("b29c7e28-fa79-41a8-8e44-65811c76dcb2"\), InterfaceType\(ComInterfaceType\.InterfaceIsIUnknown\)\]\npublic interface ICoreWebView2AcceleratorKeyPressedEventHandler\n\{\n    \[PreserveSig\] int Invoke\(ICoreWebView2Controller sender, ICoreWebView2AcceleratorKeyPressedEventArgs args\);\n\}/);
  const argsAt = SOURCE.indexOf('[ComImport, Guid("9f760f8a-fb79-42be-9990-7b56900fa9c7"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]\npublic interface ICoreWebView2AcceleratorKeyPressedEventArgs\n{');
  assert.notEqual(argsAt, -1, 'the key args interface id moved');
  const argsBody = SOURCE.slice(argsAt, SOURCE.indexOf('\n}\n', argsAt));
  assert.deepEqual(argsBody.split('\n').map((l) => l.match(/^\s+void (?:_unused_)?(\w+)\(/)).filter(Boolean).map((m) => m[1]),
    ['get_KeyEventKind', 'get_VirtualKey', 'get_KeyEventLParam', 'get_PhysicalKeyStatus', 'get_Handled', 'put_Handled']);
  const ctrlAt = SOURCE.indexOf('public interface ICoreWebView2Controller\n{');
  const ctrl = SOURCE.slice(ctrlAt, SOURCE.indexOf('\n}\n', ctrlAt)).split('\n').map((l) => l.match(/^\s+void (?:_unused_)?(\w+)\(/)).filter(Boolean).map((m) => m[1]);
  assert.equal(ctrl.indexOf('add_AcceleratorKeyPressed'), 16, 'add_AcceleratorKeyPressed is not ICoreWebView2Controller\'s 17th method');
  assert.match(SOURCE, /    void add_AcceleratorKeyPressed\(ICoreWebView2AcceleratorKeyPressedEventHandler eventHandler, out long token\);/);
});

test('#6882: the window\'s own sign-in loads are approved once, as the opener proved the board for them a moment ago', () => {
  inOrder(method('void NavigateToBoard()'), ['navigatedToBoard = true;', 'signInLoadApproved = true;', 'webView.Navigate(boardAddress);'], 'the first load');
  inOrder(method('internal void SignInAgain(string keepPage = null)'), ['if (fresh != null && fresh.Contains("?boot=")) signInLoadApproved = true;',
    'if (fresh != null && fresh.Contains("?boot=") && webView != null) webView.Navigate('], 'a sign-in again');
  assert.match(method('void ShowNotConfirmed()'), /signInLoadApproved = false;/);
  assert.match(method('internal static bool IsSignInLoad(string uri)'), /return uri != null && \(uri\.Contains\("\?boot="\) \|\| uri\.Contains\("&boot="\)\);/);
});

test('#6882: a board load that failed is checked, and a cancelled one is not taken for a failure', () => {
  const done = method('internal void OnNavigationCompleted(ICoreWebView2NavigationCompletedEventArgs args)');
  inOrder(done, ['bool boardNav = boardNavs.TryGetValue(navId, out failedLoad);', 'boardNavs.Remove(navId);',
    'if (boardNav && success != 0) failedLoadRetriedVisit = -1;', 'if (boardNav && success == 0)',
    'if (failure != COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED)',
    // retried once per visit through the prove-first path (a quick restart recovers by itself), never a spent sign-in code
    'if (failedLoadRetriedVisit != boardVisit && navigatedToBoard && !boardNotConfirmed && !KosmosLauncher.IsSignInLoad(failedLoad)',
    // only a load nothing answered: an aborted one is also how a download ends
    '&& KosmosLauncher.CouldNotReachBoard(failure))',
    'failedLoadRetriedVisit = boardVisit;', 'BeginInvoke(new Action(() => CheckNavigationAgain(again)));',
    'else CheckThenShowNotConfirmed(KosmosLauncher.MayNavigateSignedIn);',
    // before the early return that skips a window whose mode is not chosen yet: those load the board too
    'if (mode != KosmosLauncher.ComputerMode.Connect && mode != KosmosLauncher.ComputerMode.Run && mode != KosmosLauncher.ComputerMode.Both) return;'],
  'the failed board load');
  const later = method('void CheckThenShowNotConfirmed(Func<KosmosLauncher.ReuseCheck, bool> mayStay)');
  inOrder(later, ['int visit = boardVisit;', 'ThreadPool.QueueUserWorkItem', 'KosmosLauncher.ReuseProofTimeoutMs',
    'if (visit == boardVisit && navigatedToBoard && !mayStay(check)) ShowNotConfirmed();'], 'the failed load\'s check');
});

test('#6882: "open Kosmos again" with no signed-in address checks before it leaves the open page talking to the port', () => {
  const again = method('internal void SignInAgain(string keepPage = null)');
  inOrder(again, ['int visit = boardVisit;', 'fresh = resolveBoardAddress();',
    'if (fresh == null || !fresh.Contains("?boot=")) check = KosmosLauncher.CheckBoardBeforeReuse(port, KosmosLauncher.ReuseProofTimeoutMs);',
    'BeginInvoke(', 'if (boardNotConfirmed || visit != boardVisit)',
    'if (fresh != null && fresh.Contains("?boot=") && webView != null) webView.Navigate(',
    // the page's own sign-in (#6512) is judged more patiently than a double-click
    'else if (!KosmosLauncher.MayKeepPageOpen(check, keepPage != null)) ShowNotConfirmed();'], 'the sign-in that named no address');
  // The check is made on the sign-in's own thread, not the window's.
  assert.ok(again.indexOf('CheckBoardBeforeReuse') < again.indexOf('BeginInvoke('), 'the check runs on the window\'s thread');
  // A double-click while that sign-in is still out, with the window already showing why, is kept for its end.
  inOrder(again, ['if (boardNotConfirmed && signingInAgain) { startOverWanted = true; return; }',
    'if (boardNotConfirmed && !signingInAgain && resolveBoardAddress != null)', 'startOverWanted = false;',
    'if (startOverWanted && boardNotConfirmed) { startOverWanted = false; SignInAgain(); }'], 'the double-click during a sign-in');
  // A double-click's sign-in that came back signed in after the window showed why is loaded, as a fresh first load.
  inOrder(again, ['if (boardNotConfirmed && fresh != null && fresh.Contains("?boot=") && webView != null)',
    'boardNotConfirmed = false;', 'recheckRefused = false;', 'navigatedToBoard = false;',
    'boardAddress = KosmosLauncher.WithModeQuery(KosmosLauncher.SignInAgainAddress(fresh, keepPage, port), mode);',
    // the opener's proof may be older than the failed check: proved again before it loads
    'navigatedToBoard = true;', 'boardVisit++;', 'CheckNavigationAgain(boardAddress);'],
  'the double-click whose sign-in outlived a failed check');
});

test('#6882: the page\'s own polling is watched on the badge timer, per visit', () => {
  assert.match(method('void StartBadge()'), /badgeTimer\.Tick \+= \(sender, args\) => \{ RefreshBadge\(\); WatchBoard\(\); RecoverBoard\(\); \};/, 'nothing watches the page\'s polling, or brings the window back');
  const watch = method('void WatchBoard()');
  inOrder(watch, ['if (mode == KosmosLauncher.ComputerMode.Connect || !navigatedToBoard || boardNotConfirmed || watchInFlight) return;',
    'watchInFlight = true;', 'int visit = boardVisit;', 'ThreadPool.QueueUserWorkItem', 'KosmosLauncher.CheckBoardBeforeReuse(boardPort, KosmosLauncher.ReuseProofTimeoutMs)',
    'watchInFlight = false;', 'if (visit != boardVisit) return;',
    'bool show = KosmosLauncher.WatchShowsNotConfirmed(check, watchNoAnswers);',
    'watchNoAnswers = check == KosmosLauncher.ReuseCheck.NoAnswer ? watchNoAnswers + 1 : 0;',
    'if (show && BoardPageOnScreen() != null) ShowNotConfirmed();'], 'the watch');
});

test('#6882: a window its own check took off the board comes back by itself once the board proves, capped until a board read works', () => {
  const back = method('void RecoverBoard()');
  inOrder(back, ['!boardNotConfirmed || !recheckRefused || recoveryInFlight || signingInAgain', 'autoRecoveries >= KosmosLauncher.AutoRecoveriesLimit) return;',
    'recoveryInFlight = true;', 'int visit = boardVisit;', 'ThreadPool.QueueUserWorkItem', 'KosmosLauncher.CheckBoardBeforeReuse(boardPort, KosmosLauncher.ReuseProofTimeoutMs)',
    'recoveryInFlight = false;', 'if (visit != boardVisit || !boardNotConfirmed || !recheckRefused || signingInAgain || !KosmosLauncher.MayNavigateSignedIn(check)) return;',
    'autoRecoveries++;', 'SignInAgain();'], 'RecoverBoard');
  // Only a refusal of the window's own (ShowNotConfirmed), never the opener's; cleared when the window starts over.
  assert.match(method('void ShowNotConfirmed()'), /recheckRefused = true;/);
  assert.doesNotMatch(method('internal void BoardAddressResolved(string address)'), /recheckRefused/, 'the opener\'s refusal would retry itself');
  assert.match(method('internal void SignInAgain(string keepPage = null)'), /if \(boardNotConfirmed && !signingInAgain && resolveBoardAddress != null\)\s*\{[^}]*recheckRefused = false;/);
  assert.match(method('void RunAgentsHere()'), /recheckRefused = false;/);
  // A board read that worked (the page's badge post) resets the cap, as it resets the page-asked sign-in's.
  assert.match(method('internal void OnWebMessage(ICoreWebView2WebMessageReceivedEventArgs args)'), /signInsWithoutRead = 0;\s*autoRecoveries = 0;/);
  assert.equal(Number((SOURCE.match(/internal const int AutoRecoveriesLimit = (\d+);/) || [])[1]), 3);
});

test('#6882: a failed check shows NotConfirmedPage and forgets the board, and every start or end of a visit moves the visit on', () => {
  const show = method('void ShowNotConfirmed()');
  inOrder(show, ['if (mode == KosmosLauncher.ComputerMode.Connect || boardNotConfirmed || webView == null) return;',
    'boardNotConfirmed = true;', 'navigatedToBoard = false;', 'boardAddress = null;', 'navigationWaiting = null;', 'navigationApproved = null;',
    'boardVisit++;', 'webView.NavigateToString(KosmosLauncher.NotConfirmedPage);'], 'ShowNotConfirmed');
  // Opening Kosmos.exe again starts over from the opener, and the address it brings back navigates again
  // (NavigateToBoard does nothing while navigatedToBoard is still set).
  assert.match(method('internal void SignInAgain(string keepPage = null)'),
    /if \(boardNotConfirmed && !signingInAgain && resolveBoardAddress != null\)\s*\{\s*boardNotConfirmed = false;[\s\S]*?ResolveBoardAddressInBackground\(\);/);
  inOrder(method('void NavigateToBoard()'), ['if (navigatedToBoard) return;', 'navigatedToBoard = true;', 'boardVisit++;', 'webView.Navigate(boardAddress);'], 'NavigateToBoard');
  assert.match(method('void RunAgentsHere()'), /boardNotConfirmed = false;\s*recheckRefused = false;\s*boardVisit\+\+;/, 'a check still out for the board before Run agents can act after it');
  assert.match(method('void SwitchToConnect()'), /mode = KosmosLauncher\.ComputerMode\.Connect;\s*boardVisit\+\+;/);
});

test('#6882: the check reads board.token afresh and hands it only to the proof', () => {
  const check = method('internal static ReuseCheck CheckBoardBeforeReuse(int port, int timeoutMs)');
  assert.match(check, /TaskbarBadge\.ReadBoardTokenState\(out token\)/);
  assert.equal((check.match(/\btoken\b/g) || []).length, 3, 'the token goes somewhere other than the proof: ' + check);
  assert.match(check, /BoardProof\.Check\(port, token, timeoutMs\)/);
  // Its definition, ReadBoardToken, BoardTokenOnDisk (whether it is there at all), and the check.
  assert.equal((SOURCE.match(/ReadBoardTokenState\(out /g) || []).length, 4, 'board.token is read somewhere new');
  assert.match(method('internal static bool BoardTokenOnDisk()'), /return ReadBoardTokenState\(out token\) != TokenOnDisk\.None;/);
  // A page the person moves on to (in the window, not the board) replaces a board navigation waiting for its check.
  assert.match(method('internal void OnNavigationStarting(ICoreWebView2NavigationStartingEventArgs args)'),
    /if \(decided == KosmosLauncher\.ConnectLink\.InApp\) \{ connectInWindow\[navId\] = uri; if \(!KosmosLauncher\.IsBoardAddress\(uri, port\)\) navigationWaiting = null; return; \}/);
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
    assert.match(text, /open Kosmos from the Start menu again in a minute/, name + ' no longer says what to do');
  }
  assert.match(page, /so this window is not showing it\./);
  assert.match(box, /so it did not open your browser\./);
});

test('#6985: the window and its browser fallback send a person to the Start menu, never to Kosmos.exe', () => {
  for (const name of ['NotConfirmedPage', 'BrowserUnknownMessage', 'BrowserNotConfirmedMessage']) {
    const text = constText(name);
    assert.match(text, /open Kosmos from the Start menu again in a minute\./, name + ' does not say the Start menu, as the READ ME does');
    assert.doesNotMatch(text, /Kosmos\.exe/, name + ' still names Kosmos.exe, which after the install reads as the extracted folder');
    assert.doesNotMatch(text, /\u2014|\\u2014/, name + ' has an em dash');
  }
  // Start menu alone is right only because the shortcut is there before any of these can show: the window is
  // started in one place, Main, and only after RunInstallerDuties, whose every carry-on path refreshes the shortcut.
  assert.equal((SOURCE.match(/BoardWindowStartInfo\(here\)/g) || []).length, 1, 'the window is started somewhere new');
  const main = SOURCE.slice(SOURCE.indexOf('static int Main(string[] args)'));
  assert.ok(main.indexOf('RunInstallerDuties(here, node, port)') !== -1, 'Main no longer runs the installer duties');
  assert.ok(main.indexOf('RunInstallerDuties(here, node, port)') < main.indexOf('BoardWindowStartInfo(here)'), 'the window starts before the Start menu shortcut is refreshed');
  assert.match(SOURCE, /refreshWindowsRegistration\(here\);\s*return null;/, 'the installer duties carry on without refreshing the shortcut');
});

/* ---- the probe ------------------------------------------------------------- */

const PROBE = `
using System;
class ReproofProbe {
  static int Main(string[] a) {
    switch (a[0]) {
      case "check": {
        int timeout = a[2] == "window" ? KosmosLauncher.ReuseProofTimeoutMs : a[2] == "quick" ? KosmosLauncher.ReuseQuickCheckMs : int.Parse(a[2]);
        Console.Write(KosmosLauncher.CheckBoardBeforeReuse(int.Parse(a[1]), timeout));
        break;
      }
      case "keys": {
        foreach (string k in a[1].Split(',')) { string[] p = k.Split(':'); Console.Write(KosmosLauncher.IsReloadKey(Convert.ToUInt32(p[0], 16), p[1].Contains("ctrl"), p[1].Contains("alt")) ? "1" : "0"); }
        break;
      }
      case "reach": foreach (string v in a[1].Split(',')) Console.Write(KosmosLauncher.CouldNotReachBoard(int.Parse(v)) ? "1" : "0"); break;
      case "resolve": { string r = KosmosLauncher.ResolveBoardAddress(a[1], a[2], a[3], a[4], int.Parse(a[5])); Console.Write(r == KosmosLauncher.NotConfirmed ? "<notconfirmed>" : r); break; }
      case "same": Console.Write(KosmosLauncher.SameDocument(a[1] == "null" ? null : a[1], a[2]) ? "1" : "0"); break;
      case "patient": Console.Write(KosmosLauncher.CheckBoardPatiently(int.Parse(a[1]), KosmosLauncher.ReuseProofTimeoutMs, int.Parse(a[2]))); break;
      case "answer": {
        string token = new System.IO.StreamReader(Console.OpenStandardInput(), new System.Text.UTF8Encoding(false)).ReadToEnd();
        Console.Write(BoardProof.Check(int.Parse(a[1]), token, int.Parse(a[2])));
        break;
      }
      case "rules": {
        foreach (KosmosLauncher.ReuseCheck c in Enum.GetValues(typeof(KosmosLauncher.ReuseCheck)))
          Console.Write(c + ":" + KosmosLauncher.NavigationDecision(c) + ":" + (KosmosLauncher.MayNavigateSignedIn(c) ? 1 : 0)
            + (KosmosLauncher.MayKeepPageOpen(c, false) ? 1 : 0) + (KosmosLauncher.MayKeepPageOpen(c, true) ? 1 : 0)
            + (KosmosLauncher.WatchShowsNotConfirmed(c, 0) ? 1 : 0) + (KosmosLauncher.WatchShowsNotConfirmed(c, KosmosLauncher.WatchNoAnswersLimit - 2) ? 1 : 0)
            + (KosmosLauncher.WatchShowsNotConfirmed(c, KosmosLauncher.WatchNoAnswersLimit - 1) ? 1 : 0) + "\\n");
        Console.Write("limit:" + KosmosLauncher.WatchNoAnswersLimit + "\\n");
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
    // A busy board: the proof answers, but only after delayMs.
    if (o.delayMs && !req.kosmosDelayed) { req.kosmosDelayed = true; setTimeout(() => answer(req, res), o.delayMs); return; }
    answer(req, res);
  });
  function answer(req, res) {
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
  }
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

test('#6882: the rules, over every way a check can come out', WINDOWS_ONLY, async (t) => {
  if (!needsProbe(t)) return;
  // After the quick check : after the full check, navigate | keep the page on a double-click | keep it when the page
  // asked | the watch stops it on a first no-answer | with limit-2 before it | with limit-1 before it (this one the limit-th).
  assert.equal(await probeAsync(['rules']), [
    'Proved:Go:111000',                  // the board proved: go on
    'NotEnforcing:Go:111000',            // no board.token: the board issued no sign-in to protect
    'NoListener:CheckAgain:011000',      // nothing on the port: a page may wait for it, a navigation may not race a squatter for it
    'NoAnswer:CheckAgain:001001',        // held open: a busy board or a stalling squatter; only the page-asked sign-in waits; the watch at the limit
    'NotProven:Refuse:000111',           // an answer that is not the proof: refused at once, everywhere
    'TokenUnreadable:CheckAgain:001000', // an enforcing board this process cannot prove now (#6464), or antivirus for a moment
    'limit:3',
  ].join('\n') + '\n');
});

test('#6882: the reload keys are F5, the Refresh key and Ctrl+R, and nothing else', WINDOWS_ONLY, async (t) => {
  if (!needsProbe(t)) return;
  // F5, Ctrl+F5, Refresh, Ctrl+R | R alone, F4, F6, Ctrl+T, Ctrl+Shift+... is Ctrl
  // AltGr+R (Ctrl+Alt+R) types a character on some layouts, so it is not a reload.
  assert.equal(await probeAsync(['keys', '74:no,74:ctrl,A8:no,52:ctrl,52:no,73:no,75:no,54:ctrl,0D:ctrl,52:ctrl+alt,74:alt']), '11110000001');
});

test('#6882: a failed load is retried only when nothing answered it (WebView2.h web error statuses)', WINDOWS_ONLY, async (t) => {
  if (!needsProbe(t)) return;
  // unknown 0, invalid response 8, aborted 9 (a download), unreachable 6, timeout 7, reset 10, disconnected 11, cannot connect 12, cancelled 14, redirect failed 15
  assert.equal(await probeAsync(['reach', '0,8,9,6,7,10,11,12,14,15']), '0001111100');
});

test('#6882: an opener that names no address while board.token is there but unreadable is NotConfirmed, never the plain address (#6464)', WINDOWS_ONLY, async (t) => {
  if (!needsProbe(t)) return;
  const crashing = path.join(SANDBOX, 'crashing-opener.js');
  fs.writeFileSync(crashing, 'process.exit(1);\n');
  const app = fs.mkdtempSync(path.join(SANDBOX, 'app-'));
  assert.equal(await probeAsync(['resolve', REPO, process.execPath, crashing, app, '1'], dataWith('folder')), '<notconfirmed>');
  // CONTROL: with no board.token at all (a board that enforces nothing), the plain address, as before.
  assert.equal(await probeAsync(['resolve', REPO, process.execPath, crashing, app, '1'], dataWith(null)), 'http://127.0.0.1:1');
});

test('#6882: the same document is the address without its fragment', WINDOWS_ONLY, async (t) => {
  if (!needsProbe(t)) return;
  const same = (x, y) => probeAsync(['same', x, y]);
  assert.equal(await same('http://127.0.0.1:1/#a', 'http://127.0.0.1:1/#b'), '1');
  assert.equal(await same('http://127.0.0.1:1/?t=x', 'http://127.0.0.1:1/?t=x#b'), '1');
  assert.equal(await same('http://127.0.0.1:1/?t=x', 'http://127.0.0.1:1/?t=y'), '0');
  assert.equal(await same('http://127.0.0.1:1/a', 'http://127.0.0.1:1/b#a'), '0');
  assert.equal(await same('null', 'http://127.0.0.1:1/'), '0');
});

test('#6882: a board too busy for the quick check waits for the full one, which it passes, and is never refused for it', WINDOWS_ONLY, async (t) => {
  if (!needsProbe(t)) return;
  const env = dataWith(TOKEN);
  const slow = await switchable(0, { delayMs: 2500 });
  try {
    const t0 = Date.now();
    assert.equal(await probeAsync(['check', String(slow.port), 'quick'], env), 'NoAnswer', 'a board slower than the quick check read as something else');
    assert.ok(Date.now() - t0 < 2500, 'the quick check waited past its bound, freezing the window: ' + (Date.now() - t0) + ' ms');
    assert.equal(await probeAsync(['check', String(slow.port), 'window'], env), 'Proved', 'a board slower than the quick check but inside the opener\'s budget was refused');
    assert.deepEqual(slow.carriedToken(), []);
  } finally { await slow.close(); }
});

test('#6882: the full check waits out a board restarting (and a board.token held for a moment), but not a listener that does not prove', WINDOWS_ONLY, async (t) => {
  if (!needsProbe(t)) return;
  // The board is away when the check starts and back on its own port about 3 s later: the check waits for it.
  const port = await freePort();
  const env = dataWith(TOKEN);
  let back = null;
  const comes = setTimeout(async () => { back = await switchable(port); }, 3000);
  try {
    const t0 = Date.now();
    assert.equal(await probeAsync(['patient', String(port), '12000'], env), 'Proved', 'a board restarting under a reload was refused instead of waited for');
    assert.ok(Date.now() - t0 >= 2500, 'CONTROL: the check proved before the board was back');
  } finally { clearTimeout(comes); if (back) await back.close(); }
  // Nothing ever comes: the wait ends, and nothing listening is the answer.
  const t1 = Date.now();
  assert.equal(await probeAsync(['patient', String(await freePort()), '3000'], env), 'NoListener');
  assert.ok(Date.now() - t1 >= 2500 && Date.now() - t1 < 3000 + 4000, 'the wait did not keep to its bound: ' + (Date.now() - t1) + ' ms');
  // board.token unreadable (a folder in its place) until it is written, about 1.5 s in: waited for too.
  const data = env.AGENT_WORKFORCE_DATA;
  const file = path.join(data, 'Kosmos', 'board.token');
  fs.rmSync(file);
  fs.mkdirSync(file);
  const board = await switchable(0);
  const fixes = setTimeout(() => { fs.rmSync(file, { recursive: true }); fs.writeFileSync(file, TOKEN); }, 1500);
  try {
    assert.equal(await probeAsync(['patient', String(board.port), '8000'], env), 'Proved', 'a board.token held for a moment was refused at once');
  } finally { clearTimeout(fixes); await board.close(); }
  // A listener that answers and does not prove is final at once: no waiting on a squatter.
  const sq = await switchable(0);
  sq.state.proving = false;
  try {
    const t2 = Date.now();
    assert.equal(await probeAsync(['patient', String(sq.port), '15000'], dataWith(TOKEN)), 'NotProven');
    assert.ok(Date.now() - t2 < 5000, 'the check waited on a squatter: ' + (Date.now() - t2) + ' ms');
    assert.equal(sq.state.seen.length, 1, 'the squatter was asked again');
  } finally { await sq.close(); }
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
