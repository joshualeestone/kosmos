'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/**
 * kosmos#8991: an agent waiting on the person says so in plain words, in the pill's hover and its hidden text (the
 * tile carries no sentence, #6716): a question, a question held until the person is back, a permission prompt, or
 * anything else it waits on the person for. A sign-in or a usage limit already says itself (asserted here too, so this
 * card's whole ask is pinned in one place). Fixed words only: the agent's own `because` never shows (#986, #3043,
 * #3271).
 *
 *   node --test engine/waitwhy-8991.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const page = require('../test-support/page');

const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8'));
const stateReason = new Function(page.lift(SCRIPT, 'stateReason') + '\nreturn stateReason;')();

const QUESTION = 'It has asked you a question and is waiting for your answer. Open it to answer.';
const HELD = 'It has a question for you and is holding it until you are back. Open it to answer.';
const OTHER = 'It is waiting for you. Open it to see what it needs.';
/* #874's hedge: a needs_you read off the screen says "Looks like", as the sign-in and limit sentences do. */
const SEEN_PERMISSION = 'Looks like it is waiting for your permission to go on. Open it to answer.';
const SEEN_OTHER = 'Looks like it is waiting for you. Open it to see what it needs.';
const SECRET = 'May I push to the branch named secret-plan?';

test('#8991 each way of waiting on the person has its own plain sentence', () => {
  assert.equal(stateReason({ name: 'Ada', state: 'needs_you', stateReportedBy: 'agent', because: SECRET }), QUESTION);
  assert.equal(stateReason({ name: 'Ada', state: 'needs_you', stateReportedBy: 'agent', stateHeld: true, because: SECRET }), HELD);
  /* awaitingApproval is read off the screen even when the state was reported (a needs_you does not decay, and an agent's
     prose can match the permission wording), so the permission sentence is always hedged. */
  assert.equal(stateReason({ name: 'Ada', state: 'needs_you', stateReportedBy: 'auto', stateConfidence: 'structured', awaitingApproval: true, because: 'asking permission to use Bash: rm x' }), SEEN_PERMISSION);
  assert.equal(stateReason({ name: 'Ada', state: 'needs_you', stateConfidence: 'scraped', because: 'it is asking you something' }), SEEN_OTHER);
  assert.equal(stateReason({ name: 'Ada', state: 'needs_you', stateConfidence: 'scraped', awaitingApproval: true }), SEEN_PERMISSION);
  /* A question the agent reported itself is not a screen read, so it is never hedged, whatever the confidence field says. */
  assert.equal(stateReason({ name: 'Ada', state: 'needs_you', stateReportedBy: 'agent', stateConfidence: 'scraped' }), QUESTION);
  assert.equal(stateReason({ name: 'Ada', state: 'needs_you' }), OTHER, 'a bare needs_you with no fields still says it waits on the person');
});

test('#8991 the pill word and the sentence come from the same order (held, question, permission)', () => {
  const stateCopyOf = new Function('STATE_COPY', 'restartingLabel', page.lift(SCRIPT, 'stateCopyOf') + '\nreturn stateCopyOf;')(
    { needs_you: { label: 'Issue' }, question: { label: 'Question' }, approval: { label: 'Needs permission' }, unknown: { label: '?' } }, () => '');
  const cases = [
    [{ state: 'needs_you', stateReportedBy: 'agent', stateHeld: true, awaitingApproval: true }, 'Question held', HELD],
    [{ state: 'needs_you', stateReportedBy: 'agent', awaitingApproval: true }, 'Question', QUESTION],
    [{ state: 'needs_you', awaitingApproval: true }, 'Needs permission', SEEN_PERMISSION],
    [{ state: 'needs_you' }, 'Issue', OTHER],
  ];
  for (const [a, label, words] of cases) {
    assert.equal(stateCopyOf(a).label, label, JSON.stringify(a));
    assert.equal(stateReason(a), words, JSON.stringify(a));
  }
});

test('#8991 the agent\'s own words never show, whatever it reported', () => {
  for (const extra of [{ stateReportedBy: 'agent' }, { stateReportedBy: 'agent', stateHeld: true }, { awaitingApproval: true }, {}]) {
    const said = stateReason({ name: 'Ada', state: 'needs_you', because: SECRET, ...extra });
    assert.ok(!said.includes('secret-plan'), 'the agent\'s words leaked: ' + said);
    assert.doesNotMatch(said, /[“”"]/, 'no quotation of the agent');
  }
});

test('#8991 a sentence that says more still wins, and other states are untouched', () => {
  const crash = stateReason({ name: 'Ada', state: 'needs_you', stateReportedBy: 'agent', crashLoop: { looping: true, count: 4 } });
  assert.match(crash, /^Kosmos has restarted it 4 times/, 'a crash loop leads');
  assert.equal(stateReason({ state: 'needs_you', disruption: { failed: true }, because: 'The restart did not come back. Restart it again' }),
    'The restart did not come back. Restart it again.', '#4006: a failed restart keeps its own sentence');
  assert.match(stateReason({ state: 'needs_you', isNamedOurs: false }), /^Kosmos cannot confirm it started this window/, '#8719 leads');
  /* The rest of the card's ask, already said by the states themselves. */
  assert.match(stateReason({ state: 'rate_limited', stateConfidence: 'scraped' }), /usage limit/i);
  assert.match(stateReason({ state: 'auth_failed', stateConfidence: 'scraped' }), /sign-in/i);
  /* CONTROLS: no state that is not waiting on the person borrows these words. */
  for (const state of ['idle', 'working', 'stopped', 'restarting', 'rate_limited', 'auth_failed', 'connection_lost', 'unknown']) {
    const said = String(stateReason({ name: 'Ada', state, stateReportedBy: 'agent', awaitingApproval: true }));
    assert.ok(![QUESTION, HELD, OTHER, SEEN_PERMISSION, SEEN_OTHER].includes(said), state + ' said a waiting-on-you sentence: ' + said);
  }
  /* #6716: the tile itself still carries no sentence. */
  assert.equal(stateReason({ state: 'needs_you', stateReportedBy: 'agent' }, { card: true }), '');
});

test('#8991 the sentence is the pill\'s words only: every task line (tile, list row, the agent\'s page) stays empty', () => {
  const lifted = (name) => page.lift(SCRIPT, name);
  const taskLine = new Function(lifted('stateReason') + '\n' + lifted('taskLine') + '\nreturn taskLine;')();
  const pillSay = new Function(lifted('stateReason') + '\n' + lifted('rulesBehindLine') + '\n' + lifted('pillSay') + '\nreturn pillSay;')();
  for (const [a, words] of [[{ state: 'needs_you', stateReportedBy: 'agent' }, QUESTION], [{ state: 'needs_you', awaitingApproval: true }, SEEN_PERMISSION], [{ state: 'needs_you', task: 'Project 821226pmtest m54' }, OTHER]]) {
    assert.equal(pillSay(a), words, 'the pill says it: ' + JSON.stringify(a));
    assert.equal(taskLine(a), '', 'the agent\'s page line stays empty (#209): ' + JSON.stringify(a));
    assert.equal(taskLine(a, { card: true }), '', 'the tile stays empty (#6716): ' + JSON.stringify(a));
  }
  /* CONTROL: a state with a reason of its own still has it on the task line. */
  assert.match(taskLine({ state: 'auth_failed', stateConfidence: 'scraped' }), /sign-in/i);
});
