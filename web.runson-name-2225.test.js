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

test('#2225 CONTROL: the caller still gates on the return, so "" omits the parens', () => {
  // The render site is `acctEmail ? ' (' + esc(acctEmail) + ')' : ''`; '' is falsy,
  // so an account-less agent gets no empty "()" -- pin that the helper returns a
  // falsy value there rather than a stray space or 'null'.
  assert.ok(!acctParenthetical({ account: null }), 'account-less must be falsy so the parenthetical is omitted');
});
