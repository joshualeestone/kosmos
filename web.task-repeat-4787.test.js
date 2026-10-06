'use strict';
/* kosmos#4787: the Tasks row's repeat line, from the page's real functions (repeatWhen, tskRepeatSentence, tskRow).
   The rule's words and the next run come from the board; the page only says them. */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const page = require('./test-support/page');

const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));
const { repeatWhen, tskRepeatSentence } = new Function('tskAgentName',
  page.liftAll(SCRIPT, ['agoWords', 'repeatWhen', 'tskRepeatSentence']) + '\nreturn { repeatWhen, tskRepeatSentence };')((s) => (s === 'ada' ? 'Ada' : s));
const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime();
const NOW = at(2026, 10, 6, 8, 0);   // a Tuesday, 8am local

test('#4787: repeatWhen says today, tomorrow, a weekday, or a date, in local time', () => {
  assert.equal(repeatWhen(at(2026, 10, 6, 9, 0), NOW), 'today at 9am');
  assert.equal(repeatWhen(at(2026, 10, 7, 9, 30), NOW), 'tomorrow at 9:30am');
  assert.equal(repeatWhen(at(2026, 10, 12, 13, 0), NOW), 'Monday at 1pm');
  assert.match(repeatWhen(at(2026, 10, 20, 0, 0), NOW), / at 12am$/);
  assert.doesNotMatch(repeatWhen(at(2026, 10, 20, 0, 0), NOW), /^(today|tomorrow|Monday|Tuesday)/, 'two weeks out names the date');
});

test('#4787: the sentence says the rule, the last run (who, when, its note) and the next run; with no run it says so', () => {
  const t = { repeat: { every: 'day', at: '09:00' }, repeatWords: 'every day at 9am', repeatNextAt: at(2026, 10, 6, 9, 0),
    lastRunAt: new Date(NOW - 2 * 3600000).toISOString(), lastRunBy: 'ada', lastRunNote: 'found 3 new listings' };
  assert.equal(tskRepeatSentence(t, NOW), 'Repeats every day at 9am. Last run 2 hours ago by Ada: found 3 new listings. Next today at 9am.');
  assert.equal(tskRepeatSentence({ ...t, lastRunAt: undefined, lastRunBy: undefined, lastRunNote: undefined }, NOW),
    'Repeats every day at 9am. No run reported yet. Next today at 9am.');
  assert.equal(tskRepeatSentence({ ...t, lastRunBy: 'operator', lastRunNote: undefined }, NOW), 'Repeats every day at 9am. Last run 2 hours ago by you. Next today at 9am.');
});

test('#4787: a repeating task\'s row carries the line; a one-off and a closed one do not (controls)', () => {
  const row = (t) => new Function('TSK', 'LAST', 'esc', 'agoWords', 'tskKey', 'claimNotReported', 'tskAgentName', 'tskRepeatSentence', 'TSK_GROUPS',
    page.liftAll(SCRIPT, ['tskRow']) + '\nreturn tskRow;')({ sel: new Set(), by: 'status', fold: new Set() }, [], (s) => String(s), () => 'just now',
    (x) => x.projectId + '#' + x.number, () => '', (s) => s, tskRepeatSentence, [])(t, { depth: 0, crumb: false, kids: 0 });
  const base = { number: 4, sentence: 'Hourly monitor', projectId: 'p1', projectName: 'Watch', createdAt: new Date(NOW).toISOString(), state: 'assigned', who: 'ada' };
  const rep = { ...base, repeat: { every: 'hour' }, repeatWords: 'every hour', repeatNextAt: at(2026, 10, 6, 9, 0) };
  assert.match(row(rep), /<div class="why tsk-repeat">Repeats every hour\. No run reported yet\. Next today at 9am\.<\/div>/);
  assert.doesNotMatch(row(base), /tsk-repeat/);
  assert.doesNotMatch(row({ ...rep, state: 'closed' }), /tsk-repeat/);
});
