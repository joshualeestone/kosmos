'use strict';
/* #5018 (Josh, 2026-10-02): after "Sign in again" the login-expiry notice stayed until he closed and reopened
 * the app. The notice (status.js, through loginexpiry.cachedAdvisories) and the Settings date (claudeloginlive)
 * both cache the login's date; a completed sign-in must make both read it again on the next ask, not after
 * their TTL. connect.test.js asserts that a completed sign-in calls loginChanged().
 *   node --test engine/loginexpiry-signin-5018.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const le = require('./loginexpiry');
const cl = require('./claudeloginlive');

test('the notice cache is read again after a sign-in, inside its TTL', () => {
  const cache = { at: 0, value: [] };
  let calls = 0;
  let expiring = true;
  const compute = () => { calls += 1; return expiring ? [{ agents: ['a'], daysLeft: 5 }] : []; };
  const t0 = 1_000_000;
  assert.equal(le.cachedAdvisories({ cache, now: t0, ttlMs: 300_000, compute }).length, 1);
  expiring = false;   // the person signs in again: the credential's date moves out
  // Control: without a sign-in signal the cache still answers the old notice inside the TTL (the bug Josh saw).
  assert.equal(le.cachedAdvisories({ cache, now: t0 + 60_000, ttlMs: 300_000, compute }).length, 1);
  assert.equal(calls, 1);
  le.loginChanged();
  assert.equal(le.cachedAdvisories({ cache, now: t0 + 61_000, ttlMs: 300_000, compute }).length, 0,
    'the notice stayed after a completed sign-in');
  assert.equal(calls, 2);
  // And it caches again afterwards (the signal is not a permanent bypass).
  le.cachedAdvisories({ cache, now: t0 + 62_000, ttlMs: 300_000, compute });
  assert.equal(calls, 2);
});

test('the Settings date is read again after a sign-in, inside its cache window', async () => {
  cl._clearForTest();
  let until = Date.UTC(2026, 9, 8);
  let reads = 0;
  cl.setReaderForTests(() => { reads += 1; return until; });
  const row = { isDefault: false, dir: '/tmp/kosmos-5018-acct' };
  const t0 = Date.now();
  assert.equal(await cl.validUntil(row, t0), Date.UTC(2026, 9, 8));
  until = Date.UTC(2026, 9, 31);
  assert.equal(await cl.validUntil(row, t0 + 1000), Date.UTC(2026, 9, 8), 'control: cached inside the window');
  le.loginChanged();
  assert.equal(await cl.validUntil(row, t0 + 2000), Date.UTC(2026, 9, 31), 'the date did not move after a sign-in');
  assert.equal(reads, 2);
  cl.setReaderForTests(null);
  cl._clearForTest();
});

test('a read with no await (no keychain on this platform) still answers after a sign-in, never rejects', async () => {
  cl._clearForTest();
  // No reader under node --test (NODE_TEST_CONTEXT is set): the read takes the branch with no await at all, so it
  // finishes before validUntil returns, the case that once threw on its own cleanup.
  assert.ok(process.env.NODE_TEST_CONTEXT, 'run under node --test, or this does not reach the no-await branch');
  cl.setReaderForTests(null);
  const row = { isDefault: false, dir: '/tmp/kosmos-5018-sync' };
  const t0 = Date.now();
  assert.equal(await cl.validUntil(row, t0), null);
  le.loginChanged();
  assert.equal(await cl.validUntil(row, t0 + 1000), null, 'rejected after a sign-in');
  le.loginChanged();
  assert.equal(await cl.validUntil(row, t0 + 2000), null);
  cl.setReaderForTests(null);
  cl._clearForTest();
});

test('an older read still in flight across a sign-in is not reused, and does not overwrite the newer answer', async () => {
  cl._clearForTest();
  let release;
  const slow = new Promise((ok) => { release = ok; });
  let calls = 0;
  cl.setReaderForTests(() => { calls += 1; return calls === 1 ? slow : Date.UTC(2026, 9, 31); });
  const row = { isDefault: false, dir: '/tmp/kosmos-5018-race' };
  const t0 = Date.now();
  const old = cl.validUntil(row, t0);               // in flight, old generation
  le.loginChanged();
  assert.equal(await cl.validUntil(row, t0 + 10), Date.UTC(2026, 9, 31), 'reused the pre-sign-in read');
  release(Date.UTC(2026, 9, 8));
  assert.equal(await old, Date.UTC(2026, 9, 8));
  assert.equal(await cl.validUntil(row, t0 + 20), Date.UTC(2026, 9, 31), 'the older read overwrote the newer date');
  assert.equal(calls, 2);
  cl.setReaderForTests(null);
  cl._clearForTest();
});
