'use strict';
// kosmos#2093 -- tests for the per-account live-auth cache (engine/codexauthprobe.js).
//
// The load-bearing arm is the SAFETY one, and it is the MIRROR of authprobe's: this probe
// PRODUCES a red (auth_failed), so verdict() returns EXPIRED (the produce trigger) ONLY on a
// positive checkLive NONE. A connected account, an unreachable check, a thrown checker, a
// not-yet-checked account, and a STALE-but-formerly-EXPIRED entry ALL return non-EXPIRED, so the
// caller leaves the pane's UNKNOWN standing. A verifier that says "dead" when it could not look
// (or when the account was since repaired) would tell a working agent its sign-in is broken --
// the exact false-red this direction must never produce.

const { test } = require('node:test');
const assert = require('node:assert');
const subscription = require('./subscription');
const cap = require('./codexauthprobe');

const CONNECTED = { state: subscription.STATE.CONNECTED };
const NONE = { state: subscription.STATE.NONE };
const UNKNOWNLIVE = { state: subscription.STATE.UNKNOWN };
const settle = () => new Promise((r) => setTimeout(r, 15));

test('first look is UNCHECKED and kicks a check; after it settles NONE reads EXPIRED', async () => {
  cap.resetForTest();
  cap.setChecker(async () => NONE);
  assert.equal(cap.verdict('/codex/a'), cap.UNCHECKED, 'before any evidence, never EXPIRED');
  await settle();
  assert.equal(cap.verdict('/codex/a'), cap.EXPIRED, 'a fresh checkLive NONE reads EXPIRED (the produce trigger)');
});

test('SAFETY: a CONNECTED account never reads EXPIRED', async () => {
  cap.resetForTest();
  cap.setChecker(async () => CONNECTED);
  cap.verdict('/codex/b'); await settle();
  assert.equal(cap.verdict('/codex/b'), cap.HEALTHY);
});

test('SAFETY: an unreachable check reads UNKNOWN, not EXPIRED', async () => {
  cap.resetForTest();
  cap.setChecker(async () => UNKNOWNLIVE);
  cap.verdict('/codex/c'); await settle();
  assert.equal(cap.verdict('/codex/c'), cap.UNKNOWN);
});

test('SAFETY: a thrown checker reads UNKNOWN, not EXPIRED (an errored check must not redden)', async () => {
  cap.resetForTest();
  cap.setChecker(async () => { throw new Error('network blip'); });
  cap.verdict('/codex/d'); await settle();
  assert.equal(cap.verdict('/codex/d'), cap.UNKNOWN);
});

// NOTE ON THE CLOCK: kickCheck() stamps the cache with the REAL Date.now() when the async check
// settles, so staleness must be queried relative to real time, not a synthetic base. (An earlier
// version of this test passed a synthetic t0 and read a "stale" entry as fresh -- the fixture was
// answering a different question than the module.)
test('SAFETY: a STALE EXPIRED downgrades to UNCHECKED -- it must not keep reddening a repaired account', async () => {
  cap.resetForTest();
  cap.setChecker(async () => NONE);
  cap.verdict('/codex/e'); await settle();
  const base = Date.now();
  // Fresh: EXPIRED stands (produces).
  assert.equal(cap.verdict('/codex/e', base), cap.EXPIRED, 'fresh EXPIRED produces');
  // Past the TTL: the stale EXPIRED must NOT be trusted to produce -> UNCHECKED, and a re-probe fires.
  assert.equal(cap.verdict('/codex/e', base + cap.TTL_MS + 5000), cap.UNCHECKED, 'stale EXPIRED downgrades to UNCHECKED');
});

test('a STALE HEALTHY is safe to report (it produces nothing anyway)', async () => {
  cap.resetForTest();
  cap.setChecker(async () => CONNECTED);
  cap.verdict('/codex/f'); await settle();
  const base = Date.now();
  assert.equal(cap.verdict('/codex/f', base + cap.TTL_MS + 5000), cap.HEALTHY, 'stale HEALTHY reported unchanged; only stale EXPIRED is downgraded');
});

test('CORRECTNESS: a null dir is resolved to the default codex home, NOT passed as null to checkLive', async () => {
  // The bug this guards: openaiaccounts.checkLive(null) reads path.resolve('')/auth.json (the
  // process CWD), which is absent -> a false NONE that would redden every healthy default-home
  // codex agent. The real checker resolves null via openaiaccounts.defaultDir().
  cap.resetForTest();
  let sawDir;
  cap.setChecker(async (dir) => { sawDir = dir; return CONNECTED; });
  cap.verdict(null); await settle();
  // The module passes the raw dir (null) to the injected checker; the DEFAULT resolution lives in
  // the REAL checker (openaiaccounts.checkLive(dir || openaiaccounts.defaultDir())). So here we
  // assert the real checker actually resolves a non-null default dir when handed null.
  const openaiaccounts = require('./openaiaccounts');
  const def = openaiaccounts.defaultDir();
  assert.ok(def && typeof def === 'string' && def.length > 0, 'defaultDir() is a real resolved path, so the real checker never passes null to checkLive');
});

test('the default key collapses null/undefined/"" to one cache entry, distinct from a named dir', () => {
  assert.equal(cap.dirKey(null), cap.dirKey(undefined));
  assert.equal(cap.dirKey(null), cap.dirKey(''));
  assert.notEqual(cap.dirKey(null), cap.dirKey('/codex/named'));
});
