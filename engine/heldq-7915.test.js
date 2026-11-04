'use strict';
require('../test-support/tmpscope');   // kosmos#5334: this process's temp folders, removed when it exits
/* kosmos#7915 (#7886 item 7): a person told an agent to hold its questions until they were back, and its needs_you
   kept being followed up. `kosmos report needs_you --held` keeps the question on the board with `held: true`. These pin
   each place that reads it: the store, the stale rule, the card (engine and page words), the Recommender and the note
   that rides the person's next message. Every arm has an unheld control that must still behave as before. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-heldq-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const selfreport = require('./selfreport');
const status = require('./status');
const cardlabel = require('./cardlabel');
const recommender = require('./recommender');
const chat = require('./chat');

test('the store keeps held only on a needs_you that says so, and read gives it back', () => {
  assert.equal(selfreport.record('h-held', { state: 'needs_you', because: 'Which logo?', held: true }).recorded, true);
  assert.equal(selfreport.read('h-held').held, true);
  // CONTROL: the same question without the flag is not held.
  assert.equal(selfreport.record('h-plain', { state: 'needs_you', because: 'Which logo?' }).recorded, true);
  assert.equal(selfreport.read('h-plain').held, false);
  // held on another state is never stored (the route refuses it; the store does not trust that).
  assert.equal(selfreport.record('h-work', { state: 'working', because: 'x', held: true }).recorded, true);
  assert.equal(selfreport.read('h-work').held, false);
  const raw = fs.readFileSync(selfreport.fileFor('h-work'), 'utf8');
  assert.doesNotMatch(raw, /"held"/, 'a working line carries no held field');
  // Only a true boolean: a truthy string is not a hold.
  assert.equal(selfreport.record('h-str', { state: 'needs_you', because: 'q', held: 'yes' }).recorded, true);
  assert.equal(selfreport.read('h-str').held, false);
  // A line written some other way (an older or hand-made record) is read as held only on a needs_you.
  fs.writeFileSync(selfreport.fileFor('h-raw'), JSON.stringify({ v: 1, state: 'working', held: true, by: 'agent', at: new Date().toISOString() }) + '\n');
  assert.equal(selfreport.read('h-raw').held, false);
  // Asking it for real afterwards (a re-report without --held) ends the hold.
  assert.equal(selfreport.record('h-held', { state: 'needs_you', because: 'Which logo?' }).recorded, true);
  assert.equal(selfreport.read('h-held').held, false);
});

test('asking a held question for real is a new ask: askedAt moves; holding it again moves it too; a plain repeat does not', () => {
  const rows = (name, list) => fs.writeFileSync(selfreport.fileFor(name), list.map((r, i) =>
    JSON.stringify({ v: 1, by: 'agent', at: new Date(Date.parse('2026-11-01T10:00:00Z') + i * 3600e3).toISOString(), ...r })).join('\n') + '\n');
  rows('h-run', [{ state: 'needs_you', because: 'Which logo?', held: true }, { state: 'needs_you', because: 'Which logo?', held: true },
    { state: 'needs_you', because: 'Which logo?' }]);
  assert.equal(selfreport.read('h-run').askedAt, '2026-11-01T12:00:00.000Z', 'the real ask is dated from when it was asked, not held');
  rows('h-rehold', [{ state: 'needs_you', because: 'Which logo?' }, { state: 'needs_you', because: 'Which logo?', held: true }]);
  assert.equal(selfreport.read('h-rehold').askedAt, '2026-11-01T11:00:00.000Z', 'held again is a new hold');
  rows('h-same', [{ state: 'needs_you', because: 'Which logo?', held: true }, { state: 'needs_you', because: 'Which logo?', held: true }]);
  assert.equal(selfreport.read('h-same').askedAt, '2026-11-01T10:00:00.000Z', 'CONTROL: re-holding the same question does not re-date it');
});

test('a held question is never stale; the same question unheld still is', () => {
  const threeDaysLater = Date.now() + 3 * 24 * 3600 * 1000;
  assert.equal(selfreport.untilDefers({ state: 'needs_you', held: true }, threeDaysLater), true);
  assert.equal(selfreport.untilDefers({ state: 'needs_you', held: false }, threeDaysLater), false, 'CONTROL');
  assert.equal(selfreport.untilDefers({ state: 'blocked', held: true }, threeDaysLater), false, 'held means nothing on blocked');
});

test('the board card carries stateHeld from the report', () => {
  const at = new Date().toISOString();
  const held = status.reconcileReport({ found: true, state: 'needs_you', by: 'agent', because: 'q', held: true, at }, { state: 'idle' }, Date.now());
  assert.equal(held.state, 'needs_you');
  assert.equal(held.held, true);
  const plain = status.reconcileReport({ found: true, state: 'needs_you', by: 'agent', because: 'q', held: false, at }, { state: 'idle' }, Date.now());
  assert.equal(plain.held, false, 'CONTROL');
});

test('the word: "Question held" on the engine copy and the page, calm, and the phone tone of a question', () => {
  const HELD = { state: 'needs_you', stateReportedBy: 'agent', stateHeld: true };
  const PLAIN = { state: 'needs_you', stateReportedBy: 'agent', stateHeld: false };
  assert.equal(cardlabel.labelOf(HELD), 'Question held');
  assert.equal(cardlabel.labelOf(PLAIN), 'Question', 'CONTROL');
  assert.equal(cardlabel.labelOf({ state: 'needs_you', stateReportedBy: 'auto', stateHeld: true }), 'Issue', 'only the agent\'s own question is held');
  assert.equal(cardlabel.toneOf(HELD, true), 'asked');
  assert.equal(cardlabel.reasonOf(HELD, true), 'question');
  const PAGE = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  const grab = (re, what) => { const m = PAGE.match(re); assert.ok(m, 'CONTROL: ' + what + ' was not found in the page'); return m[0]; };
  const { stateCopyOf } = new Function(
    grab(/\nconst STATE_COPY = \{[\s\S]*?\n\};\n/, 'STATE_COPY')
    + grab(/\nfunction restartingLabel\(a\) \{[\s\S]*?\n\}\n/, 'restartingLabel')
    + grab(/\nfunction stateCopyOf\(a\) \{[\s\S]*?\n\}\n/, 'stateCopyOf')
    + '\nreturn { stateCopyOf };')();
  assert.deepEqual(stateCopyOf(HELD), { label: cardlabel.QUESTION_HELD, attn: false });
  assert.equal(stateCopyOf(PLAIN).label, 'Question', 'CONTROL');
});

test('the Recommender does not convene peers on a held question', () => {
  const row = { sessionName: 's', name: 'S', state: 'needs_you', stateReportedBy: 'agent', stateProject: 'p1', because: 'q' };
  assert.ok(recommender.stuckRow(row), 'CONTROL: the unheld question is one it may help with');
  assert.equal(recommender.stuckRow({ ...row, stateHeld: true }), null);
});

test('the note on the person\'s next message: held says they are back; unheld is unchanged', () => {
  const held = chat.dmStandingQuestionNote('Which logo?', { held: true });
  assert.match(held, /you held a question until this person was back, and they are writing to you now: "Which logo\?"/);
  assert.match(held, /without --held/);
  assert.match(held, /unless they said to keep holding/);
  assert.doesNotMatch(held, /[\u0000-\u001f]/, 'it is typed into a pane');
  const plain = chat.dmStandingQuestionNote('Which logo?');
  assert.match(plain, /your question to this person is still open on the board/, 'CONTROL');
  assert.doesNotMatch(plain, /held/);
  assert.equal(chat.dmStandingQuestionNote('', { held: true }), '', 'no question, no note');
});
