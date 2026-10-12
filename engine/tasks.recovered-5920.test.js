'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#4273: CI fails a run that leaves them)
/*
 * kosmos#5920: a recurring task's cycle failed, a retry held it, and the retry recovered hours later with ONE run. The
 * board counts missed runs from the last run, so the moment the recovery moved lastRunAt past the skipped cycles they
 * vanished from the count and from the history. A recovering run now records what it skipped
 * (taskrepeat.skippedBefore): on the task (lastRunRecovered) and on its history row (missedBefore).
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-rec-data-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-rec-proj-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('../engine/projects');
const tasks = require('../engine/tasks');
const taskchat = require('../engine/taskchat');
const taskrepeat = require('../engine/taskrepeat');

const D = (hm) => Date.parse('2026-10-12T' + hm + ':00Z');
const HOURLY = { every: 'hour' };
const hourly = (lastRunAt) => ({ repeat: taskrepeat.normalise(HOURLY), repeatSetAt: '2026-10-12T08:00:00Z', createdAt: '2026-10-12T08:00:00Z', ...(lastRunAt ? { lastRunAt } : {}) });

test('#5920: a run that recovers hours late names the runs it skipped, never the one it answers', () => {
  // Last ran 09:00; the 10:00 cycle failed and its retry held until 12:30. 12:00 is the slot the 12:30 run answers (late).
  const got = taskrepeat.skippedBefore(hourly('2026-10-12T09:00:00Z'), D('12:30'));
  assert.deepEqual(got, { count: 2, more: false, firstAt: D('10:00'), lastAt: D('11:00') });
  // CONTROL: the board's own missed count at the same moment counts the answered slot too, so the two differ by one.
  assert.equal(taskrepeat.missedRuns(hourly('2026-10-12T09:00:00Z'), D('12:30')).count, 3);
});

test('#5920: an on-time run, a slightly late one and an early one skipped nothing', () => {
  assert.equal(taskrepeat.skippedBefore(hourly('2026-10-12T09:00:00Z'), D('10:05')), null, 'on time');
  assert.equal(taskrepeat.skippedBefore(hourly('2026-10-12T09:00:00Z'), D('10:40')), null, 'late for 10:00 but nothing before it');
  assert.equal(taskrepeat.skippedBefore(hourly('2026-10-12T09:00:00Z'), D('09:55')), null, 'early for 10:00');
  assert.equal(taskrepeat.skippedBefore(hourly(null), D('08:30')), null, 'before the rule\'s first slot');
  assert.equal(taskrepeat.skippedBefore({ lastRunAt: '2026-10-12T09:00:00Z' }, D('12:30')), null, 'no rule');
  // Review 1: no time the rule was set (a legacy task): no answered slot to leave out, so nothing is claimed.
  assert.equal(taskrepeat.skippedBefore({ repeat: taskrepeat.normalise(HOURLY), lastRunAt: '2026-10-12T09:00:00Z' }, D('12:30')), null);
});

test('#5920 review 1: a run recorded by the nudge\'s deadline (the next slot less the grace) answers its own slot', () => {
  // Last ran 08:00; the 09:00 run overran and is recorded at 09:44, one minute inside the 09:45 deadline.
  const t = hourly('2026-10-12T08:00:00Z');
  assert.equal(taskrepeat.skippedBefore(t, D('09:44')), null, 'an obedient overrun is not after a missed run');
  assert.equal(taskrepeat.runIsLate(t, D('09:44')), true, 'it is late for 09:00, which it is');
  // CONTROL: recorded at 09:50, inside the grace, it answers 10:00 early and 09:00 counts as missed.
  assert.equal(taskrepeat.skippedBefore(t, D('09:50')).count, 1);
});

test('#5920 review 2: recordBy is before the next slot by more than the grace, on the minute, and none once passed', () => {
  const rules = [HOURLY, { every: 'day', at: '09:00' }, { every: 'day', at: ['09:00', '09:30'] }, { every: 'week', day: 1, at: '09:00' }];
  for (const rule of rules) {
    const r = taskrepeat.normalise(rule);
    const setAt = new Date(2026, 9, 1, 8, 0).getTime();
    const at = taskrepeat.nextAfter(r, setAt);
    const by = taskrepeat.recordBy(r, at, at);
    assert.ok(by !== null && by > at, JSON.stringify(rule) + ': no deadline after the due slot');
    assert.equal(by % 60000, 0, JSON.stringify(rule) + ': not on the minute');
    // A record a second before the named time answers the due slot itself: neither skipped nor answering the next.
    assert.equal(taskrepeat.answeredSlot(r, at, by - 1000), at, JSON.stringify(rule) + ': a record just before the deadline did not answer its own slot');
    const t = { repeat: r, repeatSetAt: new Date(setAt).toISOString() };
    assert.equal(taskrepeat.skippedBefore(t, by - 1000), null, JSON.stringify(rule) + ': an obedient record read as after a missed run');
    assert.equal(taskrepeat.recordBy(r, at, by), null, JSON.stringify(rule) + ': a deadline already reached is still named');
  }
  // The uneven pair rounds DOWN: 09:30 less 7.5 minutes is 09:22:30, named as 09:22.
  const pair = taskrepeat.normalise({ every: 'day', at: ['09:00', '09:30'] });
  const nine = taskrepeat.nextAfter(pair, new Date(2026, 9, 1, 8, 0).getTime());
  assert.equal(taskrepeat.recordBy(pair, nine, nine), nine + 22 * 60000);
});

test('#5920: an early run for the next slot still names the slots before it that never ran', () => {
  // Last ran 09:00; nothing at 10:00 or 11:00; a run at 11:50 answers 12:00 early, so 10:00 and 11:00 were skipped.
  const got = taskrepeat.skippedBefore(hourly('2026-10-12T09:00:00Z'), D('11:50'));
  assert.equal(got.count, 2);
  assert.equal(got.firstAt, D('10:00'));
  assert.equal(got.lastAt, D('11:00'));
});

test('#5920: a daily job that missed two days and ran late on the third names both days', () => {
  // The rule's 09:00 is the board's local time, so the fixture is built in local time too.
  const L = (d, h, m) => new Date(2026, 9, d, h, m).getTime();
  const t = { repeat: taskrepeat.normalise({ every: 'day', at: '09:00' }), repeatSetAt: new Date(L(1, 8, 0)).toISOString(), lastRunAt: new Date(L(9, 9, 2)).toISOString() };
  const got = taskrepeat.skippedBefore(t, L(12, 15, 0));
  assert.equal(got.count, 2, '10th and 11th skipped; the 12th is the slot this run answers');
  assert.equal(got.firstAt, L(10, 9, 0));
  assert.equal(got.lastAt, L(11, 9, 0));
});

test('#5920: past the cap the count says there were more', () => {
  const t = { ...hourly('2026-10-01T09:00:00Z'), repeatSetAt: '2026-09-30T08:00:00Z', createdAt: '2026-09-30T08:00:00Z' };
  const got = taskrepeat.skippedBefore(t, D('12:30'));
  assert.equal(got.count, taskrepeat.MISSED_CAP);
  assert.equal(got.more, true);
});

function freshHourly() {
  const p = projects.create({ name: 'Rec ' + Math.random().toString(36).slice(2) });
  const made = tasks.create(p.id, { sentence: 'Check the monitor' });
  tasks.setRepeat(p.id, made.number, HOURLY);
  return { id: p.id, n: made.number };
}
const stored = (id, n) => tasks.byNumber(projects.readAll().find((x) => x.id === id), n);

test('#5920: recordRun keeps the skipped runs on the task and on the recovering run\'s history row', () => {
  const { id, n } = freshHourly();
  const first = taskrepeat.nextAfter(HOURLY, Date.parse(stored(id, n).repeatSetAt));
  tasks.recordRun(id, n, 'ada', 'ok', first + 2 * 60000);   // on time
  assert.equal('lastRunRecovered' in stored(id, n), false, 'an on-time run recovers from nothing');
  // The next three slots pass with no run; the recovery lands 30 minutes after the third.
  const at = first + 3 * 3600000 + 30 * 60000;
  tasks.recordRun(id, n, 'ada', 'recovered after a retry', at);
  const rec = stored(id, n).lastRunRecovered;
  assert.equal(rec.missed, 2, 'the two slots before the one it answers');
  assert.equal(rec.from, new Date(first + 3600000).toISOString());
  assert.equal(rec.to, new Date(first + 2 * 3600000).toISOString());
  assert.equal('more' in rec, false);
  assert.equal(stored(id, n).lastRunLate, true, 'and it is late for the slot it answers');
  const runs = taskchat.read(id, n).filter((e) => e.kind === 'run');
  assert.deepEqual(runs.map((e) => e.missedBefore || 0), [0, 2], 'the history row says how many runs it came after');
  // The board's count has moved past them: the record is where they live now.
  assert.equal(taskrepeat.missedRuns(stored(id, n), at + 60000), null);
  // The next on-time run clears the mark on the task; the history keeps it.
  tasks.recordRun(id, n, 'ada', 'ok again', first + 4 * 3600000 + 60000);
  assert.equal('lastRunRecovered' in stored(id, n), false);
  assert.equal(taskchat.read(id, n).filter((e) => e.kind === 'run')[1].missedBefore, 2);
});

test('#5920: changing or clearing the rule drops the recovered mark (it was measured against the old rule)', () => {
  const { id, n } = freshHourly();
  const first = taskrepeat.nextAfter(HOURLY, Date.parse(stored(id, n).repeatSetAt));
  tasks.recordRun(id, n, 'ada', 'ok', first + 60000);
  tasks.recordRun(id, n, 'ada', 'late recovery', first + 3 * 3600000 + 30 * 60000);
  assert.ok(stored(id, n).lastRunRecovered, 'CONTROL: the mark is there before the change');
  tasks.setRepeat(id, n, { every: 'day', at: '09:00' });
  assert.equal('lastRunRecovered' in stored(id, n), false, 'a new rule');
  tasks.setRepeat(id, n, HOURLY);
  // The runs above are dated ahead of the clock, so the next is measured from the last run, as the board does.
  tasks.recordRun(id, n, 'ada', 'late recovery again', Date.parse(stored(id, n).lastRunAt) + 3 * 3600000 + 30 * 60000);
  assert.ok(stored(id, n).lastRunRecovered, 'CONTROL: marked again under the new rule');
  tasks.setRepeat(id, n, null);
  assert.equal('lastRunRecovered' in stored(id, n), false, 'the rule cleared');
});

test('#5920: a duplicate report of the recovering run records nothing twice', () => {
  const { id, n } = freshHourly();
  const first = taskrepeat.nextAfter(HOURLY, Date.parse(stored(id, n).repeatSetAt));
  tasks.recordRun(id, n, 'ada', 'ok', first + 60000);
  const at = first + 3 * 3600000 + 30 * 60000;
  tasks.recordRun(id, n, 'ada', 'recovered', at);
  const again = tasks.recordRun(id, n, 'ada', 'recovered', at + 10000);
  assert.equal(again.duplicate, true);
  assert.equal(taskchat.read(id, n).filter((e) => e.kind === 'run' && e.missedBefore).length, 1);
  assert.equal(stored(id, n).lastRunRecovered.missed, 2, 'the duplicate leaves the mark as the first report set it');
});
