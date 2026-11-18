'use strict';
/* kosmos#8719: an agent whose window Kosmos did not start (no launch claim, so the card's isNamedOurs is false). The board
   says why it cannot be messaged, marks it on the tile and the list row, and the detail page names the real test. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const page = require('./test-support/page');

const HTML = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(HTML);
const reasonOf = (a, opts) => new Function('a', 'opts', `${page.lift(SCRIPT, 'stateReason')}\nreturn stateReason(a, opts);`)(a, opts);
const flagOf = (a) => new Function('a', `${page.lift(SCRIPT, 'untiedFlagHtml')}\nreturn untiedFlagHtml(a);`)(a);

test('#8719: an agent Kosmos did not start says why it cannot be messaged; CONTROL: one of ours says nothing new', () => {
  const untied = { state: 'idle', isNamedOurs: false };
  assert.match(reasonOf(untied), /^Started outside Kosmos, so Kosmos cannot confirm this window is the agent and will not type messages into it\./);
  assert.equal(reasonOf({ state: 'idle', isNamedOurs: true }), '', 'CONTROL: a tied idle agent has no reason sentence');
  assert.equal(reasonOf({ state: 'idle' }), '', 'CONTROL: a card without the field (paneless, older) is not called untied');
  assert.match(reasonOf({ state: 'working', isNamedOurs: false, waiting: { kind: 'x' } }), /^Started outside Kosmos/,
    'it outranks the working-while-waiting line: every message to it is refused');
  assert.equal(reasonOf(untied, { card: true }), '', 'the tile carries no sentence (#6716); the label says it there');
});

test('#8719: the tile and list row say "Not started by Kosmos"; CONTROL: a tied agent shows no label', () => {
  assert.equal(flagOf({ isNamedOurs: false }), '<span class="auntied">Not started by Kosmos</span>');
  assert.equal(flagOf({ isNamedOurs: true }), '');
  assert.equal(flagOf({}), '', 'a card without the field is not labelled');
  assert.ok(SCRIPT.includes("${typeof untiedFlagHtml === 'function' ? untiedFlagHtml(a) : ''}</div>"), 'the tile draws the label');
  assert.ok(SCRIPT.includes("+ (typeof untiedFlagHtml === 'function' ? untiedFlagHtml(a) : '')"), 'the list row draws the label');
  assert.match(HTML, /\.acard \.auntied, \.lrow \.auntied \{[^}]*display: block/, 'the label has its style');
});

test('#8719: the detail page names the launch mark, not only the -discord spelling', () => {
  const at = SCRIPT.indexOf("why.textContent = tied ? '' : `The window called ${a.sessionName} was started outside Kosmos");
  assert.ok(at > 0, 'the detail sentence is the new one');
  const said = SCRIPT.slice(at, at + 600);
  assert.match(said, /session Kosmos marks/);
  assert.match(said, /-discord/, 'it still names the other spelling that counts');
});
