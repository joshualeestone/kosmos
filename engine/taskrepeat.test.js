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
