'use strict';
// kosmos#5752: a daily repeat can run at several times a day.
const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('./taskrepeat');

const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime();   // local time, as the rule is
const iso = (ms) => new Date(ms).toISOString();
const TWICE = { every: 'day', at: ['09:00', '21:00'] };

test('#5752: a daily rule takes a list of times; a bad list, a weekly list and an hourly list are refused with a sentence', () => {
  assert.equal(r.repeatProblem(TWICE), null);
  assert.equal(r.repeatProblem({ every: 'day', at: ['21:00', '09:00', '13:30'] }), null, 'any order');
  assert.equal(r.repeatProblem({ every: 'day', at: ['09:00'] }), null, 'a list of one');
  const hours = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0') + ':00');
  assert.equal(r.repeatProblem({ every: 'day', at: hours }), null, 'every hour of the day is the most');
  for (const bad of [{ every: 'day', at: [] }, { every: 'day', at: ['09:00', '9:00'] }, { every: 'day', at: ['09:00', '09:00'] },
    { every: 'day', at: hours.concat(['00:30']) }, { every: 'day', at: ['09:00', 21] }, { every: 'week', day: 1, at: ['09:00', '21:00'] },
    { every: 'hour', at: ['09:00'] }]) {
    assert.equal(typeof r.repeatProblem(bad), 'string', 'accepted ' + JSON.stringify(bad));
  }
});

test('#5752: one time stays a string (old rules read as before); a list is stored sorted, so another order is the same rule', () => {
  assert.deepEqual(r.normalise({ every: 'day', at: '09:00' }), { every: 'day', at: '09:00' });
  assert.deepEqual(r.normalise({ every: 'day', at: ['09:00'] }), { every: 'day', at: '09:00' });
  assert.deepEqual(r.normalise({ every: 'day', at: ['21:00', '09:00'] }), TWICE);
  assert.equal(JSON.stringify(r.normalise({ every: 'day', at: ['21:00', '09:00'] })), JSON.stringify(r.normalise(TWICE)),
    'setRepeat compares stored rules as JSON');
});

test('#5752: the words, and the CLI form --at 09:00,21:00', () => {
  assert.equal(r.describe(TWICE), 'every day at 9am and 9pm');
  assert.equal(r.describe({ every: 'day', at: ['13:30', '09:00', '21:00'] }), 'every day at 9am, 1:30pm and 9pm');
  assert.equal(r.describe({ every: 'day', at: '09:00' }), 'every day at 9am', 'control: one time reads as before');
  assert.deepEqual(r.fromWords('daily', { at: '09:00,21:00' }), TWICE);
  assert.deepEqual(r.fromWords('daily', { at: '09:00, 21:00' }), TWICE, 'a space after the comma');
  assert.deepEqual(r.fromWords('daily', { at: '09:00' }), { every: 'day', at: '09:00' }, 'control: one time stays a string');
  assert.equal(typeof r.repeatProblem(r.fromWords('daily', { at: '09:00,' })), 'string', 'a trailing comma is refused, not dropped');
});

test('#5752: the next run is the next of the day\'s times, past midnight to the first one', () => {
  assert.equal(r.nextAfter(TWICE, at(2026, 10, 6, 8, 0)), at(2026, 10, 6, 9, 0));
  assert.equal(r.nextAfter(TWICE, at(2026, 10, 6, 9, 0)), at(2026, 10, 6, 21, 0), 'on the slot itself: the next one');
  assert.equal(r.nextAfter(TWICE, at(2026, 10, 6, 12, 0)), at(2026, 10, 6, 21, 0));
  assert.equal(r.nextAfter(TWICE, at(2026, 10, 6, 21, 30)), at(2026, 10, 7, 9, 0), 'past the last time: tomorrow\'s first');
  assert.equal(r.nextAfter({ every: 'day', at: ['21:00', '09:00'] }, at(2026, 10, 6, 8, 0)), at(2026, 10, 6, 9, 0),
    'an unsorted list still gives the earliest');
});

test('#5752: the graces come from the shortest gap between the times, wrapping past midnight', () => {
  assert.equal(r.missGraceFor(TWICE), 15 * 60 * 1000, 'twelve hours apart: the full 15 minutes');
  assert.equal(r.missGraceFor({ every: 'day', at: ['09:00', '09:30'] }), 7.5 * 60 * 1000, 'thirty minutes apart: a quarter of it');
  assert.equal(r.missGraceFor({ every: 'day', at: ['00:10', '23:50'] }), 5 * 60 * 1000, 'twenty minutes apart across midnight');
});

test('#5752: a lopsided pair\'s latest slot is found from the far side of its long gap', () => {
  const pair = { every: 'day', at: ['09:00', '09:30'] };
  assert.equal(r.latestAtOrBefore(pair, at(2026, 10, 1, 0, 0), at(2026, 10, 6, 20, 0)), at(2026, 10, 6, 9, 30));
  assert.equal(r.latestAtOrBefore(pair, at(2026, 10, 1, 0, 0), at(2026, 10, 7, 8, 59)), at(2026, 10, 6, 9, 30), 'just before the next day\'s first');
});

test('#5752: a twice-daily check: both runs are on time, a missed evening run is missed, and a late one is late', () => {
  const t = { repeat: TWICE, repeatSetAt: iso(at(2026, 10, 5, 12, 0)), lastRunAt: iso(at(2026, 10, 6, 9, 2)) };
  assert.equal(r.missedRuns(t, at(2026, 10, 6, 21, 14)), null, 'inside the grace');
  assert.deepEqual(r.missedRuns(t, at(2026, 10, 6, 21, 15)), { count: 1, more: false, lastAt: at(2026, 10, 6, 21, 0) }, 'the evening run missed');
  assert.equal(r.missedRuns({ ...t, lastRunAt: iso(at(2026, 10, 6, 21, 5)) }, at(2026, 10, 6, 23, 0)), null, 'the evening run answers it');
  assert.equal(r.runIsLate(t, at(2026, 10, 6, 9, 2)), false, 'morning run on time');
  assert.equal(r.runIsLate(t, at(2026, 10, 6, 21, 5)), false, 'evening run on time');
  assert.equal(r.runIsLate(t, at(2026, 10, 6, 21, 20)), true, 'evening run past the grace is late');
  assert.equal(r.waitingForNextRun({ ...t, lastRunAt: iso(at(2026, 10, 6, 9, 2)) }, at(2026, 10, 6, 15, 0)), true, 'between the two: waiting');
  assert.equal(r.waitingForNextRun({ ...t, lastRunAt: iso(at(2026, 10, 6, 9, 2)) }, at(2026, 10, 6, 21, 1)), false, 'evening due: work again');
  // Two days dead: four slots.
  assert.equal(r.missedRuns({ ...t, lastRunAt: iso(at(2026, 10, 5, 21, 0)) }, at(2026, 10, 7, 22, 0)).count, 4);
});

test('#5752: on the spring-forward night the next run is the EARLIEST time the clock gives, not the first in the list (TZ pinned in a child)', () => {
  const { execFileSync } = require('node:child_process');
  const src = "const r=require(" + JSON.stringify(require.resolve('./taskrepeat')) + ");"
    + "const f=(x)=>{const d=new Date(x);return d.getMonth()+1+'/'+d.getDate()+' '+d.getHours()+':'+String(d.getMinutes()).padStart(2,'0')};"
    + "console.log(JSON.stringify([f(r.nextAfter({every:'day',at:['02:30','03:00']},new Date(2026,2,8,1,0).getTime()))]));";
  const out = JSON.parse(execFileSync(process.execPath, ['-e', src], { env: { ...process.env, TZ: 'America/Chicago' } }).toString());
  assert.equal(out[0], '3/8 3:00', '02:30 does not exist that night (it would land at 03:30), so 03:00 comes first');
});
