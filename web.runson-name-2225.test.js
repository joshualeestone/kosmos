'use strict';

/**
 * #2225 (display half): the runs-on parenthetical on the agent detail leads with
 * the human-chosen account name, falling back to the email, then the path slug.
 * The logic is extracted into the pure helper `acctParenthetical` so each
 * fallback rung is pinned directly rather than through openDetail's DOM.
 *
 * These EXECUTE the real helper grabbed from web/index.html against fabricated
 * agents, so each control can return the dangerous answer: a named account whose
 * name is dropped for the slug, or an account-less agent that still renders a
 * parenthetical.
 *
 *   node --test web.runson-name-2225.test.js
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

const acctParenthetical = new Function(`
  ${grab('function acctParenthetical(')}
  return acctParenthetical;
`)();

test('#2225: a named OpenAI account shows its NAME, not the path slug', () => {
  const a = { account: { name: 'Design Team', email: null, label: 'codex-design', dir: '/x/.codex-design' } };
  assert.equal(acctParenthetical(a), 'Design Team');
  // The exact bug: the slug must not win when a chosen name is present.
  assert.notEqual(acctParenthetical(a), 'codex-design');
});

test('#2225: no chosen name falls back to the email', () => {
  const a = { account: { name: null, email: 'lead@example.com', label: 'lead' } };
  assert.equal(acctParenthetical(a), 'lead@example.com');
});

test('#2225: no name and no email falls back to the slug', () => {
  const a = { account: { name: null, email: null, label: 'account-b' } };
  assert.equal(acctParenthetical(a), 'account-b');
});

test('#2225: an empty name does not stand in for the email (falsy chosen name is skipped)', () => {
  const a = { account: { name: '', email: 'x@y.z', label: 'slug' } };
  assert.equal(acctParenthetical(a), 'x@y.z');
});

test('#2225: an agent with no account renders NO parenthetical (empty string, not undefined)', () => {
  assert.equal(acctParenthetical({ account: null }), '');
  assert.equal(acctParenthetical({}), '');
  assert.equal(acctParenthetical(null), '');
});

test('#5150: a Gemini or Grok key account (no name, email or label) is named by its key, in the server\'s words', () => {
  const a = { account: { name: null, email: null, label: null, keyTail: '4f2a' } };
  assert.equal(acctParenthetical(a), 'API key ending 4f2a');
});

test('#5150: the key is the LAST rung: a name, an email or a label still wins over it', () => {
  assert.equal(acctParenthetical({ account: { name: 'Research', keyTail: '4f2a' } }), 'Research');
  assert.equal(acctParenthetical({ account: { email: 'g@example.com', keyTail: '4f2a' } }), 'g@example.com');
  assert.equal(acctParenthetical({ account: { label: 'gemini-b', keyTail: '4f2a' } }), 'gemini-b');
});

test('#5150 CONTROL: a row with nothing at all, keyTail included, still gives no bracket', () => {
  assert.equal(acctParenthetical({ account: { name: null, email: null, label: null, keyTail: null } }), '');
  assert.equal(acctParenthetical({ account: { keyTail: '' } }), '');
});

test('#2225 CONTROL: the caller still gates on the return, so "" omits the parens', () => {
  // The render site is `acctEmail ? ' (' + esc(acctEmail) + ')' : ''`; '' is falsy,
  // so an account-less agent gets no empty "()" -- pin that the helper returns a
  // falsy value there rather than a stray space or 'null'.
  assert.ok(!acctParenthetical({ account: null }), 'account-less must be falsy so the parenthetical is omitted');
});

const acctWithListedKey = new Function(`${grab('function acctWithListedKey(')}; return acctWithListedKey;`)();
test('#5150 review 2: the open-the-agent paint takes the key from the account list, by folder', () => {
  // /api/status hands a Gemini agent a row with no keyTail; /api/accounts has it.
  const status = { dir: '/h/.gemini-b', name: null, email: null, label: null, keyTail: null };
  const listed = [{ dir: '/h/.claude', email: 'j@example.com' }, { dir: '/h/.gemini-b', provider: 'google', keyTail: '9999' }];
  assert.equal(acctParenthetical({ account: acctWithListedKey(status, listed) }), 'API key ending 9999');
  // CONTROL: without the list (or with no row for that folder) nothing is invented.
  assert.equal(acctParenthetical({ account: acctWithListedKey(status, null) }), '');
  assert.equal(acctParenthetical({ account: acctWithListedKey(status, [{ dir: '/h/.gemini-c', keyTail: '1111' }]) }), '');
  // A default-account agent (no folder) is not matched to anything, and a row that already has a key keeps it.
  assert.equal(acctWithListedKey(null, listed), null);
  // A listed row with no folder either: only the no-folder guard keeps them from matching.
  assert.equal(acctWithListedKey({ dir: null }, listed.concat([{ dir: null, keyTail: '7777' }])).keyTail, undefined);
  assert.equal(acctWithListedKey({ dir: '/h/.gemini-b', keyTail: '4f2a' }, listed).keyTail, '4f2a');
});
test('#5150 review 2: the paint site goes through acctWithListedKey (a source pin, as the helper is pure)', () => {
  assert.match(PAGE, /const acctEmail = acctParenthetical\(\{ account: acctWithListedKey\(a && a\.account,/);
});
