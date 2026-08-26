'use strict';

/**
 * kosmos#978 (Josh, 2026-08-26): on Settings > AI Models > Add a provider >
 * OpenAI, he read the form as "Add a name" rather than "activate this key".
 *
 * 🔑 THE FIELD WAS ALREADY OPTIONAL. The handler requires the key and nothing
 * else. So nothing was wrong with the behaviour and everything was wrong with
 * what it looked like: the rows were [key][Show] then [name][Add], and the only
 * thing Add sat beside was the name. This pins the ADJACENCY, because that is
 * what actually misled him — a test on "is the label optional" would have
 * passed all along while the form kept saying otherwise.
 *
 *   node --test web.openai-add-978.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync('web/index.html', 'utf8');

/* The whole OpenAI panel, bounded at its own closing marker rather than a byte
   count, so this cannot drift into the Claude flow above it. */
function openaiFlow() {
  const a = PAGE.indexOf('<div id="acct-openai-flow"');
  assert.ok(a > -1, 'the OpenAI add panel moved; re-anchor this test');
  const b = PAGE.indexOf('id="acct-openai-msg"', a);
  assert.ok(b > a, 'the panel no longer ends with its status line; re-anchor');
  return PAGE.slice(a, b);
}

test('Add does not share a row with the optional name', () => {
  const flow = openaiFlow();
  const nameRow = flow.slice(flow.indexOf('id="acct-openai-label"'));
  const rowEnd = nameRow.indexOf('</div>');
  assert.ok(!nameRow.slice(0, rowEnd).includes('acct-openai-go'),
    'Add is back on the name field\'s row, which is what made Josh read the form as "add a name"');
});

test('Add is the form\'s action: its own row, and the primary weight', () => {
  const flow = openaiFlow();
  assert.match(flow, /<button class="btn uprime" id="acct-openai-go" type="button">Add<\/button>/,
    'Add lost the primary style, so it no longer reads as THE action on the panel');
});

/* A placeholder is the one label that disappears exactly when somebody is
   deciding whether to fill the field in, so "optional" has to survive focus. */
test('the name says it is optional in words, not only in a placeholder', () => {
  const flow = openaiFlow();
  assert.match(flow, /The name is optional\./,
    'the optional-ness of the name exists only in the placeholder and the aria-label again');
});

/* The card asked for the same weight on the Claude flow's actions. Both, by
   name: doing one and not the other is how a form ends up with two different
   answers about which button is the action. */
test('the Claude flow\'s two actions carry the same weight', () => {
  assert.match(PAGE, /<button class="btn uprime" id="acct-add" type="button">Start the sign-in<\/button>/,
    'Start the sign-in is no longer the primary action of the Claude flow');
  assert.match(PAGE, /<button class="btn uprime" id="acct-code-go" type="button">Continue<\/button>/,
    'the code step\'s Continue is no longer the primary action');
});
