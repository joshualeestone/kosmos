'use strict';
/* #4588: an Antigravity agent paused on its Google account's shared quota reads as Paused (rate_limited) until the
   reset its bridge reported, and as its ordinary report once the reset has passed. */
const test = require('node:test');
const assert = require('node:assert');
const status = require('./status');

const NOW = Date.parse('2026-09-28T21:50:00Z');
const RESET = '2026-09-28T22:11:54.000Z';
const UNKNOWN = { state: status.STATE.UNKNOWN, confidence: status.CONFIDENCE.NONE, because: 'cannot read agy' };
const quota = (over) => ({ found: true, state: 'idle', by: 'auto', until: RESET, because: "Paused: this Google account's shared Antigravity quota ran out.", ...over });

test('#4588: quotaPauseUntil is the reset while it is ahead, and null for everything else', () => {
  assert.equal(status.quotaPauseUntil(quota(), NOW), Date.parse(RESET));
  // CONTROLS, each one field away from a pause:
  assert.equal(status.quotaPauseUntil(quota(), Date.parse(RESET) + 1), null, 'the reset has passed');
  assert.equal(status.quotaPauseUntil(quota({ by: 'agent' }), NOW), null, "an agent's own idle --until is not a pause");
  assert.equal(status.quotaPauseUntil(quota({ state: 'blocked' }), NOW), null, 'only an idle');
  assert.equal(status.quotaPauseUntil(quota({ until: 'Friday' }), NOW), null, 'not a time');
  assert.equal(status.quotaPauseUntil(quota({ until: null }), NOW), null, 'no until');
  assert.equal(status.quotaPauseUntil({ found: false }, NOW), null, 'never reported');
  // Review 3: only the BRIDGE's report is a pause. Any hook can pass an until through, and Date.parse reads "5" as May 2001.
  assert.equal(status.quotaPauseUntil(quota({ because: 'finished responding' }), NOW), null, "another agent's automatic idle with a time is not a quota pause");
  assert.equal(status.quotaPauseUntil(quota({ until: '5' }), Date.parse('1990-01-01T00:00:00Z')), null, 'a loose date is not the reset');
  assert.equal(status.quotaPauseUntil(quota({ until: 'Mon Sep 28 2026 22:11:54 GMT-0500' }), NOW), null, 'only the strict ISO form the bridge writes');
});

test('#4588: while paused the card reads rate_limited (Paused) with the reset in its reason', () => {
  const r = status.reconcileReport(quota(), UNKNOWN, NOW);
  assert.equal(r.state, status.STATE.RATE_LIMITED);
  assert.equal(r.quotaUntil, RESET);
  assert.match(r.because, /shared Antigravity quota ran out; it resets at /);
  assert.doesNotMatch(r.because, /RESOURCE_EXHAUSTED|Resets in|Google said/, "Kosmos's own sentence, never the raw report text (#215)");
  assert.equal(r.reported, true);
});

test('#4588: a question, work or a lost connection read off a screen outranks the quota report', () => {
  for (const state of [status.STATE.NEEDS_YOU, status.STATE.WORKING, status.STATE.CONNECTION_LOST]) {
    const scraped = { state, confidence: status.CONFIDENCE.SCRAPED, because: 'on screen', evidence: 'x' };
    assert.notEqual(status.reconcileReport(quota(), scraped, NOW).state, status.STATE.RATE_LIMITED, state);
  }
  // CONTROL: over a screen that says nothing (agy's, always) it is the pause.
  assert.equal(status.reconcileReport(quota(), UNKNOWN, NOW).state, status.STATE.RATE_LIMITED);
});

test('#4588: past the reset it says so for six hours, then plainly at rest, never Paused or the raw text', () => {
  const later = status.reconcileReport(quota(), UNKNOWN, Date.parse(RESET) + 7 * 3600e3);
  assert.equal(later.state, status.STATE.IDLE);
  assert.equal(later.because, 'it is at rest and nothing is needed');
});

test('#4588: after the reset the same report reads as the ordinary idle again (CONTROL)', () => {
  const r = status.reconcileReport(quota({ because: status.QUOTA_REPORT_PREFIX + ' Google said: API error: RESOURCE_EXHAUSTED ... Resets in 24m54s.' }), UNKNOWN, Date.parse(RESET) + 60 * 1000);
  assert.equal(r.state, status.STATE.IDLE);
  assert.equal(r.quotaUntil, undefined);
  assert.match(r.because, /quota reset at /, 'after the reset it says so, not "Paused"');
  assert.doesNotMatch(r.because, /Paused|RESOURCE_EXHAUSTED/);
});
