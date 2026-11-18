'use strict';
/* kosmos#8719: an agent whose window Kosmos cannot tie to it (no launch mark, so the card's isNamedOurs is false). The board
   says why it cannot be messaged, marks it on the tile and the list row, and the detail page names the real test. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const page = require('./test-support/page');

const HTML = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(HTML);
const reasonOf = (a, opts) => new Function('a', 'opts', `${page.lift(SCRIPT, 'waitingLine')}\n${page.lift(SCRIPT, 'stateReason')}\nreturn stateReason(a, opts);`)(a, opts);
const flagOf = (a) => new Function('a', `${page.lift(SCRIPT, 'untiedFlagHtml')}\nreturn untiedFlagHtml(a);`)(a);

test('#8719: an agent Kosmos did not start says why it cannot be messaged; CONTROL: one of ours says nothing new', () => {
  const untied = { state: 'idle', isNamedOurs: false };
  assert.equal(reasonOf(untied), 'Kosmos cannot confirm it started this window, so it will not type messages into it until Kosmos starts it.');
  assert.equal(reasonOf({ state: 'idle', isNamedOurs: true }), '', 'CONTROL: a tied idle agent has no reason sentence');
  assert.equal(reasonOf({ state: 'idle' }), '', 'CONTROL: a card without the field (paneless, older) is not called untied');
  assert.match(reasonOf({ state: 'working', isNamedOurs: false, waiting: { kind: 'x' } }), /^Kosmos cannot confirm it started this window/,
    'it outranks the working-while-waiting line: every message to it is refused');
  assert.equal(reasonOf(untied, { card: true }), '', 'the tile carries no sentence (#6716); the label says it there');
  for (const state of ['needs_you', 'auth_failed', 'rate_limited']) {
    assert.match(reasonOf({ state, isNamedOurs: false }), /^Kosmos cannot confirm it started this window/, `it leads the ${state} reason on purpose (Kosmos will not type into it)`);
  }
  // The agent's own reason still follows, so the person can read what the window waits on.
  const stuck = { state: 'auth_failed', stuckError: { stuck: true, state: 'auth_failed', forMs: 600000 } };
  const ownWords = reasonOf(stuck);
  assert.ok(ownWords.length > 0, 'premise: a stuck sign-in has its own reason');
  assert.equal(reasonOf({ ...stuck, isNamedOurs: false }), 'Kosmos cannot confirm it started this window, so it will not type messages into it until Kosmos starts it. ' + ownWords);
});

test('#8719: the tile and list row say "Not linked to Kosmos"; CONTROL: a tied agent shows no label', () => {
  assert.equal(flagOf({ isNamedOurs: false }), '<span class="auntied">Not linked to Kosmos</span>');
  assert.equal(flagOf({ isNamedOurs: true }), '');
  assert.equal(flagOf({}), '', 'a card without the field is not labelled');
  assert.ok(SCRIPT.includes("${typeof untiedFlagHtml === 'function' ? untiedFlagHtml(a) : ''}</div>"), 'the tile draws the label');
  assert.ok(SCRIPT.includes("+ (typeof untiedFlagHtml === 'function' ? untiedFlagHtml(a) : '')"), 'the list row draws the label');
  assert.ok(/\.acard \.auntied \{[^}]*display: block/.test(HTML) && /\.lrow \.auntied \{[^}]*display: block/.test(HTML), 'the label has its style on the tile and the row');
});

test('#8719: the detail page line stands alone (the button reads it alone, and #d-task hides on a question)', () => {
  assert.ok(SCRIPT.includes("why.textContent = tied ? '' : 'Kosmos cannot confirm it started this window, so it will not change its picture, role or instructions from here.';"),
    'the detail sentence names its reason itself');
});
