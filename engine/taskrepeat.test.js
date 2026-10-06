'use strict';
// kosmos#4787: the repeat rule's checks, its next run in local time, and its words.
const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('./taskrepeat');

const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime();   // local time, as the rule is

test('#4787: repeatProblem takes the three shapes and refuses everything else with a sentence', () => {
  assert.equal(r.repeatProblem({ every: 'hour' }), null);
  assert.equal(r.repeatProblem({ every: 'hour', minute: 15 }), null);
  assert.equal(r.repeatProblem({ every: 'day', at: '09:00' }), null);
  assert.equal(r.repeatProblem({ every: 'week', day: 1, at: '23:59' }), null);
  assert.equal(r.repeatProblem(null), null, 'null clears');
  for (const bad of [{ every: 'month', at: '09:00' }, { every: 'day', at: '9:00' }, { every: 'day', at: '24:00' }, { every: 'day' },
    { every: 'week', at: '09:00' }, { every: 'week', day: 7, at: '09:00' }, { every: 'hour', minute: 60 }, { every: 'hour', at: '09:00' },
    { every: 'day', at: '09:00', day: 1 }, 'daily', [], { every: 'hour', minute: 1.5 }]) {
    assert.equal(typeof r.repeatProblem(bad), 'string', 'accepted ' + JSON.stringify(bad));
  }
});

test('#4787: nextAfter is the first scheduled time STRICTLY after the given moment, in local time', () => {
  // hourly at :15
  assert.equal(r.nextAfter({ every: 'hour', minute: 15 }, at(2026, 10, 6, 9, 10)), at(2026, 10, 6, 9, 15));
  assert.equal(r.nextAfter({ every: 'hour', minute: 15 }, at(2026, 10, 6, 9, 15)), at(2026, 10, 6, 10, 15), 'on the slot itself: the next one');
  assert.equal(r.nextAfter({ every: 'hour' }, at(2026, 10, 6, 23, 30)), at(2026, 10, 7, 0, 0), 'across midnight');
  // daily at 09:00
  assert.equal(r.nextAfter({ every: 'day', at: '09:00' }, at(2026, 10, 6, 8, 59)), at(2026, 10, 6, 9, 0));
  assert.equal(r.nextAfter({ every: 'day', at: '09:00' }, at(2026, 10, 6, 9, 2)), at(2026, 10, 7, 9, 0));
  assert.equal(r.nextAfter({ every: 'day', at: '09:00' }, at(2026, 10, 31, 10, 0)), at(2026, 11, 1, 9, 0), 'across a month end');
  // weekly: 2026-10-06 is a Tuesday (day 2)
  assert.equal(new Date(at(2026, 10, 6, 12, 0)).getDay(), 2, 'precondition: the fixture date is a Tuesday');
  assert.equal(r.nextAfter({ every: 'week', day: 2, at: '13:00' }, at(2026, 10, 6, 12, 0)), at(2026, 10, 6, 13, 0), 'later the same day');
  assert.equal(r.nextAfter({ every: 'week', day: 2, at: '09:00' }, at(2026, 10, 6, 12, 0)), at(2026, 10, 13, 9, 0), 'same weekday, time passed: a week on');
  assert.equal(r.nextAfter({ every: 'week', day: 1, at: '09:00' }, at(2026, 10, 6, 12, 0)), at(2026, 10, 12, 9, 0), 'Monday after a Tuesday');
  assert.equal(r.nextAfter(null, at(2026, 10, 6, 12, 0)), null);
  assert.equal(r.nextAfter({ every: 'day', at: 'nope' }, at(2026, 10, 6, 12, 0)), null, 'a bad rule has no next run');
});

test('#4787: describe says the rule as a person would, and fromWords reads the CLI\'s words', () => {
  assert.equal(r.describe({ every: 'hour' }), 'every hour');
  assert.equal(r.describe({ every: 'hour', minute: 5 }), 'every hour at :05');
  assert.equal(r.describe({ every: 'day', at: '09:00' }), 'every day at 9am');
  assert.equal(r.describe({ every: 'day', at: '13:30' }), 'every day at 1:30pm');
  assert.equal(r.describe({ every: 'day', at: '00:00' }), 'every day at 12am');
  assert.equal(r.describe({ every: 'week', day: 1, at: '09:30' }), 'every Monday at 9:30am');
  assert.deepEqual(r.fromWords('daily', { at: '09:00' }), { every: 'day', at: '09:00' });
  assert.deepEqual(r.fromWords('hour', { at: ':15' }), { every: 'hour', minute: 15 });
  assert.deepEqual(r.fromWords('hourly'), { every: 'hour' });
  assert.deepEqual(r.fromWords('weekly', { on: 'Mon', at: '09:30' }), { every: 'week', day: 1, at: '09:30' });
  assert.equal(typeof r.repeatProblem(r.fromWords('week', { on: 'xx', at: '09:30' })), 'string', 'an unknown day is refused, not guessed');
  assert.equal(typeof r.repeatProblem(r.fromWords('hour', { at: 'ab' })), 'string');
  assert.equal(typeof r.repeatProblem(r.fromWords('fortnight')), 'string');
});

test('#4787: a run note is optional, text, and capped', () => {
  assert.equal(r.noteProblem(undefined), null);
  assert.equal(r.noteProblem('found 3 new listings'), null);
  assert.equal(typeof r.noteProblem(5), 'string');
  assert.equal(typeof r.noteProblem('x'.repeat(r.NOTE_MAX + 1)), 'string');
});

test('#4787 review 1: across the US spring-forward night a 02:30 rule is 02:30 again the next day (TZ pinned in a child)', () => {
  const { execFileSync } = require('node:child_process');
  const src = "const r=require(" + JSON.stringify(require.resolve('./taskrepeat')) + ");"
    + "const f=(x)=>{const d=new Date(x);return d.getMonth()+1+'/'+d.getDate()+' '+d.getHours()+':'+String(d.getMinutes()).padStart(2,'0')};"
    + "const at=(mo,d,h,mi)=>new Date(2026,mo-1,d,h,mi).getTime();"
    + "console.log(JSON.stringify([f(r.nextAfter({every:'day',at:'02:30'},at(3,8,3,45))),f(r.nextAfter({every:'week',day:1,at:'02:30'},at(3,8,12,0))),f(r.nextAfter({every:'day',at:'02:30'},at(3,7,23,0))),f(r.nextAfter({every:'hour',minute:30},at(3,8,1,45)))]));";
  const out = JSON.parse(execFileSync(process.execPath, ['-e', src], { env: { ...process.env, TZ: 'America/Chicago' } }).toString());
  assert.equal(out[0], '3/9 2:30', 'daily, asked after the jump: the next day keeps 02:30');
  assert.equal(out[1], '3/9 2:30', 'weekly Monday 02:30, asked on the Sunday of the jump');
  assert.equal(out[2], '3/8 3:30', 'the skipped 02:30 itself lands where the clock puts it (03:30), as local time does');
  assert.equal(out[3], '3/8 3:30', 'hourly :30 across the gap: 03:30');
});

test('#4787 review 1: waitingForNextRun: between runs a repeating task holds no work; due again once a slot has passed', () => {
  const now = at(2026, 10, 6, 10, 0);
  const base = { repeat: { every: 'day', at: '09:00' }, createdAt: new Date(at(2026, 10, 1, 8, 0)).toISOString() };
  assert.equal(r.waitingForNextRun({ ...base, lastRunAt: new Date(at(2026, 10, 6, 9, 2)).toISOString() }, now), true, 'ran at 9:02 today: waits for tomorrow');
  assert.equal(r.waitingForNextRun({ ...base, lastRunAt: new Date(at(2026, 10, 5, 9, 2)).toISOString() }, now), false, 'last ran yesterday, today\'s 9:00 passed: due');
  assert.equal(r.waitingForNextRun(base, now), false, 'never ran, a slot since it was made has passed: due');
  assert.equal(r.waitingForNextRun({ sentence: 'one-off' }, now), false, 'CONTROL: a task that does not repeat is never waiting');
});

test('#4787 review 2: a run reported a little early is that slot\'s run; a run stamped in the future makes the task due', () => {
  const base = { repeat: { every: 'day', at: '09:00' }, createdAt: new Date(at(2026, 10, 1, 8, 0)).toISOString() };
  assert.equal(r.waitingForNextRun({ ...base, lastRunAt: new Date(at(2026, 10, 6, 8, 59) + 50000).toISOString() }, at(2026, 10, 6, 9, 5)), true,
    'ran at 08:59:50 for the 09:00 slot: at 09:05 it is waiting for tomorrow, not due again');
  assert.equal(r.waitingForNextRun({ ...base, lastRunAt: new Date(at(2026, 10, 9, 9, 0)).toISOString() }, at(2026, 10, 6, 10, 0)), false,
    'a run stamped days in the future cannot say when it last ran: due, never hidden');
  assert.equal(r.waitingForNextRun({ ...base, lastRunAt: new Date(at(2026, 10, 6, 9, 0) + 30000).toISOString() }, at(2026, 10, 6, 9, 0)), true,
    'CONTROL: a stamp 30 seconds ahead (ordinary clock skew) is still that slot\'s run');
});

test('#4787 review 3: the grace is for a run, never for when the task was made; and a late hourly run leaves the next slot due', () => {
  const made = { repeat: { every: 'day', at: '09:00' }, createdAt: new Date(at(2026, 10, 6, 8, 55)).toISOString() };
  assert.equal(r.waitingForNextRun(made, at(2026, 10, 6, 9, 30)), false, 'made at 08:55 and never run: due at 09:30, not tomorrow');
  assert.equal(r.waitingForNextRun(made, at(2026, 10, 6, 8, 58)), true, 'CONTROL: before its first slot it is waiting');
  const hourly = { repeat: { every: 'hour' }, createdAt: made.createdAt, lastRunAt: new Date(at(2026, 10, 6, 9, 55)).toISOString() };
  assert.equal(r.waitingForNextRun(hourly, at(2026, 10, 6, 10, 1)), false, 'a 09:55 run (late, for 09:00) leaves 10:00 due');
  const early = { ...hourly, lastRunAt: new Date(at(2026, 10, 6, 9, 59) + 50000).toISOString() };
  assert.equal(r.waitingForNextRun(early, at(2026, 10, 6, 10, 1)), true, 'a 09:59:50 run is the 10:00 run: waiting for 11:00');
});

test('#4787 review 5: a changed rule is measured from when it changed: a slot before the change is not missed', () => {
  const t = { repeat: { every: 'day', at: '07:00' }, createdAt: new Date(at(2026, 9, 1, 8, 0)).toISOString(),
    lastRunAt: new Date(at(2026, 10, 5, 9, 0)).toISOString(), repeatSetAt: new Date(at(2026, 10, 6, 8, 0)).toISOString() };
  assert.equal(r.waitingForNextRun(t, at(2026, 10, 6, 8, 30)), true, 'changed to 07:00 at 08:00 today: next is tomorrow 07:00');
  assert.equal(r.waitingForNextRun(t, at(2026, 10, 7, 7, 30)), false, 'CONTROL: tomorrow\'s 07:00 passes with no run: due');
});

test('#4787 slice 1b: fieldsOf says the rule and the next run for an open repeating task; nothing for a closed or one-off one', () => {
  const now = new Date(2026, 9, 6, 8, 0, 0).getTime();
  const f = r.fieldsOf({ repeat: { every: 'day', at: '09:00' } }, now);
  assert.equal(f.repeatWords, 'every day at 9am');
  assert.equal(f.repeatNextAt, new Date(2026, 9, 6, 9, 0, 0).getTime());
  assert.deepEqual(r.fieldsOf({ repeat: { every: 'day', at: '09:00' }, isClosed: true }, now), {});
  assert.deepEqual(r.fieldsOf({ repeat: { every: 'day', at: '09:00' }, closedAt: '2026-10-06T12:00:00Z' }, now), {});
  assert.deepEqual(r.fieldsOf({}, now), {}, 'CONTROL: a one-off task');
});

test('#4787 slice 2: missedRuns: a slot is missed once its time plus the grace passes with no run; not a moment before', () => {
  const t = { repeat: { every: 'day', at: '09:00' }, repeatSetAt: new Date(at(2026, 10, 5, 12, 0)).toISOString(),
    lastRunAt: new Date(at(2026, 10, 5, 9, 3)).toISOString() };
  // The 10-06 09:00 slot: the grace is 15 minutes.
  assert.equal(r.missedRuns(t, at(2026, 10, 6, 9, 0)), null, 'at the slot itself: not missed');
  assert.equal(r.missedRuns(t, at(2026, 10, 6, 9, 14)), null, 'inside the grace: a job a few minutes late is not missed');
  assert.deepEqual(r.missedRuns(t, at(2026, 10, 6, 9, 15)), { count: 1, more: false, lastAt: at(2026, 10, 6, 9, 0) }, 'at the grace: missed');
  // A run since the slot clears it.
  const ran = { ...t, lastRunAt: new Date(at(2026, 10, 6, 9, 40)).toISOString() };
  assert.equal(r.missedRuns(ran, at(2026, 10, 6, 12, 0)), null, 'a late run answers the slot');
  // Three days dead: three slots, the latest named.
  assert.deepEqual(r.missedRuns(t, at(2026, 10, 8, 10, 0)), { count: 3, more: false, lastAt: at(2026, 10, 8, 9, 0) });
});

test('#4787 slice 2: the miss grace is the smaller of 15 minutes and a quarter of the period, and hourly counts are capped', () => {
  assert.equal(r.missGraceFor({ every: 'hour' }), 15 * 60 * 1000);
  assert.equal(r.missGraceFor({ every: 'day', at: '09:00' }), 15 * 60 * 1000);
  assert.equal(r.missGraceFor({ every: 'week', day: 1, at: '09:00' }), 15 * 60 * 1000);
  // An hourly job dead for a week: the count stops at the cap and says there were more.
  const t = { repeat: { every: 'hour', minute: 0 }, repeatSetAt: new Date(at(2026, 10, 1, 0, 30)).toISOString() };
  const m = r.missedRuns(t, at(2026, 10, 8, 0, 30));
  assert.equal(m.count, r.MISSED_CAP);
  assert.equal(m.more, true);
  assert.equal(m.lastAt, at(2026, 10, 8, 0, 0), 'review 1: the latest missed slot is the real latest, not the 99th from the start');
  // CONTROL: one day of it is under the cap, so `more` can be false (the flag is not always true).
  const d = r.missedRuns(t, at(2026, 10, 1, 12, 20));
  assert.deepEqual([d.count, d.more], [12, false], "01:00 to 12:00, the noon slot past its grace at 12:15");
});

test('#4787 slice 2: no miss is claimed where there is nothing to measure from, nor on a closed, one-off or future-stamped task', () => {
  const now = at(2026, 10, 9, 12, 0);
  assert.equal(r.missedRuns({ repeat: { every: 'day', at: '09:00' } }, now), null, 'no stamp at all');
  assert.equal(r.missedRuns({ sentence: 'one-off', createdAt: new Date(at(2026, 10, 1, 0, 0)).toISOString() }, now), null);
  const old = { repeat: { every: 'day', at: '09:00' }, repeatSetAt: new Date(at(2026, 10, 1, 0, 0)).toISOString() };
  assert.ok(r.missedRuns(old, now), 'CONTROL: the same task open is missed');
  assert.equal(r.missedRuns({ ...old, isClosed: true }, now), null, 'closed');
  assert.equal(r.missedRuns({ ...old, lastRunAt: new Date(now + 3600000).toISOString() }, now), null, 'a run stamped in the future');
  // A rule set after the slot passed: that slot is not missed (review 5's rule, kept by the shared dueSlot).
  assert.equal(r.missedRuns({ repeat: { every: 'day', at: '09:00' }, repeatSetAt: new Date(at(2026, 10, 9, 10, 0)).toISOString() }, now), null);
});

test('#4787 slice 2: fieldsOf adds the missed count and the latest missed slot in words; nothing when no run is missed', () => {
  const t = { repeat: { every: 'day', at: '09:00' }, repeatSetAt: new Date(at(2026, 10, 5, 12, 0)).toISOString() };
  const f = r.fieldsOf(t, at(2026, 10, 6, 10, 0));
  assert.equal(f.repeatMissed, 1);
  assert.equal(f.repeatMissedMore, false);
  assert.equal(f.repeatMissedAt, at(2026, 10, 6, 9, 0));
  assert.equal(f.repeatMissedWords, 'today at 9am');
  assert.equal(f.repeatNextWords, 'tomorrow at 9am', 'the next run is still said');
  const ok = r.fieldsOf(t, at(2026, 10, 6, 8, 0));
  assert.equal('repeatMissed' in ok, false, 'before the slot: no missed fields at all');
});

test('#4787 slice 2: waitingForNextRun is unchanged by sharing dueSlot (the nudge and the Assigner read it)', () => {
  const t = { repeat: { every: 'day', at: '09:00' }, repeatSetAt: new Date(at(2026, 10, 5, 12, 0)).toISOString() };
  assert.equal(r.waitingForNextRun(t, at(2026, 10, 6, 8, 59)), true);
  assert.equal(r.waitingForNextRun(t, at(2026, 10, 6, 9, 0)), false, 'due at the slot itself, before any miss grace');
  assert.equal(r.waitingForNextRun({ repeat: { every: 'day', at: '09:00' } }, at(2026, 10, 6, 9, 0)), false, 'no stamp: shown as work');
});

test('#4787 slice 2: whenWords says a past slot as yesterday or its weekday, and a date beyond a week (control: the future is unchanged)', () => {
  const now = at(2026, 10, 6, 12, 0);   // a Tuesday
  assert.equal(r.whenWords(at(2026, 10, 6, 9, 0), now), 'today at 9am');
  assert.equal(r.whenWords(at(2026, 10, 5, 9, 0), now), 'yesterday at 9am');
  assert.equal(r.whenWords(at(2026, 10, 3, 9, 30), now), 'Saturday at 9:30am');
  assert.equal(r.whenWords(at(2026, 9, 29, 9, 0), now), 'Sep 29 at 9am', 'a week back is a date, never an ambiguous weekday');
  assert.equal(r.whenWords(at(2026, 10, 7, 9, 0), now), 'tomorrow at 9am');
  assert.equal(r.whenWords(at(2026, 10, 9, 9, 0), now), 'Friday at 9am');
});

test('#4787 slice 2 review 1: a run up to the miss grace early answers its slot, so it is never called missed (control: 20 minutes early is not)', () => {
  const base = { repeat: { every: 'day', at: '09:00' }, repeatSetAt: new Date(at(2026, 10, 1, 12, 0)).toISOString() };
  const early = { ...base, lastRunAt: new Date(at(2026, 10, 6, 8, 50)).toISOString() };
  assert.equal(r.missedRuns(early, at(2026, 10, 6, 9, 30)), null, 'ran at 08:50 for 09:00');
  assert.equal(r.missedRuns(early, at(2026, 10, 7, 9, 20)).lastAt, at(2026, 10, 7, 9, 0), 'the next day is still counted when missed');
  const tooEarly = { ...base, lastRunAt: new Date(at(2026, 10, 6, 8, 40)).toISOString() };
  assert.deepEqual(r.missedRuns(tooEarly, at(2026, 10, 6, 9, 30)), { count: 1, more: false, lastAt: at(2026, 10, 6, 9, 0) });
});

test('#4787 slice 2 review 1: latestAtOrBefore is the latest slot at or before a moment, never before `from`', () => {
  const rule = { every: 'day', at: '09:00' };
  assert.equal(r.latestAtOrBefore(rule, at(2026, 10, 3, 9, 0), at(2026, 10, 6, 9, 5)), at(2026, 10, 6, 9, 0));
  assert.equal(r.latestAtOrBefore(rule, at(2026, 10, 3, 9, 0), at(2026, 10, 6, 9, 0)), at(2026, 10, 6, 9, 0), 'a slot exactly at the moment counts');
  assert.equal(r.latestAtOrBefore(rule, at(2026, 10, 6, 9, 0), at(2026, 10, 6, 8, 0)), null, 'before `from`: none');
  assert.equal(r.latestAtOrBefore(rule, null, at(2026, 10, 6, 8, 0)), null);
  assert.equal(r.latestAtOrBefore({ every: 'week', day: 1, at: '09:00' }, at(2026, 9, 7, 9, 0), at(2026, 10, 6, 12, 0)), at(2026, 10, 5, 9, 0), 'weekly, weeks later');
});

test('#4787 slice 2 review 2: runIsLate depends only on the rule and the run\'s time: early is on time, past the grace is late', () => {
  const day = { repeat: { every: 'day', at: '09:00' }, repeatSetAt: new Date(at(2026, 10, 1, 12, 0)).toISOString() };
  assert.equal(r.runIsLate(day, at(2026, 10, 6, 8, 48)), false, 'a daily job reporting at 08:48 for 09:00 is early, not late');
  assert.equal(r.runIsLate(day, at(2026, 10, 6, 9, 14)), false, 'inside the grace after its slot');
  assert.equal(r.runIsLate(day, at(2026, 10, 6, 9, 15)), true, 'at the grace: late');
  assert.equal(r.runIsLate(day, at(2026, 10, 6, 16, 0)), true, 'in the afternoon: late');
  assert.equal(r.runIsLate(day, at(2026, 10, 1, 13, 0)), false, 'before the rule\'s first slot: never late');
  const hour = { repeat: { every: 'hour', minute: 0 }, repeatSetAt: new Date(at(2026, 10, 1, 0, 30)).toISOString() };
  for (const m of [45, 50, 57]) assert.equal(r.runIsLate(hour, at(2026, 10, 6, 8, m)), false, 'an hourly job reporting at 8:' + m + ' for 9:00 is early');
  assert.equal(r.runIsLate(hour, at(2026, 10, 6, 8, 30)), true, 'CONTROL: half past is late for an hourly job');
  assert.equal(r.runIsLate({ sentence: 'one-off' }, at(2026, 10, 6, 8, 30)), false);
});

test('#4787 slice 2 review 2: a run made under the OLD rule does not answer the new rule\'s first slot', () => {
  // Hourly, ran at 08:50; changed to daily 9am at 08:55. The 9am slot is the new rule's, so missing it is a miss.
  const t = { repeat: { every: 'day', at: '09:00' }, repeatSetAt: new Date(at(2026, 10, 6, 8, 55)).toISOString(),
    lastRunAt: new Date(at(2026, 10, 6, 8, 50)).toISOString() };
  assert.deepEqual(r.missedRuns(t, at(2026, 10, 6, 9, 30)), { count: 1, more: false, lastAt: at(2026, 10, 6, 9, 0) });
  // CONTROL: the same run made after the rule changed answers it.
  assert.equal(r.missedRuns({ ...t, lastRunAt: new Date(at(2026, 10, 6, 8, 56)).toISOString() }, at(2026, 10, 6, 9, 30)), null);
});
