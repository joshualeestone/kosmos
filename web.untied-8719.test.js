'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
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
  assert.equal(reasonOf(untied), 'Kosmos cannot confirm it started this window, so it does not type messages into it.');
  assert.equal(reasonOf({ state: 'idle', isNamedOurs: true }), '', 'CONTROL: a tied idle agent has no reason sentence');
  assert.equal(reasonOf({ state: 'idle' }), '', 'CONTROL: a card without the field (paneless, older) is not called untied');
  const waiting = { state: 'working', waiting: { n: 3 } };
  assert.equal(reasonOf(waiting), '3 messages waiting', 'premise: a tied working agent with messages waiting says so');
  assert.equal(reasonOf({ ...waiting, isNamedOurs: false }), 'Kosmos cannot confirm it started this window, so it does not type messages into it.',
    'the waiting line is left out: Kosmos will not deliver those messages to this window');
  assert.equal(reasonOf(untied, { card: true }), '', 'the tile carries no sentence (#6716); the label says it there');
  for (const state of ['needs_you', 'auth_failed', 'rate_limited']) {
    assert.match(reasonOf({ state, isNamedOurs: false }), /^Kosmos cannot confirm it started this window/, `it leads the ${state} reason on purpose (Kosmos will not type into it)`);
  }
  // What its screen shows still follows, in words that promise no Kosmos action (the ordinary stuck sentence does).
  const stuck = { state: 'auth_failed', stuckError: { stuck: true, state: 'auth_failed', forMs: 600000 } };
  assert.match(reasonOf(stuck), /Open Settings to reconnect it/, 'premise: the ordinary stuck sign-in sentence names a Kosmos step');
  assert.equal(reasonOf({ ...stuck, isNamedOurs: false }), 'Kosmos cannot confirm it started this window, so it does not type messages into it. Its screen shows it is signed out.');
  assert.equal(reasonOf({ state: 'rate_limited', isNamedOurs: false, crashLoop: { looping: true, count: 4 } }),
    'Kosmos cannot confirm it started this window, so it does not type messages into it. Its screen shows it is paused by a usage limit.',
    'a crash loop\'s "Kosmos will keep trying" is not borrowed');
  // A reason that promises Kosmos will act (a lost connection it retries) is left out for this window.
  assert.equal(reasonOf({ state: 'connection_lost', isNamedOurs: false, reconnect: { phase: 'waiting' } }),
    'Kosmos cannot confirm it started this window, so it does not type messages into it.');
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
  assert.ok(SCRIPT.includes("why.textContent = tied ? '' : 'Kosmos cannot confirm it started this window, so it does not change its picture, role or instructions from here.';"),
    'the detail sentence names its reason itself');
});
