'use strict';
/**
 * #5959: engine/cardlabel.js is a second copy of the card's word. This lifts the page's own STATE_COPY, restartingLabel
 * and stateCopyOf out of web/index.html and compares their answer with labelOf's on every state and special case (a
 * state named like an Object member is not one: there labelOf says "Can't tell" and the page has no word), so a
 * word changed in one place and not the other goes red here.
 *
 *   node --test engine/cardlabel-5959.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { labelOf, STATE_COPY } = require('./cardlabel');

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
function grab(re, what) { const m = PAGE.match(re); assert.ok(m, 'CONTROL: ' + what + ' was not found in the page'); return m[0]; }
const pageStateCopyOf = new Function(
  grab(/\nconst STATE_COPY = \{[\s\S]*?\n\};\n/, 'STATE_COPY')
  + grab(/\nfunction restartingLabel\(a\) \{[\s\S]*?\n\}\n/, 'restartingLabel')
  + grab(/\nfunction stateCopyOf\(a\) \{[\s\S]*?\n\}\n/, 'stateCopyOf')
  + '\nreturn { stateCopyOf, STATE_COPY };')();

test('#5959: every state the page has a word for, the engine has the same word', () => {
  assert.deepEqual(Object.keys(STATE_COPY).sort(), Object.keys(pageStateCopyOf.STATE_COPY).sort());
  for (const state of Object.keys(pageStateCopyOf.STATE_COPY)) {
    assert.equal(labelOf({ state }), pageStateCopyOf.stateCopyOf({ state }).label, state);
  }
});

test('#5959: the special cases agree (question, crash loop, restarting causes, reconnecting, an unknown state)', () => {
  const cards = [
    { state: 'needs_you', stateReportedBy: 'agent' },
    { state: 'needs_you', stateReportedBy: 'auto' },
    { state: 'working', crashLoop: { looping: true } },
    { state: 'working', crashLoop: { looping: false } },
    { state: 'restarting', disruption: { cause: 'model' }, modelName: 'Opus' },
    { state: 'restarting', disruption: { cause: 'model' } },
    { state: 'restarting', disruption: { cause: 'provider', timedOut: true } },
    { state: 'restarting', disruption: { cause: 'instructions' } },
    { state: 'restarting', disruption: { cause: 'account' } },
    { state: 'restarting' },
    { state: 'connection_lost', reconnect: { phase: 'waiting' } },
    { state: 'connection_lost', reconnect: { phase: 'retried' } },
    { state: 'connection_lost', reconnect: { phase: 'gave_up' } },
    { state: 'something_new' },
  ];
  for (const a of cards) assert.equal(labelOf(a), pageStateCopyOf.stateCopyOf(a).label, JSON.stringify(a));
});

test('#5959 review 4: an offline card (running false) reads as the page\'s offline card does, before stateCopyOf', () => {
  // The page's offline branch is a template, not a function, so its expressions are pinned by text.
  assert.ok(PAGE.includes("${split ? STATE_COPY.unknown.label : 'Not running'}"), 'CONTROL: the page\'s offline label changed; update labelOf');
  assert.ok(PAGE.includes('<b>${esc(STATE_COPY.needs_trust.label)}</b>'), 'CONTROL: the page\'s offline trust-prompt label changed');
  assert.ok(PAGE.includes('const split = a.jobRunningUnseen === true;'), 'CONTROL: the page no longer splits on jobRunningUnseen');
  assert.equal(labelOf({ running: false, state: 'stopped' }), 'Not running');
  assert.equal(labelOf({ running: false, state: 'idle', jobRunningUnseen: true }), "Can't tell");
  assert.equal(labelOf({ running: false, state: 'stopped', needsTrust: true }), 'Waiting on a trust prompt');
  // A restarting agent is not swallowed by the offline branch (the page's own exception).
  assert.equal(labelOf({ running: false, state: 'restarting' }), 'Restarting agent');
});

test('#5959 review 5: a state named like an Object member reads "Can\'t tell" (where the page has no word)', () => {
  for (const state of ['constructor', 'toString', '__proto__']) assert.equal(labelOf({ state }), "Can't tell", state);
});
