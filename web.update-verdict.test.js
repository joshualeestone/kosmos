'use strict';

/**
 * #553: the update overlay decides what is true through one pure function,
 * and every branch is driven here. The rule under test: "it failed" is only
 * ever the installer's own word (a non-zero exit on THIS press's attempt,
 * matched by start stamp); a slow swap is "taking longer"; the board coming
 * back changed is done; coming back unchanged after going away is
 * did-not-take; the deadline settles rather than spins.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const script = raw.match(/<script>([\s\S]*?)<\/script>/)[1];
const start = script.indexOf('function updateVerdict(');
assert.ok(start > -1, 'updateVerdict vanished from the page');
let depth = 0; let end = -1;
for (let k = script.indexOf('{', start); k < script.length; k += 1) {
  if (script[k] === '{') depth += 1;
  else if (script[k] === '}') { depth -= 1; if (depth === 0) { end = k + 1; break; } }
}
// eslint-disable-next-line no-new-func
const updateVerdict = new Function(script.slice(start, end) + '\nreturn updateVerdict;')();

const MIN = 60 * 1000;
const base = { elapsedMs: 10 * 1000, sawDown: false, reached: true, before: '0.5.12', now: '0.5.12', attempt: null, myStart: '2026-08-24T16:00:00.000Z' };
const v = (over) => updateVerdict({ ...base, ...over });

test('while the board still answers the old version early on, the overlay waits', () => {
  assert.equal(v({}), 'waiting');
});

test('the board coming back on a NEW version is done, whether or not the dip was seen', () => {
  assert.equal(v({ now: '0.5.13' }), 'done');
  assert.equal(v({ now: '0.5.13', sawDown: true }), 'done');
});

test('the installer\'s own non-zero exit on THIS press is failed, and an old failure is not', () => {
  const failed = { startedAt: base.myStart, endedAt: '2026-08-24T16:00:09.000Z', code: 1, log: '/x/logs/install.log' };
  assert.equal(v({ attempt: failed }), 'failed');
  /* The same failure record from a PREVIOUS press must not fail this one:
     matched by exact start stamp, never by clocks. */
  assert.equal(v({ attempt: { ...failed, startedAt: '2026-08-24T15:00:00.000Z' } }), 'waiting');
  /* And a record that has not ended is not a verdict. */
  assert.equal(v({ attempt: { ...failed, endedAt: null, code: null } }), 'waiting');
  /* A zero exit is not a failure either (nothing to install is not a fault). */
  assert.equal(v({ attempt: { ...failed, code: 0 } }), 'waiting');
});

test('the board went away and came back on the SAME version: did not take', () => {
  assert.equal(v({ sawDown: true, now: '0.5.12' }), 'did-not-take');
  /* Gone and not yet back is still waiting, not a verdict. */
  assert.equal(v({ sawDown: true, reached: false, now: null }), 'waiting');
});

test('ninety seconds with the board never gone is slow; three minutes is the deadline, gone or not', () => {
  assert.equal(v({ elapsedMs: 91 * 1000 }), 'slow');
  assert.equal(v({ elapsedMs: 91 * 1000, sawDown: true, reached: false, now: null }), 'waiting',
    'a board that went away is working; slow is for one that never left');
  assert.equal(v({ elapsedMs: 3 * MIN + 1 }), 'deadline');
  assert.equal(v({ elapsedMs: 3 * MIN + 1, sawDown: true, reached: false, now: null }), 'deadline');
});

test('failed outranks everything, including a version that looks changed', () => {
  const failed = { startedAt: base.myStart, endedAt: '2026-08-24T16:00:09.000Z', code: 2, log: null };
  assert.equal(v({ attempt: failed, now: '0.5.13' }), 'failed');
});
