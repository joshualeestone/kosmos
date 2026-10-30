'use strict';
/* kosmos#7598: the board keeps the sign-up address /api/remote names only when it is a plain https address; anything
   else leaves the code step's "Create an account" with no link rather than a wrong one. The link and its words are
   checked in the real page by docs/browser-checks/render-plus-signin-3478.js. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
function fnSource(name) {
  const at = PAGE.indexOf('function ' + name + '(');
  assert.ok(at > -1, name + ' vanished from the page');
  const stop = PAGE.indexOf('\n', at);
  return PAGE.slice(at, stop);
}
const ctx = {};
vm.runInNewContext(fnSource('plusSignupUrl') + '\nthis.plusSignupUrl = plusSignupUrl;', ctx);
const f = ctx.plusSignupUrl;

test('#7598: a plain https sign-up address is kept as it is', () => {
  assert.equal(f('https://coordinator.kosmos.invalid/signup'), 'https://coordinator.kosmos.invalid/signup');
});

test('#7598: anything else is no link', () => {
  for (const v of ['', 'http://coordinator.kosmos.invalid/signup', 'javascript:alert(1)', '/signup',
    'https://a.invalid/signup x', 'https://a.invalid/"onmouseover=1', 'https://a.invalid/<b>', null, undefined, 7, {}]) {
    assert.equal(f(v), '', 'kept ' + JSON.stringify(v));
  }
});

test('#7598: the code step links the sign-up, not the pricing page, and says what a company member must not do', () => {
  const at = PAGE.indexOf('function plusSiCodeLateArm(');
  const body = PAGE.slice(at, PAGE.indexOf('\n}\n', at));
  assert.match(body, /const href = PLUS_SIGNUP_URL;/, 'the late line no longer takes the sign-up address');
  assert.doesNotMatch(body, /plus-site-link/, 'the late line still reads the pricing link');
  assert.match(body, /Joining your company\? Create the account and stop before paying: your company\\u2019s plan already covers you\./);
});
