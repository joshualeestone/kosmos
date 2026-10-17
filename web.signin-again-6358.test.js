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

function page({ bridge = 'mac', throws = false } = {}) {
  const posted = [];
  const post = (m) => { if (throws) throw new Error('no app'); posted.push(m); };
  const window = bridge === 'mac' ? { webkit: { messageHandlers: { kosmosSignin: { postMessage: post } } } }
    : bridge === 'windows' ? { chrome: { webview: { postMessage: post } } }
    : bridge === 'chrome' ? { chrome: {} }
    : {};
  const ctx = { window, Date };
  vm.createContext(ctx);
  const retell = PAGE.match(/const SIGNED_OUT_RETELL_MS = (\d+);/);
  assert.ok(retell, 'SIGNED_OUT_RETELL_MS is gone');
  vm.runInContext('var SIGNED_OUT_TOLD_AT = 0; var SIGNED_OUT_RETELL_MS = ' + retell[1] + ';\n'
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
  assert.match(handler, /shouldSignInAgain\(now: now, last: lastSignInAgainAt\)/, 'throttled');
  assert.match(handler, /guard computerMode != \.connect/, 'not on a connect computer');
  // Today's shape only: a log line that names the URL by these spellings. Not general coverage of every spelling.
  for (const line of handler.split('\n').filter((l) => /logLine\(/.test(l))) {
    assert.doesNotMatch(line, /\\\(url|absoluteString|\\\(page/, 'a log line must not carry the URL, which holds the token: ' + line.trim());
  }
});
