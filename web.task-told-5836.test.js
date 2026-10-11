'use strict';
/* kosmos#5836: a repeating task's line on the page says its last verified reading against what the person was last told,
   so a change the person never heard about shows. From the page's real functions, lifted (as web.task-runrollup-5643). */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const page = require('./test-support/page');

const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));
const NOW = Date.parse('2026-10-11T12:00:00Z');
const lib = new Function('LAST', page.liftAll(SCRIPT, ['esc', 'agoWords', 'tskAgentName', 'tskRepeatMissed', 'tskToldSentence', 'tskRepeatSentence'])
  + '\nreturn { tskRepeatSentence, tskToldSentence };')([]);
const hoursAgo = (h) => new Date(NOW - h * 3600000).toISOString();
const base = { repeatWords: 'every day at 9am', lastRunAt: hoursAgo(1), lastRunBy: 'mara' };

test('#5836: a reading that changed since the person was told says both, and when they were told', () => {
  const s = lib.tskRepeatSentence({ ...base, verified: { value: 'price is $45', at: hoursAgo(1) }, told: { value: 'price is $40', at: hoursAgo(26) } }, NOW);
  assert.match(s, /Its latest check found “price is \$45”\. When you were last told \([^)]*\), it was “price is \$40”\./);
});

test('#5836: a reading the same as what the person was told says so', () => {
  const s = lib.tskRepeatSentence({ ...base, verified: { value: 'status ok', at: hoursAgo(1) }, told: { value: 'status ok', at: hoursAgo(3) } }, NOW);
  assert.match(s, /You were last told “status ok” \([^)]*\), the same as its latest check\./);
});

test('#5836: a reading never told says the person has not been told it yet', () => {
  const s = lib.tskRepeatSentence({ ...base, verified: { value: '2 errors', at: hoursAgo(1) } }, NOW);
  assert.match(s, /Its latest check found “2 errors”\. You have not been told this yet\./);
});

test('#5836: CONTROL: a task with neither field adds nothing (the line reads as before)', () => {
  assert.equal(lib.tskToldSentence({ ...base }, NOW), '');
  const before = lib.tskRepeatSentence({ ...base }, NOW);
  assert.doesNotMatch(before, /told|check/);
  assert.match(before, /Repeats every day at 9am\. Last run /, 'control: the sentence did run');
});

test('#5836 review 1: told AFTER the reading, in other words, says the order as it happened (not "changed since")', () => {
  const s = lib.tskRepeatSentence({ ...base, verified: { value: 'price is $45', at: hoursAgo(3) }, told: { value: 'up to forty-five', at: hoursAgo(1) } }, NOW);
  assert.match(s, /You were last told \u201cup to forty-five\u201d \([^)]*\), after its latest check found \u201cprice is \$45\u201d\./);
  assert.doesNotMatch(s, /When you were last told/);
});
