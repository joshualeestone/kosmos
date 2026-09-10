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

/* acctPrimaryName + acctHasChosenName both call the shared acctChosenName, so the
   eval scope must include it. */
const helpers = new Function(`
  ${grab('function acctChosenName(')}
  ${grab('function acctPrimaryName(')}
  ${grab('function acctHasChosenName(')}
  return { acctPrimaryName, acctHasChosenName };
`)();
const { acctPrimaryName, acctHasChosenName } = helpers;

/* accountQualifiers is pure, but its KEY IS `acctPrimaryName` (kosmos#2612,
   iteration 9), so the eval scope needs that helper and the acctChosenName it
   calls, or the extracted function throws ReferenceError.
   ⚠️ THIS IS THE THIRD FILE CARRYING ITS OWN COPY OF THIS EXTRACTION, and when
   the key gained that dependency the other two were updated and this one was
   not: `web.account-qualifier.test.js` passed 44/44 while the repo was red,
   which is exactly why the FULL suite is the gate and a single file is not. */
const qualify = new Function('list', `
  ${grab('function acctChosenName(')}
  ${grab('function acctPrimaryName(')}
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
  const a = { provider: 'anthropic', email: 'josh@example.com', dir: '/x/.claude' };
  assert.equal(acctPrimaryName(a), 'josh@example.com');
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

test('#2241 (superseding the #2095 "Added" toast): the Settings OpenAI success is the gold box', () => {
  // #2241 (Josh, 0.6.35, Splinter-routed) replaced the #2095 "Added: <name>" toast for the
  // OpenAI connected state with the fixed gold check-row box ("OpenAI GPT Codex is connected. /
  // This computer is signed in."). The human-chosen name still leads the repainted list
  // (acctPrimaryName) and the Move picker -- the tests below -- which is where #2095 lives now;
  // the success surface follows the newer, explicit gold-box copy. Source-pinned (the OpenAI add
  // is inside an async fetch handler). Bounded at the NEXT handler (acct-code-go), not a fixed
  // byte count, so it survives the handler growing.
  const at = PAGE.indexOf("getElementById('acct-openai-go').addEventListener");
  assert.notEqual(at, -1, 'the OpenAI add handler is gone from the page');
  const handler = PAGE.slice(at, PAGE.indexOf("acct-code-go", at));
  assert.match(handler, /const goldBox = frCheckRow\(/,
    'the OpenAI success no longer builds the gold check-row box');
  assert.match(handler, /OpenAI GPT Codex is connected/,
    'the gold box lost its "OpenAI GPT Codex is connected" title');
  assert.match(handler, /acctShowSuccess\([\s\S]*?,\s*goldBox\)/,
    'the gold box is no longer handed to acctShowSuccess');
  assert.doesNotMatch(handler, /msg\.textContent = 'Added'/,
    'the key-only "Added" toast came back (it was superseded by the gold box)');
});

test('#2095: the Move-to account picker leads with the chosen name (source-pinned)', () => {
  // paintAccountPicker is async + DOM-heavy, so source-pin it (same approach as
  // web.connect-success-1656 and the toast pin above): both the current-account
  // "here" option and the move-to options must render through acctPrimaryName, not
  // the old email||label||dir chain (label is the path slug, not the chosen name).
  const at = PAGE.indexOf('async function paintAccountPicker(');
  assert.notEqual(at, -1, 'paintAccountPicker is gone from the page');
  const body = PAGE.slice(at, PAGE.indexOf('\n}', at) + 2);
  assert.match(body, /esc\(acctPrimaryName\(acctLive \|\| acct\)\)/,
    'the current-account "here" option no longer leads with the chosen name');
  assert.match(body, /esc\(acctPrimaryName\(x\)\)/,
    'the move-to options no longer lead with the chosen name');
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
