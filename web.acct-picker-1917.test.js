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
  // #1959: fillCreateAccounts now decides via the shared observed-liveness helpers
  // (acctOfferableTarget for the offer filter, acctUnknownLive in labelOf), so the
  // eval scope must include them or the function throws ReferenceError.
  const offerSrc = grab('function acctOfferableTarget(');
  const unkSrc = grab('function acctUnknownLive(');
  // #2095: fillCreateAccounts now names accounts through the shared acctPrimaryName
  // helper (which itself calls acctChosenName), so the eval scope must include both
  // or the extracted function throws ReferenceError.
  // 🔑 #2612: accountQualifiers ALSO needs acctPrimaryName now, because its key IS
  // that helper lowercased. This parenthetical used to say it needed only
  // acctChosenName, which was true when written and stopped being true in the same
  // commit that repointed the key; this file kept passing because the helper was
  // already grabbed for fillCreateAccounts' own use, so nothing failed to say so.
  const chosenNameSrc = grab('function acctChosenName(');
  const primNameSrc = grab('function acctPrimaryName(');
  const fillSrc = grab('function fillCreateAccounts(');
  const asel = { innerHTML: '' };
  const provider = { value: providerValue || 'anthropic' };
  const document = {
    getElementById: (id) => id === 'create-account' ? asel
      : id === 'create-provider' ? provider : null,
  };
  const factory = new Function('document', 'accounts', `
    ${escSrc}
    ${chosenNameSrc}
    ${primNameSrc}
    ${qualSrc}
    ${offerSrc}
    ${unkSrc}
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
