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
  const got = occurrences(task({ lastRunAt: iso(D(22, 11)) }), rows, D(22, 12));
  assert.equal(got.length, 2);
  assert.deepEqual(got[0], { kind: 'delivered', due: iso(D(22, 9)), at: iso(D(22, 11)), late: true, by: 'nova' });
  assert.deepEqual(got[1], { kind: 'delivered', due: iso(D(21, 9)), at: iso(D(21, 9, 2)), late: false, by: 'nova' });
});

test('a recorded miss says what the review did: told, unreached, or asked the person', () => {
  const rows = [
    { at: iso(D(21, 10)), kind: 'missed', slot: iso(D(21, 9)), count: 1, told: 'quill', reached: true },
    { at: iso(D(22, 10)), kind: 'missed', slot: iso(D(22, 9)), count: 1, told: 'quill', reached: false },
    { at: iso(D(23, 10)), kind: 'missed', slot: iso(D(23, 9)), count: 2, person: true },
  ];
  const got = occurrences(task({ lastRunAt: iso(D(23, 12)) }), rows, D(23, 12));
  assert.deepEqual(got.map((r) => [r.due, r.review, r.who || null]), [
    [iso(D(23, 9)), 'asked', null], [iso(D(22, 9)), 'unreached', 'quill'], [iso(D(21, 9)), 'told', 'quill']]);
});

test('a stretch of misses open now, not yet recorded, is one row that claims nothing about the review', () => {
  const t = task({ repeatReviewer: 'quill', lastRunAt: iso(D(20, 9, 1)) });
  const rows = [{ at: iso(D(20, 9, 1)), kind: 'run', by: 'nova' }];
  const got = occurrences(t, rows, D(22, 12));
  assert.equal(got[0].kind, 'missed');
  assert.equal(got[0].review, 'open');
  assert.equal(got[0].open, true);
  assert.equal(got[0].count, 2, 'the 21st and the 22nd');
  assert.equal(got[1].kind, 'delivered');
});

test('review 1: once a miss in the stretch is recorded, no open row double-counts it', () => {
  const t = task({ repeatReviewer: 'quill', lastRunAt: iso(D(20, 9, 1)) });
  const rows = [{ at: iso(D(20, 9, 1)), kind: 'run', by: 'nova' },
    { at: iso(D(21, 10)), kind: 'missed', slot: iso(D(21, 9)), count: 1, told: 'quill', reached: true }];
  const got = occurrences(t, rows, D(22, 12));
  assert.equal(got.filter((r) => r.kind === 'missed').length, 1, 'a second, overlapping missed row');
  assert.equal(got[0].review, 'told');
});

test('review 1: an unreachable reviewer\'s later misses never read as "not told yet"', () => {
  const t = task({ repeatReviewer: 'quill', lastRunAt: iso(D(20, 9, 1)) });
  const rows = [{ at: iso(D(20, 9, 1)), kind: 'run', by: 'nova' },
    { at: iso(D(21, 10)), kind: 'missed', slot: iso(D(21, 9)), count: 1, told: 'quill', reached: false }];
  const got = occurrences(t, rows, D(23, 12));
  assert.ok(!got.some((r) => r.review === 'pending' || r.review === 'open'), JSON.stringify(got));
});

test('review 1: misses a later run recovered are a row (no reviewer, so nothing else recorded them)', () => {
  const rows = [{ at: iso(D(20, 9, 1)), kind: 'run', by: 'nova' },
    { at: iso(D(23, 9, 5)), kind: 'run', by: 'nova', missedBefore: 2 }];
  const got = occurrences(task({ lastRunAt: iso(D(23, 9, 5)) }), rows, D(23, 10));
  const rec = got.find((r) => r.review === 'recovered');
  assert.ok(rec, JSON.stringify(got));
  assert.equal(rec.count, 2);
  assert.equal(rec.due, iso(D(22, 9)), 'dated by the last slot before the recovering run');
  // CONTROL: when a recorded miss covers that stretch, no second row.
  const told = rows.concat([{ at: iso(D(21, 10)), kind: 'missed', slot: iso(D(21, 9)), count: 2, person: true }]);
  assert.equal(occurrences(task({ lastRunAt: iso(D(23, 9, 5)) }), told, D(23, 10)).filter((r) => r.kind === 'missed').length, 1);
});

test('rows from before the rule was set are left out', () => {
  // Few rows, so the cap cannot be what hides the old one.
  const rows = [{ at: iso(D(19, 9)), kind: 'run', by: 'old' }, { at: iso(D(21, 9, 1)), kind: 'run', by: 'nova' }];
  const got = occurrences(task({ lastRunAt: iso(D(21, 9, 1)) }), rows, D(21, 10));
  assert.deepEqual(got.map((r) => r.by), ['nova'], 'a run from before the rule was shown');
});

test('newest first, capped at 10', () => {
  const rows = [];
  for (let d = 20; d <= 30; d += 1) rows.push({ at: iso(D(d, 9, 1)), kind: 'run', by: 'nova' });
  const got = occurrences(task({ lastRunAt: iso(D(30, 9, 1)) }), rows, D(30, 10));
  assert.equal(got.length, 10, 'not capped at 10');
  assert.equal(got[0].at, iso(D(30, 9, 1)));
  assert.equal(got[9].at, iso(D(21, 9, 1)));
});

test('CONTROL: not a repeating task, or junk input, gives no rows and never throws', () => {
  assert.deepEqual(occurrences({}, [], Date.now()), []);
  assert.deepEqual(occurrences(task(), null), []);
  assert.deepEqual(occurrences(task(), [null, 3, { kind: 'run' }, { at: 'x', kind: 'run' }], D(21, 12)).filter((r) => r.kind === 'delivered'), []);
});
