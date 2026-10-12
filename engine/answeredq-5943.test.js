'use strict';
/* kosmos#5943: an answered agent question stayed drawn as the newest DM bubble (12 days in Josh's case), with its
   badge, until the agent cleared it. Engine half: when the question was first asked (selfreport askedAt), the row
   placed at that time (chat.withQuestionRow), the note that hands the agent the decision when the person writes
   (chat.dmStandingQuestionNote), and the instructions that keep reversible choices from becoming questions. */
require('../test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-answeredq-5943-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const selfreport = require('./selfreport');
const chat = require('./chat');
const defaults = require('./defaults');

/* Writes report lines with chosen times (record() stamps the clock, and the run-start rule is about times). */
function writeReports(name, rows) {
  const file = selfreport.fileFor(name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

test('#5943 askedAt is when the standing question was FIRST asked, not its latest re-report', () => {
  writeReports('asker', [
    { state: 'working', at: '2026-09-30T20:00:00.000Z' },
    { state: 'needs_you', because: 'Should the privacy lines change?', at: '2026-09-30T23:17:00.000Z' },
    { state: 'needs_you', because: 'Should the privacy lines change?', at: '2026-10-05T10:00:00.000Z' },
    { state: 'needs_you', because: 'Should the privacy lines change?', at: '2026-10-12T09:00:00.000Z' },
  ]);
  const r = selfreport.read('asker');
  assert.equal(r.state, 'needs_you');
  assert.equal(r.at, '2026-10-12T09:00:00.000Z', 'control: the latest line is the newest (the time that moves)');
  assert.equal(r.askedAt, '2026-09-30T23:17:00.000Z', 'the question dates from its first ask');
});

test('#5943 a DIFFERENT question starts a new ask; a non-waiting state has no askedAt', () => {
  writeReports('switcher', [
    { state: 'needs_you', because: 'Old question?', at: '2026-10-01T00:00:00.000Z' },
    { state: 'needs_you', because: 'New question?', at: '2026-10-02T00:00:00.000Z' },
  ]);
  assert.equal(selfreport.read('switcher').askedAt, '2026-10-02T00:00:00.000Z', 'a new question is dated afresh');
  writeReports('cleared', [
    { state: 'needs_you', because: 'Q?', at: '2026-10-01T00:00:00.000Z' },
    { state: 'working', by: 'operator', at: '2026-10-02T00:00:00.000Z' },
  ]);
  const c = selfreport.read('cleared');
  assert.equal(c.state, 'working');
  assert.equal(c.askedAt, null, 'nothing is waiting, so nothing was asked');
  // The same words asked again after a clear are a new ask, dated from the new line.
  writeReports('again', [
    { state: 'needs_you', because: 'Q?', at: '2026-10-01T00:00:00.000Z' },
    { state: 'working', at: '2026-10-02T00:00:00.000Z' },
    { state: 'needs_you', because: 'Q?', at: '2026-10-03T00:00:00.000Z' },
  ]);
  assert.equal(selfreport.read('again').askedAt, '2026-10-03T00:00:00.000Z');
});

test('#5943 a dated question takes its place in time: the answer and later messages sit BELOW it', () => {
  const msgs = [
    { at: '2026-09-30T20:00:00.000Z', text: 'earlier', from: 'casey' },
    { at: '2026-10-12T14:00:00.000Z', text: 'Yes, change them.', from: null },
    { at: '2026-10-12T14:05:00.000Z', text: 'later', from: 'casey' },
  ];
  const out = chat.withQuestionRow(msgs, 'casey', { text: 'Should the privacy lines change?', reported: true, clearable: true, at: '2026-09-30T23:17:00.000Z' });
  assert.deepEqual(out.map((m) => m.text), ['earlier', 'Should the privacy lines change?', 'Yes, change them.', 'later']);
  const q = out[1];
  assert.equal(q.at, '2026-09-30T23:17:00.000Z', 'dated from the ask, a time that does not move between polls');
  assert.equal(q.id, 'needs-you-question:casey', 'the stable id is unchanged');
  assert.equal(q.clearable, true);
  assert.equal(msgs.length, 3, 'the caller-owned array is not mutated');
  // Two polls give the same row in the same place (no per-poll clock).
  assert.deepEqual(chat.withQuestionRow(msgs, 'casey', { text: 'Should the privacy lines change?', at: '2026-09-30T23:17:00.000Z' })[1].at, q.at);
});

test('#5943 placement ignores undated rows, dedups a question the agent typed after the ask, and keeps the undated rule', () => {
  // A row with no readable time does not drag the question past later dated rows.
  const mixed = [
    { at: '2026-10-01T00:00:00.000Z', text: 'a', from: null },
    { at: '2026-10-03T00:00:00.000Z', text: 'c', from: null },
    { at: null, text: 'odd', from: null },
  ];
  assert.deepEqual(chat.withQuestionRow(mixed, 'x', { text: 'Q?', at: '2026-10-02T00:00:00.000Z' }).map((m) => m.text), ['a', 'Q?', 'c', 'odd']);
  // Older than everything shown: first.
  assert.equal(chat.withQuestionRow(mixed, 'x', { text: 'Q?', at: '2026-09-01T00:00:00.000Z' })[0].text, 'Q?');
  // The agent typed the same words at or after the ask, even with a newer row after it: already in the thread.
  const typed = [
    { at: '2026-10-02T00:00:00.000Z', text: 'Q?', from: 'x' },
    { at: '2026-10-03T00:00:00.000Z', text: 'answer', from: null },
  ];
  assert.equal(chat.withQuestionRow(typed, 'x', { text: 'Q?', at: '2026-10-02T00:00:00.000Z' }).length, 2);
  // Control: the same words typed BEFORE the ask (an earlier, separate question) do not suppress it.
  const before = [{ at: '2026-10-01T00:00:00.000Z', text: 'Q?', from: 'x' }];
  assert.equal(chat.withQuestionRow(before, 'x', { text: 'Q?', at: '2026-10-02T00:00:00.000Z' }).length, 2);
  // Undated (a question read off the screen): appended last and undated, exactly as before.
  const live = chat.withQuestionRow(mixed, 'x', { text: 'Do you want to proceed?' });
  assert.equal(live[live.length - 1].text, 'Do you want to proceed?');
  assert.equal(live[live.length - 1].at, null);
  assert.equal(live[live.length - 1].clearable, undefined, 'only a reported question is clearable');
  // An unreadable `at` is treated as undated, never as the epoch.
  const bad = chat.withQuestionRow(mixed, 'x', { text: 'Q?', at: 'not a time' });
  assert.equal(bad[bad.length - 1].at, null);
});

test('#5943 the note hands the agent the decision and never says the question was answered', () => {
  const note = chat.dmStandingQuestionNote('Should the privacy\nlines change? \u202eevil');
  assert.match(note, /^ \[kosmos\] /, 'rides after the person\'s words like the reaction note');
  assert.match(note, /still open on the board: "Should the privacy lines change\?/);
  assert.match(note, /If this message answers it, act on the answer and run: kosmos report clear\./);
  assert.match(note, /If it does not, leave it open and tell them what you still need/);
  assert.doesNotMatch(note, /[\n\r\u202e]/, 'one line, no direction overrides: it is typed into a pane');
  assert.doesNotMatch(note, /answered\b(?! it)/i, 'Kosmos never claims the question was answered');
  assert.equal(chat.dmStandingQuestionNote(''), '');
  assert.equal(chat.dmStandingQuestionNote(null), '');
  const long = chat.dmStandingQuestionNote('word '.repeat(100));
  assert.ok(long.length < 400, 'only the question\'s start is quoted');
  assert.match(long, /…"/);
  assert.doesNotMatch(chat.dmStandingQuestionNote('say "yes"'), /"yes"/, 'quotes inside are softened so the quote stays one');
});

test('#5943 the agent instructions tie needs_you to the reversibility test and to clearing wherever it was answered', () => {
  const b = defaults.block();
  assert.match(b, /Before you ask, run the two questions under "Before you do something you\s+cannot take back"/);
  assert.match(b, /If both are yes, it is not a question for the person:\s+decide it, do it, and tell them as a Decided\./);
  assert.match(b, /\*\*Clear it when it is answered\*\* \(`kosmos report clear`\), \*\*wherever the answer\s+came\*\*/);
  // The test it points at is really in the block, under that heading (a pointer to nothing would be a dead rule).
  assert.match(b, /### Before you do something you cannot take back/);
  assert.ok(defaults.DOCTRINE_VERSION >= 29);
});
