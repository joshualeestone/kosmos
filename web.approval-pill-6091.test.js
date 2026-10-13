'use strict';

/**
 * #6091 (follow-up to #6054): while a Claude agent waits on its permission prompt, its status pill read "Issue", which
 * reads as broken. The engine already says why (status.js: needs_you with because APPROVAL_WAITING, "it is waiting for
 * your approval"), and the agent page answers it with Yes/No buttons (#6054). The pill now reads "Waiting for you".
 *
 * Kept an attention state with the needs-you card look: the prompt blocks the agent until someone answers it, and
 * #2808 keeps a technical prompt red on purpose, as the fallback when nothing answers it. Only the word changes.
 *
 * These EXTRACT and RUN the page's own cardStOf and stateCopyOf (as web.needsyou-dealarm-2808.test.js does), so each
 * control can return the wrong answer.
 *
 *   node --test web.approval-pill-6091.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const status = require('./engine/status');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

function constBlock(name) {
  const at = PAGE.indexOf('const ' + name + ' = {');
  assert.notEqual(at, -1, name + ' is gone from the page');
  return PAGE.slice(at, PAGE.indexOf('\n};', at) + 3);
}
function oneLiner(sig) {
  const at = PAGE.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone from the page');
  return PAGE.slice(at, PAGE.indexOf('\n', at));
}
function multiLine(sig) {
  const at = PAGE.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone from the page');
  return PAGE.slice(at, PAGE.indexOf('\n}', at) + 2);
}

const derive = new Function(`
  ${constBlock('CARD_ST')}
  ${constBlock('STATE_COPY')}
  function restartingLabel() { return 'Restarting agent'; }
  ${oneLiner('function cardStOf(a)')}
  ${multiLine('function stateCopyOf(a)')}
  return { cardStOf, stateCopyOf };
`)();

const waiting = (over) => Object.assign({ state: 'needs_you', stateReportedBy: null, because: status.APPROVAL_WAITING }, over);

test('#6091: an agent on its permission prompt reads "Waiting for you", not "Issue"', () => {
  const copy = derive.stateCopyOf(waiting());
  assert.equal(copy.label, 'Waiting for you');
  assert.notEqual(copy.label, 'Issue');
});

test('#6091: it stays an attention state with the needs-you card look (only the word changes)', () => {
  assert.equal(derive.stateCopyOf(waiting()).attn, true, 'it blocks the agent until someone answers');
  assert.equal(derive.cardStOf(waiting()).st, 'attn', '#2808 keeps a technical prompt on the needs-you look');
});

test('#6091: the page matches the engine\'s own sentence byte for byte', () => {
  assert.equal(status.APPROVAL_WAITING, 'it is waiting for your approval', 'CONTROL: the engine changed its sentence; update the page and engine/cardlabel.js');
  assert.ok(PAGE.includes(`a.because === '${status.APPROVAL_WAITING}'`), 'the page no longer compares against the engine\'s sentence');
});

test('#6091 control: any other needs_you is still "Issue"', () => {
  assert.equal(derive.stateCopyOf(waiting({ because: status.ASKING_GENERIC })).label, 'Issue');
  assert.equal(derive.stateCopyOf(waiting({ because: undefined })).label, 'Issue');
  assert.equal(derive.stateCopyOf(waiting({ because: 'it is waiting for your approval.' })).label, 'Issue', 'a near-miss is not the engine\'s sentence');
});

test('#6091 control: the sentence alone does not relabel a state that is not needs_you', () => {
  assert.equal(derive.stateCopyOf(waiting({ state: 'working' })).label, 'Working');
  assert.equal(derive.stateCopyOf(waiting({ state: 'idle' })).label, 'Idle');
});

test('#6091: an agent\'s own deliberate question still reads "Question" (#2808 comes first)', () => {
  assert.equal(derive.stateCopyOf(waiting({ stateReportedBy: 'agent' })).label, 'Question');
});

test('#6091: engine/cardlabel.js (an agent\'s own `kosmos report show`) says the same', () => {
  const { labelOf } = require('./engine/cardlabel');
  assert.equal(labelOf(waiting()), 'Waiting for you');
  assert.equal(labelOf(waiting({ because: status.ASKING_GENERIC })), 'Issue');
});
