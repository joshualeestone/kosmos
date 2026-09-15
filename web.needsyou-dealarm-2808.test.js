'use strict';

/**
 * #2808 class 2: a needs_you the agent reported DELIBERATELY (by:'agent' -> card
 * stateReportedBy 'agent') is the agent's OWN substantive question, so the board presents it as
 * a CALM "has a question" -- not the red "Needs you" alarm a QA tester read as "app broken"
 * (Josh, 2026-09-14 16:49). The technical permission/trust junk (by:'auto', class 1), a scraped
 * prompt, and an unknown-provenance/legacy report (null) STAY red -- de-alarming only the KNOWN
 * agent case is the safe direction (selfreport.js:389: absence is never "an agent typed it").
 *
 * These EXTRACT and RUN the two shared card derivations (cardStOf, stateCopyOf) plus their state
 * tables from the page, so every control can return the dangerous answer -- a class-1 or a
 * scraped needs_you that WRONGLY calmed would fail here, without a browser.
 *
 *   node --test web.needsyou-dealarm-2808.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

function constBlock(name) {
  const at = PAGE.indexOf('const ' + name + ' = {');
  assert.notEqual(at, -1, name + ' is gone from the page');
  return PAGE.slice(at, PAGE.indexOf('\n};', at) + 3);
}
// cardStOf is a ONE-LINER (kept so the detail-badge test's slice-to-newline holds); take the
// whole line. stateCopyOf is multi-line; take to its first column-0 close.
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
  function restartingLabel() { return 'Restarting agent'; }  /* stub: not under test here */
  ${oneLiner('function cardStOf(a)')}
  ${multiLine('function stateCopyOf(a)')}
  return { cardStOf, stateCopyOf, CARD_ST, STATE_COPY };
`)();

const card = (over) => Object.assign({ state: 'needs_you', stateReportedBy: null }, over);

test('#2808 class 2: a deliberate agent question (by:agent) is the calm "question" shape, not red attn', () => {
  const a = card({ stateReportedBy: 'agent' });
  assert.equal(derive.cardStOf(a).st, 'question', 'a by:agent needs_you should get the calm question shape');
  const copy = derive.stateCopyOf(a);
  assert.equal(copy.label, 'Has a question');
  assert.equal(copy.attn, false, 'a class-2 question must NOT be an attention (red) state');
});

test('#2808 control: a technical permission prompt (by:auto, class 1) STAYS the red attn alarm', () => {
  const a = card({ stateReportedBy: 'auto' });
  assert.equal(derive.cardStOf(a).st, 'attn', 'class 1 (auto) must stay red -- it is PigeonPete\'s invisible handle, and the red is the fallback if it misses');
  assert.equal(derive.stateCopyOf(a).label, 'Needs you');
  assert.equal(derive.stateCopyOf(a).attn, true);
});

test('#2808 control: a SCRAPED needs_you (no self-report -> stateReportedBy null) STAYS red', () => {
  const a = card({ stateReportedBy: null });
  assert.equal(derive.cardStOf(a).st, 'attn', 'a scraped prompt we could not classify must stay the alarm');
  assert.equal(derive.stateCopyOf(a).attn, true);
});

test('#2808 control: an OPERATOR-cleared/legacy needs_you (by:operator) STAYS red (only KNOWN agent is calmed)', () => {
  assert.equal(derive.cardStOf(card({ stateReportedBy: 'operator' })).st, 'attn');
  assert.equal(derive.cardStOf(card({ stateReportedBy: undefined })).st, 'attn', 'undefined (a card without the field) is not "agent"');
});

test('#2808 control: the by:agent gate needs the needs_you STATE -- a WORKING agent reported by:agent is not a question', () => {
  const working = { state: 'working', stateReportedBy: 'agent' };
  assert.equal(derive.cardStOf(working).st, 'working', 'the predicate is state===needs_you AND by===agent; a working agent stays working');
  assert.equal(derive.stateCopyOf(working).label, 'Working');
});

test('#2808: the question shape exists in both tables and reads calm', () => {
  assert.ok(derive.CARD_ST.question, 'CARD_ST.question missing');
  assert.notEqual(derive.CARD_ST.question.st, 'attn', 'the question pack shape must not be the red attn');
  assert.equal(derive.STATE_COPY.question.attn, false);
});
