'use strict';

/**
 * #1917: two Claude accounts on ONE email rendered as two identical options in the
 * create-agent picker, so a real external tester (Ben, 0.6.22) could not tell which
 * to pick and ran his agent on the dead one for an hour. The Settings list already
 * disambiguates duplicated rows via accountQualifiers; the picker threw that away and
 * rendered by email alone.
 *
 * These EXECUTE fillCreateAccounts (extracted from the page with esc + accountQualifiers)
 * against a fabricated account list, rather than matching its source, so the control can
 * return the dangerous answer the card asks for: two accounts, same email, BOTH reading
 * `connected` (the badge cannot see a rejected token, #874/#1916), asserted distinguishable
 * WITHOUT clicking through.
 *
 *   node --test web.acct-picker-1917.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

/* Extracted and RUN. Each slice runs to the first column-0 `\n}`, which is the
   function's own close (inner braces are indented) -- the same slice discipline
   web.account-qualifier.test.js uses. */
function grab(sig) {
  const at = PAGE.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone from the page');
  return PAGE.slice(at, PAGE.indexOf('\n}', at) + 2);
}

function runFillCreate(accounts, providerValue) {
  const escSrc = grab('function esc(');
  const qualSrc = grab('function accountQualifiers(');
  const fillSrc = grab('function fillCreateAccounts(');
  const asel = { innerHTML: '' };
  const provider = { value: providerValue || 'anthropic' };
  const document = {
    getElementById: (id) => id === 'create-account' ? asel
      : id === 'create-provider' ? provider : null,
  };
  const factory = new Function('document', 'accounts', `
    ${escSrc}
    ${qualSrc}
    let CREATE_ACCOUNTS = accounts;
    ${fillSrc}
    fillCreateAccounts();
  `);
  factory(document, accounts);
  return asel.innerHTML;
}

function optionTexts(html) {
  const out = [];
  const re = /<option[^>]*>([^<]*)<\/option>/g;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

const conn = (state) => ({ state });
const claude = (over) => Object.assign({
  provider: 'anthropic', email: 'ben@example.com', label: null, isDefault: false,
  memoryShared: true, connection: conn('connected'),
}, over);

test('#1917: two Claude accounts on one email render as DISTINCT picker options, default named `main`', () => {
  // The dangerous case exactly: same email, one the original (default), one a
  // duplicate the app made on re-auth. BOTH read `connected` -- the badge cannot
  // see that one is 401'd -- so distinctness cannot come from sign-in state.
  const def = claude({ dir: '/h/.claude', isDefault: true, label: null });
  const dup = claude({ dir: '/h/.claude-work1', isDefault: false, label: 'work1' });
  const texts = optionTexts(runFillCreate([def, dup]));

  assert.equal(texts.length, 2, 'both accounts should be offered, got: ' + JSON.stringify(texts));
  assert.notEqual(texts[0], texts[1],
    'the two same-email options are still identical -- the picker gives no way to tell them apart: ' + JSON.stringify(texts));
  const withMain = texts.find((t) => /\(main\)/.test(t));
  assert.ok(withMain, 'the original (default) account is not marked `(main)`, so the user cannot tell which is the original: ' + JSON.stringify(texts));
  assert.ok(texts.some((t) => /\(work1\)/.test(t)),
    'the duplicate is not distinguished by its label: ' + JSON.stringify(texts));
  // Every option still carries the shared email, so the qualifier ADDS a
  // discriminator rather than replacing the identity.
  assert.ok(texts.every((t) => t.includes('ben@example.com')),
    'a row lost its email; the qualifier should append, not replace: ' + JSON.stringify(texts));
});

test('#1917 control: a UNIQUE email is left exactly as it was (no qualifier noise on the common case)', () => {
  const only = claude({ dir: '/h/.claude', isDefault: true, label: null });
  const texts = optionTexts(runFillCreate([only]));
  assert.equal(texts.length, 1, 'expected one option, got: ' + JSON.stringify(texts));
  assert.equal(texts[0], 'ben@example.com',
    'a single account picked up a qualifier -- the fix is meant to fire only on ambiguity: ' + JSON.stringify(texts));
  assert.doesNotMatch(texts[0], /\(main\)/, 'a lone default should not be tagged `main`');
});

test('#1917: the disabled default Disconnect names the way out (Sign in again)', () => {
  // Fix A: pressing the greyed default Disconnect used to state a pure refusal.
  // The default (~/.claude) cannot be removed (symlink hub), so when it is the
  // account whose sign-in is broken the refusal was a dead end. The pressed
  // message now points at `Sign in again`, the in-place reauth already on the row.
  const at = PAGE.indexOf('const say = (btn.title');
  assert.notEqual(at, -1, 'the disabled-default press-message assignment moved or was removed; restate this pin');
  // The remedy pointer must be part of the spoken message, within this assignment.
  const region = PAGE.slice(at, at + 300);
  assert.match(region, /Sign in again/,
    'the pressed default-Disconnect no longer points at the `Sign in again` remedy, so it is a dead end again');
  // And it must NOT have been pushed into btn.title (which stays pinned to the
  // engine `because`): the remedy is appended to the message, not the title.
  const titleAt = PAGE.indexOf('title="Kosmos does not remove this computer');
  assert.notEqual(titleAt, -1, 'the pinned default-Disconnect title moved');
  assert.doesNotMatch(PAGE.slice(titleAt, titleAt + 400), /Sign in again/,
    'the remedy leaked into the pinned title, which the engine-drift test compares against the engine sentence');
});
