'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)

/**
 * kosmos#9142: a repeating task's occurrences, one row each (due, delivered, and what the review did with a miss).
 *
 *   node --test engine/taskrepeat-occurrences-9142.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { occurrences } = require('./taskrepeat');

// A daily task at 09:00, its rule set on 11-20 at 08:00 (local time, as the rule's slots are).
const D = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime();
const task = (extra = {}) => ({ repeat: { every: 'day', at: '09:00' }, repeatSetAt: new Date(D(20, 8)).toISOString(), ...extra });
const iso = (ms) => new Date(ms).toISOString();

test('an on-time run and a late run are delivered rows, each with the slot it answered', () => {
  const rows = [
    { at: iso(D(21, 9, 2)), kind: 'run', by: 'nova' },
    { at: iso(D(22, 11)), kind: 'run', by: 'nova', late: true },
  ];
  const got = occurrences(task(), rows, D(22, 12));
  assert.deepEqual(got[0], { kind: 'delivered', due: iso(D(22, 9)), at: iso(D(22, 11)), late: true, by: 'nova' });
  assert.deepEqual(got[1], { kind: 'delivered', due: iso(D(21, 9)), at: iso(D(21, 9, 2)), late: false, by: 'nova' });
  assert.equal(got[2].kind, 'missed', 'the 20th 09:00 slot (after the rule was set at 08:00) had no run');
});

test('a slot with no run is missed, one row per slot; a record names only its own slot', () => {
  const rows = [
    { at: iso(D(20, 9, 1)), kind: 'run', by: 'nova' },
    // told on the 22nd about the stretch (21st and 22nd): it names the 22nd only, and adds no count
    { at: iso(D(22, 10)), kind: 'missed', slot: iso(D(22, 9)), count: 2, told: 'quill', reached: true },
  ];
  const got = occurrences(task(), rows, D(23, 12));
  assert.deepEqual(got.map((r) => [r.due, r.kind, r.review || null]), [
    [iso(D(23, 9)), 'missed', null], [iso(D(22, 9)), 'missed', 'told'], [iso(D(21, 9)), 'missed', null], [iso(D(20, 9)), 'delivered', null]]);
  assert.ok(!got.some((r) => 'count' in r), 'a row carries a stretch count');
});

test('review 2 A/B: no slot is counted twice, however the records overlap', () => {
  const rows = [
    { at: iso(D(20, 9, 1)), kind: 'run', by: 'nova' },
    { at: iso(D(21, 10)), kind: 'missed', slot: iso(D(21, 9)), count: 1, told: 'quill', reached: true },
    { at: iso(D(22, 10)), kind: 'missed', slot: iso(D(22, 9)), count: 2, told: 'quill', reached: true },
    { at: iso(D(22, 14)), kind: 'run', by: 'nova', late: true, missedBefore: 1 },
  ];
  const got = occurrences(task(), rows, D(22, 15));
  const dues = got.map((r) => r.due);
  assert.equal(new Set(dues).size, dues.length, 'a slot twice: ' + JSON.stringify(got));
  // E: the 22nd was told missed, then delivered late: ONE row says both.
  const d22 = got.find((r) => r.due === iso(D(22, 9)));
  assert.equal(d22.kind, 'delivered'); assert.equal(d22.late, true); assert.equal(d22.review, 'told');
});

test('review 2 C: an unreachable reviewer recorded once still leaves every later missed slot a row', () => {
  const rows = [
    { at: iso(D(20, 9, 1)), kind: 'run', by: 'nova' },
    { at: iso(D(21, 10)), kind: 'missed', slot: iso(D(21, 9)), count: 1, told: 'quill', reached: false },
  ];
  const got = occurrences(task(), rows, D(24, 12));
  assert.deepEqual(got.filter((r) => r.kind === 'missed').map((r) => r.due), [iso(D(24, 9)), iso(D(23, 9)), iso(D(22, 9)), iso(D(21, 9))]);
});

test('review 2 D: a run before the rule\'s first slot answered none: due is null, never a made-up time', () => {
  const t = { repeat: { every: 'day', at: '09:00' }, repeatSetAt: new Date(D(20, 10)).toISOString() };   // first slot: 21st 09:00
  const got = occurrences(t, [{ at: iso(D(20, 15)), kind: 'run', by: 'nova' }], D(20, 16));
  assert.deepEqual(got, [{ kind: 'delivered', due: null, at: iso(D(20, 15)), late: false, by: 'nova' }]);
});

test('review 2 F: two runs for one slot are one row (the first)', () => {
  const rows = [{ at: iso(D(21, 9, 1)), kind: 'run', by: 'nova' }, { at: iso(D(21, 9, 5)), kind: 'run', by: 'quill' }];
  const got = occurrences(task(), rows, D(21, 10)).filter((r) => r.due === iso(D(21, 9)));
  assert.equal(got.length, 1); assert.equal(got[0].by, 'nova');
});

test('a slot still inside its miss grace is not missed yet; rows before the rule are left out; capped at 10', () => {
  assert.ok(!occurrences(task(), [], D(20, 9, 5)).some((r) => r.kind === 'missed'), 'missed inside the grace');
  const old = occurrences(task(), [{ at: iso(D(19, 9)), kind: 'run', by: 'old' }], D(20, 10));
  assert.ok(!old.some((r) => r.by === 'old'), 'a run from before the rule');
  assert.equal(occurrences(task(), [], D(30, 12)).length, 10);
});

test('CONTROL: not a repeating task, or junk input, gives no rows and never throws', () => {
  assert.deepEqual(occurrences({}, [], Date.now()), []);
  assert.deepEqual(occurrences(task(), null), []);
  assert.doesNotThrow(() => occurrences(task(), [null, 3, { kind: 'run' }, { at: 'x', kind: 'run' }], D(21, 12)));
});
