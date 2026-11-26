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

test('review 3: a run in the early window shows at once, before its slot\'s time', () => {
  const got = occurrences(task(), [{ at: iso(D(26, 8, 45)), kind: 'run', by: 'nova' }], D(26, 8, 50));
  assert.equal(got[0].kind, 'delivered');
  assert.equal(got[0].due, iso(D(26, 9)));
  assert.equal(got[0].late, false);
});

test('review 3: late is computed from the slot, so a record without the late field still reads late', () => {
  const got = occurrences(task(), [{ at: iso(D(22, 11)), kind: 'run', by: 'nova' }], D(22, 12));
  assert.equal(got.find((r) => r.due === iso(D(22, 9))).late, true);
});

test('review 3: a long history gives the same rows, without a slot sum for every old run', () => {
  const t = { repeat: { every: 'minutes', n: 15 }, repeatSetAt: new Date(D(1, 0) - 365 * 864e5).toISOString() };
  const rows = [];
  for (let at = Date.parse(t.repeatSetAt) + 15 * 60e3 + 60e3; at < D(26, 12); at += 15 * 60e3) rows.push({ at: iso(at), kind: 'run', by: 'nova' });
  const recent = rows.slice(-12);
  assert.ok(rows.length > 30000, 'the fixture is not long: ' + rows.length);
  assert.deepEqual(occurrences(t, rows, D(26, 12)), occurrences(t, recent, D(26, 12)), 'old runs changed the rows shown');
  /* Not a fixed deadline (a load assertion): the cost against a plain scan of the same rows, timed side by side, so load
     moves both. Measured: 1.3x with the floor, about 30x without it. */
  const time = (f) => { const a = process.hrtime.bigint(); for (let i = 0; i < 3; i += 1) f(); return Number(process.hrtime.bigint() - a); };
  const scan = time(() => { let n = 0; for (const r of rows) if (Number.isFinite(Date.parse(r.at))) n += 1; return n; });
  const occ = time(() => occurrences(t, rows, D(26, 12)));
  assert.ok(occ / scan < 8, 'occurrences took ' + (occ / scan).toFixed(1) + 'x a plain scan of ' + rows.length + ' runs');
});

test('review 4: a run stamped in the future answers nothing (as dueSlot reads it)', () => {
  const got = occurrences(task(), [{ at: iso(D(22, 9, 5)), kind: 'run', by: 'nova' }], D(21, 12));
  assert.ok(!got.some((r) => r.kind === 'delivered'), JSON.stringify(got));
  // CONTROL: within a minute ahead still counts (a clock a few seconds off).
  assert.ok(occurrences(task(), [{ at: iso(D(21, 12) + 30e3), kind: 'run', by: 'nova' }], D(21, 12)).some((r) => r.kind === 'delivered'));
});

test('review 4: a closed task stops at its close: no missed rows after it', () => {
  const t = task({ isClosed: true, closedAt: iso(D(21, 10)) });
  const got = occurrences(t, [{ at: iso(D(20, 9, 1)), kind: 'run', by: 'nova' }], D(25, 12));
  assert.deepEqual(got.map((r) => r.due), [iso(D(21, 9)), iso(D(20, 9))], JSON.stringify(got));
});

test('CONTROL: not a repeating task, or junk input, gives no rows and never throws', () => {
  assert.deepEqual(occurrences({}, [], Date.now()), []);
  assert.deepEqual(occurrences(task(), null), []);
  assert.doesNotThrow(() => occurrences(task(), [null, 3, { kind: 'run' }, { at: 'x', kind: 'run' }], D(21, 12)));
});
