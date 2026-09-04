'use strict';
// kosmos#1930 -- the ONE-DIRECTIONAL freshness guard on the HEALTHY-suppression of a
// scraped Claude auth_failed, at the reconcile seam.
//
// The haunt (#1930): a FIXED agent keeps showing its stale 401 forever. The base fix
// (already shipped) suppresses a scraped auth_failed whenever the account probe reads
// live-HEALTHY -- the rejection is stale scrollback. But that suppression is itself a
// new false-calm risk: a LIVE 401 loop under a probe that cached HEALTHY a moment ago
// (sub-case-2) would be suppressed too. The guard un-suppresses ONLY that case, on
// POSITIVE evidence the auth-error region is still producing NEW lines.
//
// THE LOAD-BEARING ARMS ARE THE TWO-WAY DANGEROUS-ANSWER CONTROL:
//   (a) HEALTHY + new-errors-INCREASING  -> red SHOWN   (guard fires)
//   (b) HEALTHY + no-new-errors / no-sample -> SUPPRESSED (base stands)
// If (b) ever flips to shown, that IS the re-haunt regression -- (b) is the failing
// control. The guard STRICTLY REDUCES false-calm: it never adds suppression, and
// unknown/no-sample never un-suppresses.
//
//   node --test engine/status.authfresh-1930.test.js

const { test } = require('node:test');
const assert = require('node:assert');
// Sandbox the store BEFORE requiring status: the baseline-clear integration test
// below drives snapshot() and reads the real activity store. The reconcile-only
// tests do not touch it, so this is harmless to them.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-authfresh-1930-'));
const status = require('./status');
const { reconcileReport, STATE, CONFIDENCE, authErrorLineCount } = status;
const HEALTHY = require('./authprobe').HEALTHY;

// ---- authErrorLineCount: the actual #1930 signal generator -----------------
// (All the reconcile tests below inject a {newErrorsSinceHealthy} verdict; these
// pin the counting/stripping logic that PRODUCES that verdict.)

const REAL_401 = '401 {"type":"error","error":{"type":"authentication_error","message":"OAuth access token is invalid."}}';

test('authErrorLineCount: counts a real 401 line (marker AND envelope on one row)', () => {
  assert.equal(authErrorLineCount(REAL_401), 1);
  assert.equal(authErrorLineCount(REAL_401 + '\n' + REAL_401), 2, 'two real 401 lines count as two');
});

test('authErrorLineCount: a growing count is detectable (the increase the guard fires on)', () => {
  const before = authErrorLineCount('some prose\n' + REAL_401);
  const after = authErrorLineCount('some prose\n' + REAL_401 + '\n' + REAL_401);
  assert.ok(after > before, 'a new 401 line increases the count');
});

test('authErrorLineCount: PROSE mentioning a marker is NOT counted (#1233 -- no full envelope on the row)', () => {
  assert.equal(authErrorLineCount('The marker is "type":"authentication_error" and nothing else on this line'), 0, 'a marker without the "type":"error" envelope on the same row is prose, not a 401');
  assert.equal(authErrorLineCount('I saw OAuth access token is invalid in the log yesterday'), 0);
});

test('authErrorLineCount: the FRIENDLY non-JSON auth line is NOT counted (#1884 -- no envelope)', () => {
  assert.equal(authErrorLineCount('● Please run /login · API Error: 401 OAuth access token has expired.'), 0, 'the friendly form has no JSON envelope; it is a static prompt, not a loop line');
});

test('authErrorLineCount: leading tree glyphs / indentation are stripped before matching', () => {
  assert.equal(authErrorLineCount('│  ' + REAL_401), 1, 'a real 401 behind tree drawing still counts');
  assert.equal(authErrorLineCount('   > ' + REAL_401), 1);
});

test('authErrorLineCount: empty / null input is 0, never a throw', () => {
  assert.equal(authErrorLineCount(''), 0);
  assert.equal(authErrorLineCount(null), 0);
  assert.equal(authErrorLineCount(undefined), 0);
});

const NO_REPORT = { found: false };
const now = 1_000_000;
const authFailedScrape = {
  state: STATE.AUTH_FAILED,
  confidence: CONFIDENCE.SCRAPED,
  because: 'its Claude sign-in is not working',
  evidence: '401 {"type":"error","error":{"type":"authentication_error"}}',
};

// --- (a) the guard FIRES on positive new-error evidence ---------------------

test('(a) HEALTHY + newErrorsSinceHealthy:true -> auth_failed SHOWN (a live loop, not stale)', () => {
  const r = reconcileReport(NO_REPORT, authFailedScrape, now, HEALTHY, null, undefined, { newErrorsSinceHealthy: true });
  assert.equal(r.state, STATE.AUTH_FAILED, 'positive new-error evidence keeps the red -- the rejection is live, not stale');
  assert.ok(r.evidence && /authentication_error/.test(r.evidence), 'the 401 line rides along as evidence');
  assert.ok(r.conflict && /live rejection loop/.test(r.conflict), 'the conflict names the probe-vs-screen split honestly');
});

// --- (b) the DANGEROUS-ANSWER CONTROL: no evidence -> SUPPRESSED -------------
// Every one of these must NOT show auth_failed. A flip here is the re-haunt.

test('(b) HEALTHY + newErrorsSinceHealthy:false -> SUPPRESSED (base stands; THE failing control)', () => {
  const r = reconcileReport(NO_REPORT, authFailedScrape, now, HEALTHY, null, undefined, { newErrorsSinceHealthy: false });
  assert.notEqual(r.state, STATE.AUTH_FAILED, 'RE-HAUNT REGRESSION if this ever shows auth_failed');
  assert.equal(r.state, STATE.UNKNOWN, 'the stale rejection is suppressed; the underlying state stands');
  assert.ok(r.conflict && /stale/.test(r.conflict), 'and it is surfaced as a stale rejection, not hidden');
});

test('(b) HEALTHY + activity undefined (no sample yet) -> SUPPRESSED (no regression on first tick)', () => {
  const r = reconcileReport(NO_REPORT, authFailedScrape, now, HEALTHY, null, undefined, undefined);
  assert.notEqual(r.state, STATE.AUTH_FAILED);
  assert.equal(r.state, STATE.UNKNOWN);
});

test('(b) HEALTHY + activity null -> SUPPRESSED (null is not-a-sample, never un-suppresses)', () => {
  const r = reconcileReport(NO_REPORT, authFailedScrape, now, HEALTHY, null, undefined, null);
  assert.notEqual(r.state, STATE.AUTH_FAILED);
});

test('(b) HEALTHY + a malformed activity object (no field) -> SUPPRESSED (only a literal true fires)', () => {
  const r = reconcileReport(NO_REPORT, authFailedScrape, now, HEALTHY, null, undefined, { somethingElse: 1 });
  assert.notEqual(r.state, STATE.AUTH_FAILED);
});

// --- (c) activity is INERT unless the probe is HEALTHY -----------------------
// A not-healthy probe means rule 3b: the scraped 401 stands over everything,
// and the freshness verdict must not change that in EITHER direction.

test('(c) NOT-healthy probe -> auth_failed stands REGARDLESS of activity (rule 3b owns this)', () => {
  const shown = reconcileReport(NO_REPORT, authFailedScrape, now, undefined, null, undefined, { newErrorsSinceHealthy: false });
  assert.equal(shown.state, STATE.AUTH_FAILED, 'no healthy probe -> a scraped dead-token stands; activity is inert');
  const shown2 = reconcileReport(NO_REPORT, authFailedScrape, now, undefined, null, undefined, { newErrorsSinceHealthy: true });
  assert.equal(shown2.state, STATE.AUTH_FAILED, 'and a "fresh" verdict does not suppress a real red either');
});

test('a report under a suppressed stale rejection is still reconciled (suppression re-enters the rules)', () => {
  // A fresh needs_you report under a stale-suppressed 401 should surface the needs_you,
  // not be swallowed -- the suppression re-enters reconcile with the auth signal removed.
  const reported = { found: true, state: 'needs_you', because: 'May I merge?', at: new Date(now).toISOString() };
  const r = reconcileReport(reported, authFailedScrape, now, HEALTHY, null, undefined, { newErrorsSinceHealthy: false });
  assert.notEqual(r.state, STATE.AUTH_FAILED, 'the stale 401 is gone');
});

// ---- BASELINE CLEAR-ON-RECOVERY (the re-haunt WARNING) ---------------------
// The baseline must mean "auth-error count since THIS episode's healthy
// transition". If it persisted across a recovery, a LATER stale 401 under a
// still-cached-HEALTHY probe would compare against a PRIOR episode's baseline and
// could compute a false increase -> un-suppress a stale rejection (a re-haunt).
// snapshot() clears the baseline on any owned pane whose scrape is NOT auth_failed.

test('the #1930 baseline is CLEARED once the 401 leaves the screen (no cross-episode re-haunt)', () => {
  const fleet = require('../test-support/fleet');
  const activity = require('./activity');
  // Seed a baseline as if a prior auth_failed-under-healthy episode had recorded one.
  activity.record('recovered', 'auth-error', 5);
  assert.equal(activity.read('recovered', 'auth-error').found, true, 'baseline seeded');
  // The agent recovers: its pane no longer shows a 401 (any non-auth_failed state).
  fleet.install([fleet.agent('recovered', { state: 'idle' })]);
  status.snapshot();
  assert.equal(activity.read('recovered', 'auth-error').found, false, 'the episode is over -> the baseline is cleared so the next 401 re-baselines');
});
