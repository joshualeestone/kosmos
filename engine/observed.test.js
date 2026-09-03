'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const observed = require('./observed');

const { OK, REJECTED } = observed.OUTCOME;

test.beforeEach(() => observed._clearForTest());

test('saw records ok and 401, keyed by agent, with the timestamp given', () => {
  observed.saw('aria', OK, 1000);
  observed.saw('boss', REJECTED, 2000);
  assert.deepEqual(observed.read('aria'), { outcome: OK, at: 1000 });
  assert.deepEqual(observed.read('boss'), { outcome: REJECTED, at: 2000 });
  // all() surfaces every agent's last observation.
  const all = observed.all().sort((a, b) => a.agent.localeCompare(b.agent));
  assert.deepEqual(all, [
    { agent: 'aria', outcome: OK, at: 1000 },
    { agent: 'boss', outcome: REJECTED, at: 2000 },
  ]);
});

test('a later qualifying observation overwrites the earlier one', () => {
  observed.saw('aria', OK, 1000);
  observed.saw('aria', REJECTED, 3000);
  assert.deepEqual(observed.read('aria'), { outcome: REJECTED, at: 3000 });
});

test('a non-outcome state does NOT clobber a prior real observation', () => {
  // status.js passes null for idle / needs-you / unknown; saw must ignore it so a
  // prior real observation survives an idle tick (else we manufacture a false green
  // or wipe a real 401).
  observed.saw('aria', OK, 1000);
  observed.saw('aria', null, 2000);
  observed.saw('aria', 'idle', 2500);        // not one of our OUTCOME values
  observed.saw('aria', undefined, 2600);
  assert.deepEqual(observed.read('aria'), { outcome: OK, at: 1000 }, 'prior ok must survive non-observations');
});

test('saw ignores a missing or empty agent name', () => {
  observed.saw('', OK, 1000);
  observed.saw(null, OK, 1000);
  assert.equal(observed.all().length, 0);
});

test('read returns null for an unseen agent (never a fabricated shape)', () => {
  assert.equal(observed.read('nobody'), null);
});

// --- verdict: the whole truth table -------------------------------------------

const FRESH = 60 * 1000;
const NOW = 1_000_000;

test('verdict: a fresh observed 401 shows rejected, EVEN when checkLive says connected (the Ben case)', () => {
  const v = observed.verdict({ checkLiveState: 'connected', observedOutcome: REJECTED, observedAt: NOW - 5000, now: NOW, freshMs: FRESH });
  assert.equal(v.badge, 'rejected');
  assert.equal(v.ageMs, 5000);
});

test('verdict: a fresh observed ok shows working (green)', () => {
  const v = observed.verdict({ checkLiveState: 'connected', observedOutcome: OK, observedAt: NOW - 3000, now: NOW, freshMs: FRESH });
  assert.equal(v.badge, 'working');
  assert.equal(v.ageMs, 3000);
});

test('verdict: a fresh observed ok RESCUES a crashed probe (observed beats predicted)', () => {
  const v = observed.verdict({ checkLiveState: 'unknown', observedOutcome: OK, observedAt: NOW - 3000, now: NOW, freshMs: FRESH });
  assert.equal(v.badge, 'working');
});

test('verdict: a STALE 401 does NOT keep asserting not-connected; it falls back to checkLive', () => {
  // The person may have re-signed-in since. A stale/blind signal must never become
  // a confident negative (server.js:3378). checkLive connected -> signed_in_unverified.
  const v = observed.verdict({ checkLiveState: 'connected', observedOutcome: REJECTED, observedAt: NOW - (FRESH + 1), now: NOW, freshMs: FRESH });
  assert.equal(v.badge, 'signed_in_unverified');
  assert.equal(v.observedAt, null);
  assert.equal(v.ageMs, null);
});

test('verdict: a STALE ok is not green; checkLive connected -> signed_in_unverified (not a false green)', () => {
  const v = observed.verdict({ checkLiveState: 'connected', observedOutcome: OK, observedAt: NOW - (FRESH + 1), now: NOW, freshMs: FRESH });
  assert.equal(v.badge, 'signed_in_unverified');
});

test('verdict: no observation + checkLive connected -> signed_in_unverified (credential exists, not verified)', () => {
  const v = observed.verdict({ checkLiveState: 'connected', observedOutcome: null, observedAt: null, now: NOW, freshMs: FRESH });
  assert.equal(v.badge, 'signed_in_unverified');
});

test('verdict: checkLive none -> signed_out', () => {
  const v = observed.verdict({ checkLiveState: 'none', observedOutcome: null, observedAt: null, now: NOW, freshMs: FRESH });
  assert.equal(v.badge, 'signed_out');
});

test('verdict: checkLive unknown + nothing observed -> unchecked (could not check)', () => {
  const v = observed.verdict({ checkLiveState: 'unknown', observedOutcome: null, observedAt: null, now: NOW, freshMs: FRESH });
  assert.equal(v.badge, 'unchecked');
});

test('verdict: a future observedAt (clock skew) is not treated as fresh', () => {
  const v = observed.verdict({ checkLiveState: 'connected', observedOutcome: OK, observedAt: NOW + 5000, now: NOW, freshMs: FRESH });
  assert.equal(v.badge, 'signed_in_unverified', 'a negative age must not read as a fresh success');
});

test('freshMs default is 5 minutes and honours the env seam', () => {
  const prev = process.env.AGENT_WORKFORCE_OBSERVED_FRESH_MS;
  delete process.env.AGENT_WORKFORCE_OBSERVED_FRESH_MS;
  assert.equal(observed.freshMs(), 5 * 60 * 1000);
  process.env.AGENT_WORKFORCE_OBSERVED_FRESH_MS = '1000';
  assert.equal(observed.freshMs(), 1000);
  if (prev === undefined) delete process.env.AGENT_WORKFORCE_OBSERVED_FRESH_MS;
  else process.env.AGENT_WORKFORCE_OBSERVED_FRESH_MS = prev;
});
