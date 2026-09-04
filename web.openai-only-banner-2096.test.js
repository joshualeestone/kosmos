'use strict';
/*
 * #2096 -- the "cannot reach a Claude subscription" banner (renderConnection) must
 * be provider-aware: OpenAI-only is first-class and shows NO Claude warning, but a
 * machine that DEPENDS on Claude must still see the warning when Claude is
 * unreachable. Extracts renderConnection from web/index.html and executes it
 * against a fake DOM for each case, so the guard is really run, not pinned by text.
 *
 *   node --test web.openai-only-banner-2096.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const PAGE = fs.readFileSync('web/index.html', 'utf8');
const SRC = PAGE.match(/function renderConnection\(conn, agents, dependsOnClaude\) \{[\s\S]*?\n\}/);
assert.ok(SRC, 'renderConnection(conn, agents, dependsOnClaude) moved or lost its dependsOnClaude arg');

function run(conn, agents, dependsOnClaude) {
  const el = { hidden: null, textContent: null, className: null };
  // eslint-disable-next-line no-unused-vars
  const document = { getElementById: (id) => (id === 'conn' ? el : null) };
  // eslint-disable-next-line no-eval
  const fn = eval('(' + SRC[0] + ')');
  fn(conn, agents, dependsOnClaude);
  return el;
}
const NONE = { state: 'none', because: 'nobody has signed in yet' };

test('OpenAI-only (dependsOnClaude=false) hides the Claude-subscription banner even when state is none', () => {
  const el = run(NONE, [], false);
  assert.equal(el.hidden, true, 'the banner fired on an OpenAI-only machine (dependsOnClaude false)');
  assert.equal(el.textContent, '');
});

test('a machine that DEPENDS on Claude still sees the banner when Claude is unreachable', () => {
  const el = run(NONE, [], true);
  assert.equal(el.hidden, false, 'a real Claude failure was hidden');
  assert.match(el.textContent, /cannot reach a Claude subscription/);
});

test('a MISSING dependsOnClaude (older server) falls back to WARNING, never hides a real failure', () => {
  const el = run(NONE, [], undefined);
  assert.equal(el.hidden, false, 'an absent field suppressed the warning -- it must fall back to showing it');
  assert.match(el.textContent, /cannot reach a Claude subscription/);
});

test('connected still hides regardless of dependsOnClaude, and no-verdict still says nothing', () => {
  assert.equal(run({ state: 'connected' }, [], true).hidden, true);
  assert.equal(run({ state: 'connected' }, [], false).hidden, true);
  assert.equal(run(null, [], false).hidden, true);
  assert.equal(run({}, [], true).hidden, true, 'a verdict with no state says nothing');
});

test('the unknown (unsure) state is ALSO suppressed when nothing depends on Claude', () => {
  // #2096 covers both loud "none" and the quieter "unknown": an OpenAI-only machine
  // should see neither Claude message.
  const el = run({ state: 'unknown', because: 'we could not read the Claude settings' }, [], false);
  assert.equal(el.hidden, true, 'the unsure Claude message showed on an OpenAI-only machine');
});
