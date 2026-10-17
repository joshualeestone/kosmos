'use strict';

/**
 * #6358: the board's browser sessions end when it restarts, so an app window finds itself signed out after a
 * restart. The page tells the app (kosmosSignin: the Mac app's bridge, or { kosmosSignin: true } to the Windows
 * app's WebView2), and the app, which reads the board token itself, loads the board with ?token= again. Told at most
 * once per SIGNED_OUT_RETELL_MS, a little over the app's own once-a-minute limit, so a sign-out the app set aside is
 * told again. A browser tab has no bridge and is told nothing.
 *
 * The page's function is lifted and run; the wiring on both sides (the poll's 403 and 200 branches, the app's
 * handler and its origin check) is read from the source.
 *
 *   node --test web.signin-again-6358.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(__dirname, 'native-app', 'main.swift'), 'utf8');

function lift(src, name, open = '{') {
  const at = src.indexOf(name);
  assert.notEqual(at, -1, name + ' is gone');
  const from = src.indexOf(open, at);
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  assert.fail(name + ' never closes');
}

function page({ bridge = 'mac', throws = false, remote = false } = {}) {
  const posted = [];
  const post = (m) => { if (throws) throw new Error('no app'); posted.push(m); };
  const window = bridge === 'mac' ? { webkit: { messageHandlers: { kosmosSignin: { postMessage: post } } } }
    : bridge === 'windows' ? { chrome: { webview: { postMessage: post } } }
    : bridge === 'chrome' ? { chrome: {} }
    : {};
  const ctx = { window, Date, kplusRemote: () => remote };
  vm.createContext(ctx);
  const retell = PAGE.match(/const SIGNED_OUT_RETELL_MS = (\d+);/);
  assert.ok(retell, 'SIGNED_OUT_RETELL_MS is gone');
  vm.runInContext('var SIGNED_OUT_TOLD_AT = 0; var SIGNED_OUT_SINCE = 0; var SIGNED_OUT_RETELL_MS = ' + retell[1] + ';\n'
    + lift(PAGE, 'function signedOutTellApp('), ctx);
  return { ctx, posted, retell: Number(retell[1]) };
}

test('#6358: in the Mac app, a sign-out is told once per retell gap, and at once after the page reads the board again', () => {
  const p = page();
  p.ctx.signedOutTellApp(1000);
  p.ctx.signedOutTellApp(2000);
  assert.deepEqual(p.posted, [true], 'not on every poll: the poll repeats every few seconds');
  p.ctx.signedOutTellApp(1000 + p.retell);
  assert.deepEqual(p.posted, [true, true], 'told again after the gap: a sign-out the app set aside is not lost');
  vm.runInContext('SIGNED_OUT_TOLD_AT = 0;', p.ctx);   // what a 200 from the board does
  p.ctx.signedOutTellApp(1000 + p.retell + 1);
  assert.deepEqual(p.posted, [true, true, true], 'a later sign-out is told at once');
});

test('#6358: the retell gap is longer than the app\'s own once-a-minute limit, so a retold sign-out is not set aside again', () => {
  const gap = APP.match(/let signInAgainMinGap: TimeInterval = (\d+)/);
  assert.ok(gap, 'signInAgainMinGap is gone');
  assert.ok(page().retell > Number(gap[1]) * 1000, 'retell ' + page().retell + ' ms vs the app\'s ' + gap[1] + ' s');
});

test('#6358: the Windows app is told { kosmosSignin: true }; a browser tab or plain Chrome is told nothing; a throw breaks nothing', () => {
  const win = page({ bridge: 'windows' });
  win.ctx.signedOutTellApp(1000);
  assert.deepEqual(JSON.parse(JSON.stringify(win.posted)), [{ kosmosSignin: true }]);
  for (const bridge of ['none', 'chrome']) {
    const tab = page({ bridge });
    assert.doesNotThrow(() => tab.ctx.signedOutTellApp(1000));
    assert.equal(vm.runInContext('SIGNED_OUT_TOLD_AT', tab.ctx), 0, bridge + ': nothing was told, so nothing is marked told');
  }
  const broken = page({ throws: true });
  assert.doesNotThrow(() => broken.ctx.signedOutTellApp(1000));
});

test('#6358: a Kosmos+ page in the app window is not told and starts no stuck clock (the app signs in only its own board)', () => {
  const p = page({ remote: true });
  p.ctx.signedOutTellApp(1000);
  assert.deepEqual(p.posted, []);
  assert.equal(vm.runInContext('SIGNED_OUT_SINCE', p.ctx), 0, 'no clock, so the panel never says the app could not sign in');
});

test('#6358: the poll tells the app on a 403, and a 200 lets a later sign-out be told at once', () => {
  const at403 = PAGE.indexOf('BOARD_NEEDS_SIGNIN = (res.status === 403);');
  assert.notEqual(at403, -1, 'the poll\'s 403 line is gone');
  const next = PAGE.slice(at403, PAGE.indexOf('\n', PAGE.indexOf('\n', at403) + 1));
  assert.match(next, /if \(BOARD_NEEDS_SIGNIN && typeof signedOutTellApp === 'function'\) signedOutTellApp\(\);/, 'the 403 branch tells the app');
  const at200 = PAGE.indexOf('BOARD_NEEDS_SIGNIN = false;   // a 200 means this browser is authed');
  assert.notEqual(at200, -1, 'the poll\'s 200 line is gone');
  const after = PAGE.slice(at200, PAGE.indexOf('\n', PAGE.indexOf('\n', at200) + 1));
  assert.match(after, /SIGNED_OUT_TOLD_AT = 0;/, 'the 200 branch resets when it was told');
});

test('#6358: the app hears kosmosSignin only from its own board page, and never logs the tokenized URL', () => {
  assert.match(APP, /userContentController\.add\(SigninMessageProxy\(delegate\), name: "kosmosSignin"\)/, 'the handler is registered');
  const proxy = lift(APP, 'final class SigninMessageProxy');
  assert.match(proxy, /guard message\.frameInfo\.isMainFrame/, 'main frame only');
  assert.match(proxy, /guard owner\.isBoardOrigin\(host: origin\.host, port: origin\.port, scheme: origin\.protocol\) else \{ return \}/,
    'a page from anywhere but this board cannot make the window load the board with its token');
  assert.ok(proxy.indexOf('isBoardOrigin') < proxy.indexOf('pageSaysSignedOut'), 'the origin is checked before acting');
  const handler = lift(APP, 'func pageSaysSignedOut(');
  assert.match(handler, /signInAgainDecision\(now: now, last: lastSignInAgainAt, refused: refused, haveToken: token != nil,\s+gaveUp: signInAgainGaveUp, triesWithoutRead: signInsWithoutRead\)/,
    'throttled, and gives up on the board\'s refusal or after fruitless tries');
  const giveUp = handler.slice(handler.indexOf('case .giveUp:'), handler.indexOf('case .signIn:'));
  assert.ok(giveUp.length > 0, 'the give-up branch is gone');
  assert.doesNotMatch(giveUp, /tokenizedBoardURL/, 'giving up loads the could-not-sign-in page without the token');
  assert.match(handler, /guard computerMode != \.connect/, 'not on a connect computer');
  // Today's shape only: a log line that names the URL by these spellings. Not general coverage of every spelling.
  for (const line of handler.split('\n').filter((l) => /logLine\(/.test(l))) {
    assert.doesNotMatch(line, /\\\(url|absoluteString|\\\(page/, 'a log line must not carry the URL, which holds the token: ' + line.trim());
  }
});

test('#6358: the signed-out panel tells the app window it is being signed in, and a tab what to do', () => {
  const stuckMs = Number(PAGE.match(/const SIGNED_OUT_STUCK_MS = (\d+);/)[1]);
  const render = (window, search = '', since = 0, failedAtLoad = false, remote = false) => {
    const ctx = { window, location: { search }, URLSearchParams, Date, kplusRemote: () => remote, SIGNED_OUT_SINCE: since, SIGNED_OUT_STUCK_MS: stuckMs, SIGNIN_FAILED_AT_LOAD: failedAtLoad, onWindows: () => false, onLinux: () => false, windowsCopy: () => 'WINDOWS', linuxCopy: () => 'LINUX' };
    vm.createContext(ctx);
    vm.runInContext(lift(PAGE, 'function boardSigninHtml('), ctx);
    return ctx.boardSigninHtml();
  };
  const app = render({ webkit: { messageHandlers: { kosmosSignin: { postMessage() {} } } } });
  assert.match(app, /The app is signing this window in again/, 'the app window is told it is being signed in');
  assert.doesNotMatch(app, /Applications folder|kosmos open/, 'the app window is not sent to open the app it is in');
  const refused = render({ webkit: { messageHandlers: { kosmosSignin: { postMessage() {} } } } }, '?signin=failed');
  assert.match(refused, /Kosmos could not sign this window in\. Quit Kosmos with Command-Q, then open it again/,
    'when the board refused the app\'s sign-in, the window says what to do, not "this takes a moment"');
  assert.doesNotMatch(refused, /This takes a moment/);
  const stuck = render({ webkit: { messageHandlers: { kosmosSignin: { postMessage() {} } } } }, '', Date.now() - stuckMs - 1000);
  assert.match(stuck, /Kosmos could not sign this window in/, 'still signed out well after telling the app: the panel stops promising a moment');
  const rewritten = render({ webkit: { messageHandlers: { kosmosSignin: { postMessage() {} } } } }, '?tab=agents', 0, true);
  assert.match(rewritten, /Kosmos could not sign this window in/, 'the marker read at load holds after boot rewrote the address');
  const soon = render({ webkit: { messageHandlers: { kosmosSignin: { postMessage() {} } } } }, '', Date.now() - 5000);
  assert.match(soon, /This takes a moment/, 'a few seconds in, it is still signing in');
  const tab = render({});
  assert.match(tab, /each time it restarts or updates, and after seven days/, 'a tab is told why it is signed out');
  assert.match(tab, /This tab stays signed out until it is signed in again, and the steps are just below/, 'a tab is told first how to sign IT in');
  assert.ok(tab.indexOf('steps are just below') < tab.indexOf('Applications folder'), 'the app is the alternative, not the lead remedy');
  const kplus = render({ webkit: { messageHandlers: { kosmosSignin: { postMessage() {} } } } }, '', 0, false, true);
  assert.doesNotMatch(kplus, /The app is signing this window in|Quit Kosmos with Command-Q/, 'a Kosmos+ board in the app window is not promised an app sign-in');
  for (const [name, html] of [['app window', kplus], ['browser', render({}, '', 0, false, true)]]) {
    assert.match(html, /cannot read your agents or projects through Kosmos\+\. Press Reload\. If it stays signed out, Kosmos needs to be open on the computer it runs on/, 'Kosmos+ ' + name + ': the remedy is on the computer Kosmos runs on');
    assert.doesNotMatch(html, /kosmos open|Applications folder|each time it restarts or updates/, 'Kosmos+ ' + name + ': no terminal step, no app to open here, and a restart does not sign Kosmos+ out');
  }
  assert.match(tab, /~\/\.local\/share\/kosmos\/bin\/kosmos open<\/code> in a terminal, then press Reload/, 'and how to bring this tab back');
  assert.doesNotMatch(tab, /fix(es)? itself the next time Kosmos updates/, 'no promise that an update signs it in');
});

test('#6358: the one sentence (agents box, projects, org note) is true in the app window and in a tab', () => {
  const m = PAGE.match(/const SIGNIN_SENTENCE = platformCopy\('signinSentence', '([^']*)'\)/);
  assert.ok(m, 'SIGNIN_SENTENCE is gone');
  // A constant cannot follow the app's give-up, so it claims nothing about the app and points to the panel, which does.
  assert.match(m[1], /The not-signed-in note on the agents list says what to do\./);
  assert.doesNotMatch(m[1], /signs itself in/, 'a claim that turns false the moment the app gives up');
  assert.doesNotMatch(m[1], /;/, 'no semicolon: liftConst-based tests cut the sentence at the first one');
});

test('#6358: the stuck switch waits well past the retell plus a poll, and the give-up marker is read before boot rewrites the address', () => {
  const retell = Number(PAGE.match(/const SIGNED_OUT_RETELL_MS = (\d+);/)[1]);
  const stuck = Number(PAGE.match(/const SIGNED_OUT_STUCK_MS = (\d+);/)[1]);
  assert.ok(stuck >= retell + 30000, 'stuck ' + stuck + ' ms vs retell ' + retell + ' ms: a slow poll must not show "could not" while the app is about to sign in');
  const marker = PAGE.indexOf('let SIGNIN_FAILED_AT_LOAD =');
  const boot = PAGE.lastIndexOf('showTab(BOOT_TAB);');
  assert.ok(marker > 0 && boot > 0 && marker < boot, 'SIGNIN_FAILED_AT_LOAD is read before boot\'s showTab (which runs syncUrl)');
});

test('#6358: the give-up marker is kept for the window (a reload still says what to do) and a good read clears it', () => {
  const key = PAGE.match(/const SIGNIN_FAILED_KEY = '[^']+';/);
  const start = PAGE.indexOf('let SIGNIN_FAILED_AT_LOAD = (() => {');
  assert.ok(key && start > 0, 'the marker code is gone');
  const src = key[0] + '\n' + PAGE.slice(start, PAGE.indexOf('})();', start) + 5) + '\nSIGNIN_FAILED_AT_LOAD;';
  const load = (search, stored) => {
    const store = new Map(stored ? [[key[0].match(/'([^']+)'/)[1], '1']] : []);
    const ctx = { URLSearchParams, location: { search }, sessionStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) } };
    vm.createContext(ctx);
    return { failed: vm.runInContext(src, ctx), store };
  };
  const first = load('?signin=failed', false);
  assert.equal(first.failed, true, 'the app\'s give-up address marks the window');
  assert.equal(first.store.size, 1, 'and keeps the mark for this window');
  assert.equal(load('?tab=agents', true).failed, true, 'a reload (the address rewritten by boot) still knows it gave up');
  assert.equal(load('?tab=agents', false).failed, false, 'CONTROL: a window that never gave up is not marked');
  const at200 = PAGE.indexOf('SIGNED_OUT_TOLD_AT = 0; SIGNED_OUT_SINCE = 0;');
  assert.ok(at200 > 0, 'the 200 branch no longer resets the sign-out clock');
  const next = PAGE.slice(at200, PAGE.indexOf('\n', PAGE.indexOf('\n', at200) + 1));
  assert.match(next, /sessionStorage\.removeItem\(SIGNIN_FAILED_KEY\)/, 'a good read clears the kept mark');
});

test('#6358: a good board read (the badge post) resets the app\'s give-up and its count of fruitless sign-ins', () => {
  const said = lift(APP, 'func pageSaidWaiting(');
  assert.match(said, /boardAnsweredForSignIn\(\)/, 'without this, every app gives up after its third restart');
  const reset = lift(APP, 'func boardAnsweredForSignIn(');
  assert.match(reset, /signInAgainGaveUp = false/);
  assert.match(reset, /signInsWithoutRead = 0/);
});
