'use strict';
/* kosmos#4787: the Tasks row's repeat line, from the page's real functions (tskRepeatSentence, tskRow).
   The rule's words and the next run come from the board; the page only says them. */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const page = require('./test-support/page');

const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));
const { tskRepeatSentence, tskRepeatMissed } = new Function('tskAgentName',
  page.liftAll(SCRIPT, ['agoWords', 'tskRepeatMissed', 'tskRepeatSentence']) + '\nreturn { tskRepeatSentence, tskRepeatMissed };')((s) => (s === 'ada' ? 'Ada' : s));
const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime();
const NOW = at(2026, 10, 6, 8, 0);   // a Tuesday, 8am local

test('#4787: the sentence says the rule, the last run (who, when, its note) and the next run; with no run it says so', () => {
  const t = { repeat: { every: 'day', at: '09:00' }, repeatWords: 'every day at 9am', repeatNextAt: at(2026, 10, 6, 9, 0), repeatNextWords: 'today at 9am',
    lastRunAt: new Date(NOW - 2 * 3600000).toISOString(), lastRunBy: 'ada', lastRunNote: 'found 3 new listings' };
  assert.equal(tskRepeatSentence(t, NOW), 'Repeats every day at 9am. Last run 2 hours ago by Ada: found 3 new listings. Next today at 9am.');
  assert.equal(tskRepeatSentence({ ...t, lastRunAt: undefined, lastRunBy: undefined, lastRunNote: undefined }, NOW),
    'Repeats every day at 9am. No run reported yet. Next today at 9am.');
  assert.equal(tskRepeatSentence({ ...t, lastRunBy: undefined, lastRunByPerson: true, lastRunNote: undefined }, NOW), 'Repeats every day at 9am. Last run 2 hours ago by you. Next today at 9am.');
  assert.equal(tskRepeatSentence({ ...t, lastRunBy: 'operator', lastRunNote: undefined }, NOW), 'Repeats every day at 9am. Last run 2 hours ago by operator. Next today at 9am.',
    'review 5: an agent named operator is not the person');
});

test('#4787: a repeating task\'s row carries the line; a one-off and a closed one do not (controls)', () => {
  const row = (t) => new Function('TSK', 'LAST', 'esc', 'agoWords', 'tskKey', 'claimNotReported', 'tskAgentName', 'tskRepeatSentence', 'tskRepeatMissed', 'TSK_GROUPS',
    page.liftAll(SCRIPT, ['tskRow']) + '\nreturn tskRow;')({ sel: new Set(), by: 'status', fold: new Set() }, [], (s) => String(s), () => 'just now',
    (x) => x.projectId + '#' + x.number, () => '', (s) => s, tskRepeatSentence, tskRepeatMissed, [])(t, { depth: 0, crumb: false, kids: 0 });
  const base = { number: 4, sentence: 'Hourly monitor', projectId: 'p1', projectName: 'Watch', createdAt: new Date(NOW).toISOString(), state: 'assigned', who: 'ada' };
  const rep = { ...base, repeat: { every: 'hour' }, repeatWords: 'every hour', repeatNextAt: at(2026, 10, 6, 9, 0), repeatNextWords: 'today at 9am' };
  assert.match(row(rep), /<div class="why tsk-repeat">Repeats every hour\. No run reported yet\. Next today at 9am\.<\/div>/);
  assert.doesNotMatch(row(base), /tsk-repeat/);
  assert.doesNotMatch(row({ ...rep, state: 'closed' }), /tsk-repeat/);
});

test('#4787 slice 1b: the task page reads a stored rule back into its controls (Sunday is 0; an hourly rule at any minute reads as Every hour)', () => {
  const SRC = page.scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));
  const days = /const TK_REPEAT_DAYS = (\[[^\]]+\]);/.exec(SRC);
  assert.ok(days, 'the page names its days');
  const stored = new Function('TK_REPEAT_DAYS', page.liftAll(SRC, ['tkRepeatStoredChoice']) + '\nreturn tkRepeatStoredChoice;')(eval(days[1]));
  assert.deepEqual(stored({ repeat: { every: 'week', day: 0, at: '09:30' } }), { every: 'week', on: 'sun', at: '09:30' });
  assert.deepEqual(stored({ repeat: { every: 'week', day: 2, at: '10:30' } }), { every: 'week', on: 'tue', at: '10:30' });
  assert.deepEqual(stored({ repeat: { every: 'day', at: '08:15' } }), { every: 'day', at: '08:15' });
  assert.deepEqual(stored({ repeat: { every: 'hour', minute: 30 } }), { every: 'hour' });
  assert.deepEqual(stored({}), { clear: true }, 'CONTROL: no rule reads as Never');
  // The page's day names are the ones the server reads (fromWords takes the first three letters).
  const { DAY_NAMES } = require('./engine/taskrepeat');
  assert.deepEqual(eval(days[1]), DAY_NAMES.map((n) => n.slice(0, 3).toLowerCase()));
});

test('#4787 slice 2: a missed run leads the sentence; more than one is counted; a late run says late (controls: none missed, on time)', () => {
  const t = { repeat: { every: 'day', at: '09:00' }, repeatWords: 'every day at 9am', repeatNextWords: 'tomorrow at 9am',
    lastRunAt: new Date(NOW - 26 * 3600000).toISOString(), lastRunBy: 'ada' };
  assert.match(tskRepeatSentence({ ...t, repeatMissed: 1, repeatMissedMore: false, repeatMissedWords: 'today at 9am' }, NOW),
    /^Missed the run due today at 9am\. Repeats every day at 9am\. Last run .+ by Ada\. Next tomorrow at 9am\.$/);
  assert.match(tskRepeatSentence({ ...t, repeatMissed: 3, repeatMissedMore: false, repeatMissedWords: 'today at 9am' }, NOW),
    /^Missed 3 runs, the latest due today at 9am\. Repeats every day at 9am\./);
  assert.match(tskRepeatSentence({ ...t, repeatMissed: 99, repeatMissedMore: true, repeatMissedWords: 'today at 9am' }, NOW),
    /^Missed more than 99 runs, the latest due today at 9am\./);
  assert.match(tskRepeatSentence(t, NOW), /^Repeats every day at 9am\./, 'CONTROL: nothing missed, nothing said about it');
  assert.match(tskRepeatSentence({ ...t, lastRunLate: true, lastRunNote: 'done' }, NOW), / by Ada, late: done\./);
  assert.doesNotMatch(tskRepeatSentence({ ...t, lastRunNote: 'done' }, NOW), /late/, 'CONTROL: an on-time run never says late');
});

test('#4787 slice 2: the row\'s repeat line is red (class missed) only while a run is missed', () => {
  const row = (t) => new Function('TSK', 'LAST', 'esc', 'agoWords', 'tskKey', 'claimNotReported', 'tskAgentName', 'tskRepeatSentence', 'tskRepeatMissed', 'TSK_GROUPS',
    page.liftAll(SCRIPT, ['tskRow']) + '\nreturn tskRow;')({ sel: new Set(), by: 'status', fold: new Set() }, [], (s) => String(s), () => 'just now',
    (x) => x.projectId + '#' + x.number, () => '', (s) => s, tskRepeatSentence, tskRepeatMissed, [])(t, { depth: 0, crumb: false, kids: 0 });
  const rep = { number: 4, sentence: 'Daily report', projectId: 'p1', projectName: 'Watch', createdAt: new Date(NOW).toISOString(), state: 'assigned', who: 'ada',
    repeat: { every: 'day', at: '09:00' }, repeatWords: 'every day at 9am', repeatNextWords: 'today at 9am' };
  assert.match(row({ ...rep, repeatMissed: 1, repeatMissedWords: 'yesterday at 9am' }), /<div class="why tsk-repeat missed">Missed the run due yesterday at 9am\./);
  assert.match(row(rep), /<div class="why tsk-repeat">Repeats/, 'CONTROL: not missed, not red');
  // The page's rule is wired to a colour (the class alone would do nothing).
  assert.match(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'), /\.tsk-row \.why\.tsk-repeat\.missed, #tk-repeat-line\.missed \{ color: var\(--danger\); \}/);
});

test('#4787 slice 2 review 5: an open Tasks view reads again once a shown slot passes its miss grace, and every 5 minutes while a row is red', () => {
  const stale = new Function(page.liftAll(SCRIPT, ['tskRepeatStale']) + '\nreturn tskRepeatStale;')();
  const read = at(2026, 10, 6, 8, 0);
  const row = { repeat: { every: 'day', at: '09:00' }, state: 'assigned', repeatMissAfter: at(2026, 10, 6, 9, 15) };
  assert.equal(stale([row], read, at(2026, 10, 6, 9, 14)), false, 'before the slot is missed: no read');
  assert.equal(stale([row], read, at(2026, 10, 6, 9, 15)), true, 'once it is: read');
  assert.equal(stale([{ ...row, state: 'closed' }], read, at(2026, 10, 6, 9, 15)), false, 'CONTROL: a closed row never asks');
  assert.equal(stale([{ sentence: 'one-off', state: 'assigned' }], read, at(2026, 10, 6, 9, 15)), false, 'CONTROL: a one-off never asks');
  const red = { ...row, repeatMissAfter: at(2026, 10, 7, 9, 15), repeatMissed: 1 };
  assert.equal(stale([red], read, read + 4 * 60000), false, 'red: not within 5 minutes of the last read');
  assert.equal(stale([red], read, read + 5 * 60000), true, 'red: read again after 5 minutes, so a reported run clears it');
  assert.equal(stale([row], at(2026, 10, 6, 9, 15), at(2026, 10, 6, 9, 15) + 10000), false, 'at most one read per 30 seconds');
  // Wired: the board poll's tskRosterChanged asks it, with the time of the last good read.
  assert.match(page.liftAll(SCRIPT, ['tskRosterChanged']), /tskRepeatStale\(TSK\.data, TSK\.readAt, Date\.now\(\)\)\) \{ tskLoad\(\); return; \}/);
  assert.match(SCRIPT, /TSK\.data = body\.tasks;\n\s+TSK\.readAt = Date\.now\(\);/, 'a good read stamps readAt');
});
