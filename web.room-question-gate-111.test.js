'use strict';

/**
 * #111: THE ROOM'S QUESTION BOX IS A SAFETY GATE, NOT A PREFERENCE.
 *
 * "PR two" of the answer-panel pair (#119) would delete the room's question box: `#pj-question`, which sits
 * inside `#pj-thread` with its label and answer-how line. Once it is gone, the agent page is the ONLY place a
 * person can see and answer an agent's blocking question. So that delete waits on two gates:
 *   1. the agent page reliably carries an agent's blocking question, one a person can see AND answer, across
 *      its states (Splinter's ruling, 2026-08-19): OPEN, and it needs a browser walk, not a grep;
 *   2. the question-width pass (Mona Lisa's ruling, 2026-08-20): DONE, #113 closed 2026-08-23.
 *
 * The gate lived in a branch plan, then on an open card. A card only guards while someone reads it, and the
 * three tests that touch this box today (web.fold-boxes, web.pj-clear-state-2575, render-thread) would fail
 * for their OWN reasons, so whoever deleted the box would fix them and never meet the rule. This test is the
 * rule. If it fails because you removed the box on purpose: that is PR two, and it needs Gate 1's evidence
 * (the browser walk) and Splinter's OK. Record both in the PR, then change this test. Do not just delete it.
 *
 *   node --test web.room-question-gate-111.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

test('#111: the room keeps its question box until the agent page carries blocking questions (Gate 1)', () => {
  const GATE = 'the room\'s question box is gone: that is #111\'s PR two, which needs Gate 1 met (the agent page '
    + 'carries a blocking question a person can see and answer, shown by a browser walk) and Splinter\'s OK first';
  assert.match(PAGE, /id="pj-thread"/, GATE + ' (#pj-thread, the box\'s container, is missing)');
  assert.match(PAGE, /id="pj-question"/, GATE + ' (#pj-question is missing)');
  /* The box sits INSIDE the thread, which is why deleting the thread takes it too (#111's first paragraph). */
  const threadAt = PAGE.indexOf('id="pj-thread"');
  const questionAt = PAGE.indexOf('id="pj-question"');
  assert.ok(threadAt > -1 && questionAt > threadAt, GATE + ' (#pj-question is no longer after #pj-thread in the markup)');
});
