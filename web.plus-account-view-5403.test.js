'use strict';
/**
 * kosmos#5403: Settings > Kosmos+ "View account" opens login.kosmosplus.com/account, where Sign out everywhere and
 * Delete account moved (#5397). The sign-in home is still the address the Copy chip copies (other devices sign in
 * there) and the base the buy fallback builds on, so only View account moves.
 *
 *   node --test web.plus-account-view-5403.test.js
 *   PLUS_PAGE=<web/index.html at 48f292c05> node --test web.plus-account-view-5403.test.js   (before the change:
 *   the View account tests fail there; the Copy and buy tests pass, as the controls)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const page = require('./test-support/page');
const PAGE = fs.readFileSync(process.env.PLUS_PAGE || 'web/index.html', 'utf8');
const SCRIPT = page.scriptOf(PAGE);

function constants() {
  const ctx = {};
  vm.runInNewContext(page.liftConst(SCRIPT, 'PLUS_ACCOUNT_URL').replace(/^const /, 'var '), ctx);
  const view = SCRIPT.match(/\n\s*const PLUS_ACCOUNT_VIEW_URL = [^;]+;/);
  if (view) vm.runInNewContext(view[0].trim().replace(/^const /, 'var '), ctx);
  return ctx;
}

test('View account opens the account view, not the sign-in home', () => {
  const c = constants();
  assert.equal(c.PLUS_ACCOUNT_VIEW_URL, 'https://login.kosmosplus.com/account');
  assert.match(SCRIPT, /acct\.href = PLUS_ACCOUNT_VIEW_URL;/, 'the View account link is painted from the account view');
  assert.doesNotMatch(SCRIPT, /acct\.href = PLUS_ACCOUNT_URL;/, 'the View account link no longer opens the home');
});

test('control: Copy still copies the sign-in home, the address other devices use', () => {
  assert.equal(constants().PLUS_ACCOUNT_URL, 'https://login.kosmosplus.com/');
  assert.match(SCRIPT, /copyTextViaExec\(PLUS_ACCOUNT_URL, /);
  assert.match(SCRIPT, /navigator\.clipboard\.writeText\(PLUS_ACCOUNT_URL\)/);
});

test('control: the buy fallback still builds on the home (signin#add-computer)', () => {
  assert.match(SCRIPT, /PLUS_ACCOUNT_URL \+ 'signin#add-computer'/);
});
