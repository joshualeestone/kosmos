'use strict';
/**
 * #3796 (Josh, 2026-09-25 13:57): the in-app wizard's resend is a small LINK ("Didn't get it?
 * Send again"), not a button. The too-many-asks countdown held a button with .disabled; a link
 * has no such property, so it is held with aria-disabled instead (styled dim, and the click
 * handler refuses while it is set). Lifted from the shipped page and run on a link-shaped and a
 * button-shaped element, so both keep the hold for the whole countdown and release it at zero.
 *
 *   node --test web.plus-wizard-3796.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const page = require('./test-support/page');
const HTML = fs.readFileSync('web/index.html', 'utf8');
const SCRIPT = page.scriptOf(HTML);

function world() {
  const start = SCRIPT.indexOf('function plusSetBusy');
  const end = SCRIPT.indexOf('\n}\n', SCRIPT.indexOf('function plusCountdown')) + 3;
  assert.ok(start > 0 && end > start, 'plusSetBusy / plusCountdown moved');
  const ctx = { setInterval: (fn) => { ctx.tick = fn; return 1; }, clearInterval: () => { ctx.tick = null; }, PLUS_COUNTDOWN: null };
  vm.runInNewContext('let PLUS_COUNTDOWN = null;\n' + SCRIPT.slice(start, end) + '\nthis.plusCountdown = plusCountdown;', ctx);
  return ctx;
}
const link = () => { const a = { attrs: {} }; a.setAttribute = (k, v) => { a.attrs[k] = v; }; a.removeAttribute = (k) => { delete a.attrs[k]; }; return a; };

test('#3796 a resend LINK is held (aria-disabled) for the whole countdown and released at zero', () => {
  const w = world(); const a = link(); const line = { textContent: '' };
  w.plusCountdown(line, a, 'you can ask again in 3 seconds', 3);
  assert.equal(a.attrs['aria-disabled'], 'true', 'the link is not held during the cooldown');
  assert.ok(!('disabled' in a), 'a link grew a disabled property, so the busy test no longer tells link from button');
  w.tick(); w.tick();
  assert.equal(a.attrs['aria-disabled'], 'true', 'released before zero');
  w.tick();
  assert.ok(!('aria-disabled' in a.attrs), 'the link was not released at zero');
  assert.match(line.textContent, /ask for a code again now/);
});

test('#3796 CONTROL: a BUTTON is still held with .disabled, as before', () => {
  const w = world(); const b = { disabled: false }; const line = { textContent: '' };
  w.plusCountdown(line, b, 'you can ask again in 1 second', 1);
  assert.equal(b.disabled, true);
  w.tick();
  assert.equal(b.disabled, false);
});

test('#3796 the resend is a "Send again" link whose click refuses while held', () => {
  assert.match(HTML, /<p class="plus-si-small">Didn't get it\? <a id="plus-si-code-resend" class="plus-signin-link" href="#">Send again<\/a><\/p>/);
  assert.match(SCRIPT, /getElementById\('plus-si-code-resend'\)\.addEventListener\('click', \(e\) => \{\s*e\.preventDefault\(\);\s*if \(e\.currentTarget\.getAttribute\('aria-disabled'\) === 'true'\) return;/);
  assert.match(HTML, /#plus-state2 \.plus-signin-link\[aria-disabled="true"\] \{ opacity: \.55; pointer-events: none; \}/);
});

/* #3796 addendum 3 (Josh's live test, authenticator-only, told to wait for a text): the second step
   names the account's ONE factor. Lifted from the shipped page. */
test('#3796 the second step names the one factor the account has, and never guesses', () => {
  const start = SCRIPT.indexOf('function plusSiSecondWords');
  const end = SCRIPT.indexOf('\n}\n', start) + 3;
  assert.ok(start > 0 && end > start, 'plusSiSecondWords moved');
  const w = vm.runInNewContext(SCRIPT.slice(start, end) + '\nplusSiSecondWords');
  const totp = w('totp', '');
  assert.match(totp.lead, /authenticator app/);
  assert.doesNotMatch(totp.lead + totp.label, /text/i, 'an authenticator-only account is told about a text');
  const sms = w('sms', '\u2022\u2022\u2022 1234');
  assert.equal(sms.lead, 'Enter the code we texted to \u2022\u2022\u2022 1234.');
  assert.doesNotMatch(sms.lead + sms.label, /authenticator/i, 'a text-message account is told about an authenticator');
  const none = w('', '');
  assert.doesNotMatch(none.lead + none.label, /authenticator|text/i, 'an unknown kind guessed a factor');
  assert.doesNotMatch(HTML, /Open your authenticator app, or check your phone for a text|or the one we texted you/, 'the either-factor copy is back');
});

/* #3796 addenda 5 and 6 (Josh typed "MacbookPro..." and was refused for capitals): the in-app name
   fields are cleaned as typed, like login.kosmosplus.com's (#3791). Lifted from the shipped page. */
test('#3796 the in-app name is cleaned as typed: capitals lowercased, spaces to hyphens, nothing refused for case', () => {
  const start = SCRIPT.indexOf('function plusNameClean');
  const end = SCRIPT.indexOf('\n}\n', start) + 3;
  assert.ok(start > 0 && end > start, 'plusNameClean moved');
  const clean = vm.runInNewContext(SCRIPT.slice(start, end) + '\nplusNameClean');
  const rule = /^[a-z0-9-]{3,32}$/;
  assert.equal(clean('MacbookPro'), 'macbookpro');
  assert.ok(rule.test(clean('MacbookPro')), 'a capitalised name is still refused');
  assert.equal(clean("Josh's MacBook Pro"), 'joshs-macbook-pro');
  assert.equal(clean(' my_mac'), 'my-mac', 'a leading space became a leading hyphen');
  assert.equal(clean('x'.repeat(40)).length, 32);
  for (const id of ['plus-si-name', 'plus-name']) assert.ok(SCRIPT.includes("'" + id + "'") && /for \(const id of \['plus-si-name', 'plus-name'\]\)/.test(SCRIPT), id + ' is not cleaned as typed');
  assert.doesNotMatch(HTML, /lowercase letters, digits/, 'a hint still says names must be lowercase');
});

/* kosmos#3842: the in-app address fields start with a private suggestion (the website's rule). */
test('#3842 the suggestion generator: 8 characters, never a look-alike, and not the same twice', () => {
  const start = SCRIPT.indexOf("const PLUS_NAME_ALPHABET");
  const end = SCRIPT.indexOf('\n}\n', SCRIPT.indexOf('function plusNameSuggest')) + 3;
  assert.ok(start > 0 && end > start, 'plusNameSuggest moved');
  const gen = vm.runInNewContext(SCRIPT.slice(start, end) + '\nplusNameSuggest', { crypto: require('node:crypto').webcrypto, Uint8Array, Math });
  const seen = new Set();
  for (let i = 0; i < 500; i++) { const n = gen(); assert.match(n, /^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/, n); seen.add(n); }
  assert.equal(seen.size, 500, 'the generator repeats');
  assert.match(SCRIPT, /plusNamePrefill\('plus-si-name', 'plus-si-name-suggested'\);/, 'the wizard chooser is not prefilled');
  assert.match(SCRIPT, /plusNamePrefill\('plus-name'\);/, 'the enrol flow is not prefilled');
});
