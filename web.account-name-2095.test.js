'use strict';

/**
 * #2095: the account NAME the user typed at connect time ("account1") was stored
 * (the `.kosmos-name` sidecar, served as `a.name`) but never displayed, so every
 * surface showed only the key last-4 ("API key ending NfYA") and the name was a
 * dead input control.
 *
 * These EXECUTE the real helpers extracted from web/index.html (acctPrimaryName,
 * acctHasChosenName, accountQualifiers) against fabricated accounts, so each
 * control can return the dangerous answer: a named account whose name is dropped,
 * or two same-named accounts that read alike. Slice discipline matches
 * web.acct-picker-1917.test.js: each grab runs to the first column-0 `\n}`.
 *
 *   node --test web.account-name-2095.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

function grab(sig) {
  const at = PAGE.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone from the page');
  return PAGE.slice(at, PAGE.indexOf('\n}', at) + 2);
}

/* acctPrimaryName + acctHasChosenName are pure and self-contained. */
const helpers = new Function(`
  ${grab('function acctPrimaryName(')}
  ${grab('function acctHasChosenName(')}
  return { acctPrimaryName, acctHasChosenName };
`)();
const { acctPrimaryName, acctHasChosenName } = helpers;

/* accountQualifiers is pure; it returns a Map of dir -> qualifier. */
const qualify = new Function('list', `
  ${grab('function accountQualifiers(')}
  return accountQualifiers(list);
`);

test('#2095: a named OpenAI account shows its NAME as the primary label, not the key', () => {
  const a = { provider: 'openai', keyTail: 'NfYA', name: 'account1', dir: '/x/.codex' };
  assert.equal(acctPrimaryName(a), 'account1');
  // The exact bug Josh hit: the key-tail must NOT be the primary label any more.
  assert.notEqual(acctPrimaryName(a), 'API key ending NfYA');
});

test('#2095: the key last-4 is a SECONDARY detail only when a name is present', () => {
  assert.equal(acctHasChosenName({ provider: 'openai', keyTail: 'NfYA', name: 'account1' }), true);
  assert.equal(acctHasChosenName({ provider: 'openai', keyTail: 'NfYA', name: '' }), false);
  assert.equal(acctHasChosenName({ provider: 'openai', keyTail: 'NfYA' }), false);
  // Claude accounts never carry a chosen name.
  assert.equal(acctHasChosenName({ provider: 'anthropic', email: 'a@b.com' }), false);
});

test('#2095: an UNNAMED OpenAI account still falls back to the key last-4 (unchanged)', () => {
  const a = { provider: 'openai', keyTail: 'NfYA', dir: '/x/.codex' };
  assert.equal(acctPrimaryName(a), 'API key ending NfYA');
});

test('#2095: a whitespace-only name never wins (falls through)', () => {
  const a = { provider: 'openai', keyTail: 'NfYA', name: '   ', dir: '/x/.codex' };
  assert.equal(acctPrimaryName(a), 'API key ending NfYA');
});

test('#2095: a Claude account is unchanged - email stays the primary label', () => {
  const a = { provider: 'anthropic', email: 'josh@stuff.io', dir: '/x/.claude' };
  assert.equal(acctPrimaryName(a), 'josh@stuff.io');
});

test('#2095: with neither name, email nor keyTail, falls to label then dir', () => {
  assert.equal(acctPrimaryName({ provider: 'openai', label: 'work', dir: '/x/.codex-work' }), 'work');
  assert.equal(acctPrimaryName({ provider: 'openai', dir: '/x/.codex-w' }), '/x/.codex-w');
});

test('#2095 CONTROL: two accounts typed the SAME name are counted ambiguous and each gets a distinct qualifier', () => {
  // The failure the name-aware key prevents (deferred finding 8): before #2095 the
  // key was email||keyTail, so two accounts both named "work" but with different
  // keys would render the same visible name with NO qualifier -> indistinguishable.
  const list = [
    { provider: 'openai', keyTail: 'AAAA', name: 'work', label: 'left',  dir: '/x/.codex-a', isDefault: true },
    { provider: 'openai', keyTail: 'BBBB', name: 'work', label: 'right', dir: '/x/.codex-b' },
  ];
  const q = qualify(list);
  const qa = q.get('/x/.codex-a');
  const qb = q.get('/x/.codex-b');
  // Both are qualified (non-empty) and the two qualifiers differ, so the on-screen
  // name and the accessible name stay distinct.
  assert.ok(qa, 'the default same-name account is qualified');
  assert.ok(qb, 'the second same-name account is qualified');
  assert.notEqual(qa, qb, 'the two same-name accounts get DISTINCT qualifiers');
  assert.equal(qa, 'main', 'the original account reads (main)');
});

test('#2095 CONTROL: a UNIQUE name gets no qualifier (no noise on the common case)', () => {
  const list = [
    { provider: 'openai', keyTail: 'AAAA', name: 'work',     dir: '/x/.codex-a', isDefault: true },
    { provider: 'openai', keyTail: 'BBBB', name: 'personal', dir: '/x/.codex-b' },
  ];
  const q = qualify(list);
  assert.equal(q.get('/x/.codex-a'), '');
  assert.equal(q.get('/x/.codex-b'), '');
});
