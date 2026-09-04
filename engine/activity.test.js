'use strict';
/**
 * Activity: a per-(agent, pattern) line COUNT store for #1930's freshness tier.
 * The three-answers discipline (no-sample vs a real 0) is the load-bearing
 * property here -- a caller that reads no-sample as 0 would compute a spurious
 * increase and un-suppress on no evidence, the one direction #1930's guard must
 * never take.
 *
 *   node --test engine/activity.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-activity-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const activity = require('./activity');

test('record writes a count and time; read reads them back', () => {
  const r = activity.record('alpha', 'auth-error', 3);
  assert.equal(r.ok, true);
  assert.equal(r.count, 3);
  assert.ok(Number.isFinite(Date.parse(r.at)));
  const back = activity.read('alpha', 'auth-error');
  assert.equal(back.found, true);
  assert.equal(back.count, 3);
  assert.equal(back.at, r.at);
  assert.ok(back.ageMs >= 0);
});

test('THREE ANSWERS: no sample is found:false, and that is NOT a count of 0', () => {
  const back = activity.read('never-sampled', 'auth-error');
  assert.equal(back.found, false);
  // The crux: found:false must be distinguishable from a real recorded 0.
  activity.record('has-zero', 'auth-error', 0);
  const zero = activity.read('has-zero', 'auth-error');
  assert.equal(zero.found, true);
  assert.equal(zero.count, 0);
  // A caller comparing currentCount > baseline.count must be able to tell a
  // fresh 0-baseline apart from "no baseline yet".
  assert.notEqual(back.found, zero.found);
});

test('a real 0 baseline lets a later increase be detected (the #1930 signal)', () => {
  // At the healthy transition the pane may show 0 auth-error lines. A live loop
  // then starts producing new ones: 0 -> 2 must read as an increase.
  assert.equal(activity.record('reauth', 'auth-error', 0).ok, true);
  const base = activity.read('reauth', 'auth-error');
  assert.equal(base.count, 0);
  // sub-case-2: a new loop under a stale-healthy probe pushes the count up.
  assert.equal(activity.record('reauth', 'auth-error', 2, new Date().toISOString()).ok, true);
  const now = activity.read('reauth', 'auth-error');
  assert.ok(now.count > base.count, 'a growing count is the positive evidence the guard fires on');
});

test('WEAKEST PREMISE (Pete): a flat count at the capture cap misses a steady loop, and that is safe', () => {
  // The #1930 signal is `currentCount > baseline.count`. It catches a live 401
  // loop only while new error lines OUTPACE the pane-capture window. A
  // steady-state loop at the capture cap -- old 401s scrolling off the top as
  // fast as new ones append -- holds the count FLAT, so the caller computes
  // newErrorsSinceHealthy:false and MISSES the loop.
  //
  // This is acceptable BY DESIGN and this test pins WHY: a miss fails toward the
  // existing HEALTHY-suppression (the accepted #1930-first-half residual), NEVER
  // toward a NEW false-calm. So the tier stays "strictly reduces false-calm,
  // never increases it." If it proves too lossy in practice the escape hatch is
  // to track the NEWEST auth-error line's identity, not just the count -- a new
  // distinct newest line since baseline is a scroll-robust signal. Count first.
  assert.equal(activity.record('steady', 'auth-error', 20).ok, true); // baseline at the cap
  const base = activity.read('steady', 'auth-error');
  assert.equal(activity.record('steady', 'auth-error', 20).ok, true); // loop still running, count pinned at cap
  const later = activity.read('steady', 'auth-error');
  // A caller doing `later.count > base.count` gets false -> does NOT un-suppress
  // -> the base HEALTHY-suppression stands. A miss, in the safe direction.
  assert.equal(later.count > base.count, false);
});

test('record refuses a non-finite or negative count (never a phantom sample)', () => {
  assert.equal(activity.record('alpha', 'auth-error', -1).ok, false);
  assert.equal(activity.record('alpha', 'auth-error', NaN).ok, false);
  assert.equal(activity.record('alpha', 'auth-error', 'lots').ok, false);
  // and none of those left a file behind that read() could pick up as a sample
  // (the prior good record for alpha still stands; a refusal does not overwrite).
  assert.equal(activity.read('alpha', 'auth-error').count, 3);
});

test('record refuses an unreadable time rather than storing a bad record', () => {
  assert.equal(activity.record('alpha', 'auth-error', 5, 'not-a-time').ok, false);
});

test('patterns are isolated per agent: two patternKeys do not collide', () => {
  activity.record('gamma', 'auth-error', 4);
  activity.record('gamma', 'rate-limit', 9);
  assert.equal(activity.read('gamma', 'auth-error').count, 4);
  assert.equal(activity.read('gamma', 'rate-limit').count, 9);
});

test('agents are isolated: same pattern, two agents do not collide', () => {
  activity.record('one', 'auth-error', 1);
  activity.record('two', 'auth-error', 7);
  assert.equal(activity.read('one', 'auth-error').count, 1);
  assert.equal(activity.read('two', 'auth-error').count, 7);
});

test('clear drops the sample; a cleared pattern reads found:false again', () => {
  activity.record('delta', 'auth-error', 6);
  assert.equal(activity.read('delta', 'auth-error').found, true);
  assert.equal(activity.clear('delta', 'auth-error').ok, true);
  const back = activity.read('delta', 'auth-error');
  assert.equal(back.found, false);
  // clear on a name that was never recorded is a no-op success, never a throw.
  assert.equal(activity.clear('delta', 'auth-error').ok, true);
});

test('an unusable agent or pattern name refuses, never throws', () => {
  // store.safeKey strips to nothing -> record/read/clear return refusals.
  assert.equal(activity.record('***', 'auth-error', 1).ok, false);
  assert.equal(activity.read('***', 'auth-error').found, false);
  assert.equal(activity.clear('***', 'auth-error').ok, false);
  assert.equal(activity.record('alpha', '***', 1).ok, false);
});
