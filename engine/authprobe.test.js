'use strict';
// kosmos#1930 -- tests for the per-account live-auth cache (engine/authprobe.js).
//
// The load-bearing arm is the SAFETY one: verdict() returns HEALTHY only on positive live
// evidence. An expired account, an unreachable check, a thrown checker, a not-yet-checked
// account, and a stale-but-formerly-healthy entry ALL return non-HEALTHY, so the caller
// leaves auth_failed standing. A verifier that says "fine" when it could not look is the
// exact defect this card is about, one layer up.

const { test } = require('node:test');
const assert = require('node:assert');
const subscription = require('./subscription');
const ap = require('./authprobe');

const CONNECTED = { state: subscription.STATE.CONNECTED };
const NONE = { state: subscription.STATE.NONE };
const UNKNOWNLIVE = { state: subscription.STATE.UNKNOWN };
const settle = () => new Promise((r) => setTimeout(r, 15));

test('first look is UNCHECKED and kicks a check; after it settles CONNECTED reads HEALTHY', async () => {
  ap.resetForTest();
  ap.setChecker(async () => CONNECTED);
  assert.equal(ap.verdict('/acct/a'), ap.UNCHECKED, 'before any evidence, not HEALTHY');
  await settle();
  assert.equal(ap.verdict('/acct/a'), ap.HEALTHY, 'a fresh CONNECTED check reads HEALTHY');
});

test('SAFETY: an EXPIRED (not-connected) account never reads HEALTHY', async () => {
  ap.resetForTest();
  ap.setChecker(async () => NONE);
  ap.verdict('/acct/b'); await settle();
  assert.equal(ap.verdict('/acct/b'), ap.EXPIRED);
});

test('SAFETY: an unreachable check reads UNKNOWN, not HEALTHY', async () => {
  ap.resetForTest();
  ap.setChecker(async () => UNKNOWNLIVE);
  ap.verdict('/acct/c'); await settle();
  assert.equal(ap.verdict('/acct/c'), ap.UNKNOWN);
});

test('SAFETY: a checker that THROWS reads UNKNOWN, never HEALTHY (no false calm on error)', async () => {
  ap.resetForTest();
  ap.setChecker(async () => { throw new Error('claude not found'); });
  ap.verdict('/acct/d'); await settle();
  assert.equal(ap.verdict('/acct/d'), ap.UNKNOWN);
});

test('SAFETY: a STALE formerly-HEALTHY entry does not keep suppressing past the TTL', async () => {
  ap.resetForTest();
  ap.setChecker(async () => CONNECTED);
  ap.verdict('/acct/e'); await settle();
  assert.equal(ap.verdict('/acct/e'), ap.HEALTHY, 'fresh -> HEALTHY');
  // Look again far past the TTL: the stale HEALTHY must NOT be returned as HEALTHY.
  const later = Date.now() + ap.TTL_MS + 60_000;
  assert.notEqual(ap.verdict('/acct/e', later), ap.HEALTHY, 'a stale HEALTHY is downgraded, not trusted');
});

test('the check is debounced: rapid looks do not launch a second in-flight check', async () => {
  ap.resetForTest();
  let calls = 0;
  ap.setChecker(async () => { calls += 1; return CONNECTED; });
  ap.verdict('/acct/f'); ap.verdict('/acct/f'); ap.verdict('/acct/f');
  await settle();
  assert.equal(calls, 1, 'only one check in flight per account');
});

test('the default account (no configDir) has a stable key distinct from named ones', async () => {
  ap.resetForTest();
  const seen = [];
  ap.setChecker(async (dir) => { seen.push(dir); return CONNECTED; });
  ap.verdict(null); ap.verdict('/acct/g');
  await settle();
  assert.equal(ap.dirKey(null), ap.dirKey(undefined), 'default key is stable');
  assert.notEqual(ap.dirKey(null), ap.dirKey('/acct/g'), 'default and named keys differ');
  assert.equal(seen.filter((d) => !d).length, 1, 'the default account is checked with a falsy (omitted) configDir');
  assert.ok(seen.includes('/acct/g'), 'the named account is checked with its dir');
});
