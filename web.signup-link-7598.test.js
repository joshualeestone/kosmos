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
    'https://user:pw@a.invalid/signup', 'https://a.invalid@b.invalid/signup',
    'https://a.invalid/signup x', 'https://a.invalid/"onmouseover=1', 'https://a.invalid/<b>', null, undefined, 7, {}]) {
    assert.equal(f(v), '', 'kept ' + JSON.stringify(v));
  }
});

test('#7598: the code step links the sign-up, not the pricing page, and says what a company member must not do', () => {
  const at = PAGE.indexOf('function plusSiCodeLateArm(');
  const body = PAGE.slice(at, PAGE.indexOf('\n}\n', at));
  assert.match(body, /const href = PLUS_SIGNUP_URL;/, 'the late line no longer takes the sign-up address');
  assert.doesNotMatch(body, /plus-site-link/, 'the late line still reads the pricing link');
});

test('#7598: reading the Plus state keeps the sign-up address only through the check', () => {
  const at = PAGE.indexOf('async function paintPlus(');
  const body = PAGE.slice(at, PAGE.indexOf('\n}\n', at));
  assert.match(body, /PLUS_SIGNUP_URL = plusSignupUrl\(r\.signupUrl\);/, 'paintPlus stores the address without the check');
});

/* The late line itself, run: a fake document records what the line says, and the minute passes at once. */
function lateLine(signupUrl) {
  const els = {};
  const el = (id) => (els[id] = els[id] || { id, hidden: false, value: '', textContent: '', parts: null,
    replaceChildren(...p) { this.parts = p; this.textContent = p.map((n) => n.textContent).join(''); } });
  el('plus-si-code'); el('plus-si-code-in'); el('plus-si-code-late');
  const document = { getElementById: (id) => els[id] || null,
    createTextNode: (t) => ({ textContent: t }),
    createElement: () => ({ textContent: '', href: '', id: '' }) };
  const src = PAGE.slice(PAGE.indexOf('const PLUS_SI_CODE_LATE_MS'), PAGE.indexOf("document.getElementById('plus-signin-code').addEventListener"));
  const ctx = { document, setTimeout: (fn) => { fn(); return 1; }, clearTimeout: () => {} };
  vm.runInNewContext(src + '\nPLUS_SIGNUP_URL = ' + JSON.stringify(signupUrl) + '; plusSiCodeLateArm();', ctx);
  const late = els['plus-si-code-late'];
  return { text: late.textContent, link: (late.parts || []).find((n) => 'href' in n) || null };
}

test('#7598: with a sign-up address, the line links it and says a company member stops before paying', () => {
  const got = lateLine('https://coordinator.kosmos.invalid/signup');
  assert.equal(got.link && got.link.href, 'https://coordinator.kosmos.invalid/signup');
  assert.equal(got.text, "Nothing yet? Check the address above for a typo, and look in spam. New to Kosmos+? Create an account. "
    + "Joining your company? Stop before paying: your company's plan already covers you.");
});

test('#7598: with no sign-up address, the line offers no link and no company sentence', () => {
  const got = lateLine('');
  assert.equal(got.link, null, 'a link with no address');
  assert.equal(got.text, 'Nothing yet? Check the address above for a typo, and look in spam.');
});
