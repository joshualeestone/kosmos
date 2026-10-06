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
