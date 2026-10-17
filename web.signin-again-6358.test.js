'use strict';

/**
 * #6358: the board's browser sessions end when it restarts, so the Mac app's window finds itself signed out after
 * a restart. The page tells the app once per sign-out (kosmosSignin), and the app, which reads the board token
 * itself, loads the board with ?token= again. A browser tab has no bridge and is told nothing.
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

function page({ bridge = true, throws = false } = {}) {
  const posted = [];
  const ctx = {
    window: bridge
      ? { webkit: { messageHandlers: { kosmosSignin: { postMessage(m) { if (throws) throw new Error('no app'); posted.push(m); } } } } }
      : {},
  };
  vm.createContext(ctx);
  vm.runInContext('var SIGNED_OUT_TOLD_APP = false;\n' + lift(PAGE, 'function signedOutTellApp('), ctx);
  return { ctx, posted };
}

test('#6358: in the Mac app, a sign-out is told once, and again after the page reads the board again', () => {
  const p = page();
  p.ctx.signedOutTellApp();
  p.ctx.signedOutTellApp();
  assert.deepEqual(p.posted, [true], 'once per sign-out: the poll repeats every few seconds');
  vm.runInContext('SIGNED_OUT_TOLD_APP = false;', p.ctx);   // what a 200 from the board does
  p.ctx.signedOutTellApp();
  assert.deepEqual(p.posted, [true, true], 'a later sign-out is told again');
});

test('#6358: a browser tab (no bridge) is told nothing, and a bridge that throws breaks nothing', () => {
  const tab = page({ bridge: false });
  assert.doesNotThrow(() => tab.ctx.signedOutTellApp());
  assert.equal(vm.runInContext('SIGNED_OUT_TOLD_APP', tab.ctx), false, 'nothing was told, so nothing is marked told');
  const broken = page({ throws: true });
  assert.doesNotThrow(() => broken.ctx.signedOutTellApp());
});

test('#6358: the poll tells the app on a 403, and a 200 lets a later sign-out be told', () => {
  const at403 = PAGE.indexOf('BOARD_NEEDS_SIGNIN = (res.status === 403);');
  assert.notEqual(at403, -1, 'the poll\'s 403 line is gone');
  const next = PAGE.slice(at403, PAGE.indexOf('\n', PAGE.indexOf('\n', at403) + 1));
  assert.match(next, /if \(BOARD_NEEDS_SIGNIN\) signedOutTellApp\(\);/, 'the 403 branch tells the app');
  const at200 = PAGE.indexOf('BOARD_NEEDS_SIGNIN = false;   // a 200 means this browser is authed');
  assert.notEqual(at200, -1, 'the poll\'s 200 line is gone');
  const after = PAGE.slice(at200, PAGE.indexOf('\n', PAGE.indexOf('\n', at200) + 1));
  assert.match(after, /SIGNED_OUT_TOLD_APP = false;/, 'the 200 branch resets the told flag');
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
  for (const line of handler.split('\n').filter((l) => /logLine\(/.test(l))) {
    assert.doesNotMatch(line, /\\\(url|absoluteString|\\\(page/, 'a log line must not carry the URL, which holds the token: ' + line.trim());
  }
});
