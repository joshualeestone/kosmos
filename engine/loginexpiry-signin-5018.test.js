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
