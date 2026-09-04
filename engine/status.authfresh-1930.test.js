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
const { reconcileReport, STATE, CONFIDENCE } = require('./status');
const HEALTHY = require('./authprobe').HEALTHY;

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
