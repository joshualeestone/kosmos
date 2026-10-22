'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#4273: CI fails a run that leaves them)

/**
 * kosmos#6893: a task can repeat every so many minutes ({ every: 'minutes', n }), on the multiples of n from local
 * midnight, so "every 30 minutes" is a rule and not an hourly task the person settles for. The rule is checked whole,
 * said in words, scheduled slot by slot as the clock gives them, and sized for the graces by its own period.
 *
 * ⚠️ SANDBOX BOTH ROOTS BEFORE REQUIRING anything that reads them.
 *
 *   node --test engine/taskrepeat-minutes-6893.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-repmin-data-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-repmin-proj-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('./taskrepeat');
const projects = require('./projects');
const tasks = require('./tasks');
const taskchat = require('./taskchat');

const at = (h, m, day = 22) => new Date(2026, 9, day, h, m, 0, 0).getTime();   // Thursday 22 October 2026, local

test('#6893: the rule is checked whole: n divides the day, from 5 to 720, and takes nothing else', () => {
  for (const n of [5, 10, 15, 20, 30, 45, 60, 90, 120, 360, 720]) assert.equal(r.repeatProblem({ every: 'minutes', n }), null, String(n));
  for (const n of [0, 4, 7, 25, 50, 721, 1440, 30.5, '30', undefined, NaN]) {
    assert.match(String(r.repeatProblem({ every: 'minutes', n })), /divides the day evenly/, String(n));
  }
  assert.match(r.repeatProblem({ every: 'minutes', n: 30, at: '09:00' }), /takes only the number of minutes/);
  assert.match(r.repeatProblem({ every: 'minutes', n: 30, day: 1 }), /takes only the number of minutes/);
  assert.match(r.repeatProblem({ every: 'minutes', n: 30, minute: 5 }), /takes only the number of minutes/);
  // CONTROL: the other rules still check as before, and an unknown frequency names the new one too.
  assert.equal(r.repeatProblem({ every: 'hour', minute: 15 }), null);
  assert.equal(r.repeatProblem({ every: 'day', at: '09:00' }), null);
  assert.match(r.repeatProblem({ every: 'fortnight' }), /every so many minutes, every hour, every day or every week/);
});

test('#6893: stored with only its own fields, and said in words', () => {
  assert.deepEqual(r.normalise({ every: 'minutes', n: 30, junk: 1 }), { every: 'minutes', n: 30 });
  assert.equal(r.describe({ every: 'minutes', n: 30 }), 'every 30 minutes');
  assert.equal(r.describe({ every: 'minutes', n: 45 }), 'every 45 minutes');
  assert.equal(r.describe({ every: 'minutes', n: 60 }), 'every 60 minutes');
  assert.equal(r.describe({ every: 'minutes', n: 120 }), 'every 2 hours');
  assert.equal(r.describe({ every: 'minutes', n: 90 }), 'every 90 minutes');
  assert.equal(r.describe({ every: 'minutes', n: 7 }), '', 'a rule that does not check out says nothing');
});

test('#6893: the CLI word (30m, 2h) and the screen form (minutes + at) make the same rule', () => {
  for (const w of ['30m', '30min', '30mins', '30 minutes', '30M']) assert.deepEqual(r.fromWords(w), { every: 'minutes', n: 30 }, w);
  for (const w of ['2h', '2hrs', '2 hours']) assert.deepEqual(r.fromWords(w), { every: 'minutes', n: 120 }, w);
  assert.deepEqual(r.fromWords('minutes', { at: '30' }), { every: 'minutes', n: 30 });
  assert.deepEqual(r.fromWords('minutes', { at: ' 45 ' }), { every: 'minutes', n: 45 });
  // A bad number still makes a minutes rule, so the board refuses it with the minutes sentence, not "how often".
  for (const bad of [r.fromWords('minutes', { at: 'half' }), r.fromWords('minutes'), r.fromWords('7m')]) {
    assert.match(String(r.repeatProblem(bad)), /divides the day evenly/, JSON.stringify(bad));
  }
  // CONTROL: the old words are untouched.
  assert.deepEqual(r.fromWords('hourly', { at: ':15' }), { every: 'hour', minute: 15 });
  assert.deepEqual(r.fromWords('daily', { at: '09:00' }), { every: 'day', at: '09:00' });
});

test('#6893: the next run is the next multiple of n from midnight, and tomorrow begins at midnight', () => {
  const half = { every: 'minutes', n: 30 };
  assert.equal(r.nextAfter(half, at(9, 10)), at(9, 30));
  assert.equal(r.nextAfter(half, at(9, 30)), at(10, 0), 'strictly after: a slot is not its own next');
  assert.equal(r.nextAfter(half, at(23, 50)), at(0, 0, 23), 'past the last slot of the day: midnight');
  assert.equal(r.nextAfter({ every: 'minutes', n: 90 }, at(1, 0)), at(1, 30));
  assert.equal(r.nextAfter({ every: 'minutes', n: 90 }, at(22, 31)), at(0, 0, 23), '22:30 is the last 90-minute slot');
  assert.equal(r.nextAfter({ every: 'minutes', n: 720 }, at(12, 0)), at(0, 0, 23));
  assert.equal(r.nextAfter({ every: 'minutes', n: 7 }, at(9, 0)), null, 'a rule that does not check out has no next run');
});

test('#6893: a daylight-saving day is walked slot by slot without going backwards or stalling', () => {
  const rule = { every: 'minutes', n: 30 };
  // 1 November 2026 (US clocks go back) and 8 March 2026 (forward), from the day before to the day after.
  for (const [y, mo, d] of [[2026, 10, 1], [2026, 2, 8]]) {
    let s = new Date(y, mo, d - 1, 23, 0).getTime();
    const end = new Date(y, mo, d + 1, 1, 0).getTime();
    let steps = 0;
    while (s < end) {
      const next = r.nextAfter(rule, s);
      assert.ok(next > s, 'every next run is later than the last: ' + new Date(s).toString());
      assert.ok(next - s <= 90 * 60000, 'and never more than an hour and a half later (the extra hour at most)');
      s = next;
      steps += 1;
    }
    assert.ok(steps >= 46 && steps <= 52, 'about two slots an hour across the day: ' + steps);
  }
});

test('#6893: the graces are sized by the interval, not by an hour', () => {
  const half = { every: 'minutes', n: 30 };
  // missGraceFor is a quarter of gapOf, which for this rule is its period (neither is exported).
  assert.equal(r.missGraceFor({ every: 'minutes', n: 20 }), 5 * 60000);
  // CONTROL: an hourly rule's graces, which a 30-minute rule must be tighter than.
  assert.ok(r.missGraceFor(half) < r.missGraceFor({ every: 'hour' }), 'a 30-minute job is missed sooner than an hourly one');
  assert.equal(r.missGraceFor(half), 7.5 * 60000, 'a quarter of the interval');
});

test('#6893: a task made to repeat every 30 minutes stores the rule, says it, and is due on its slots', () => {
  const p = projects.create({ name: 'Rep min ' + Math.random().toString(36).slice(2) });
  const n = tasks.create(p.id, { sentence: 'Check the queue' }).number;
  const t = tasks.setRepeat(p.id, n, r.fromWords('30m'), { person: true });
  assert.deepEqual(t.repeat, { every: 'minutes', n: 30 });
  const ev = taskchat.read(p.id, n).find((e) => e.kind === 'repeat-set');
  assert.equal(ev.words, 'every 30 minutes');
  assert.equal(ev.every, 'minutes');
  // Due on the slot after the rule was set, then not again until the next slot after a run.
  const setAt = Date.parse(t.repeatSetAt);
  const due = r.nextAfter(t.repeat, setAt);
  assert.ok(due - setAt <= 30 * 60000 && due > setAt);
  assert.equal(r.waitingForNextRun(t, due - 1000), true, 'before its slot it is waiting');
  assert.equal(r.waitingForNextRun(t, due + 1000), false, 'at its slot it is due');
  // A bad number is refused whole, with the sentence, and the stored rule stays.
  assert.throws(() => tasks.setRepeat(p.id, n, r.fromWords('7m'), { person: true }), /divides the day evenly/);
  assert.deepEqual(tasks.byNumber(projects.readAll().find((x) => x.id === p.id), n).repeat, { every: 'minutes', n: 30 });
});
