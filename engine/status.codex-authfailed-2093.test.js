'use strict';
// kosmos#2093 -- the codex dead-credential PRODUCE path, at the reconcile + resolution seams.
//
// The gap: status.js classify() reads auth_failed off a CLAUDE pane but has no equivalent on the
// codex branch, so a running codex agent whose credential died on turn 1 (the #1906 fail-open
// residual) reads UNKNOWN forever. The fix surfaces auth_failed from the LIVE auth condition
// (codexauthprobe verdict EXPIRED), NOT from a screen marker -- a scraper cannot separate a dead
// credential from codex's transient reconnect 401.
//
// The load-bearing arms are the SAFETY ones: the produce fires ONLY on a positive EXPIRED and
// ONLY over an UNKNOWN scrape. A healthy/unreachable/absent verdict, and any scrape that DID say
// something, must never redden.

const { test } = require('node:test');
const assert = require('node:assert');
const { reconcileReport, codexLiveAuthFor, STATE, CONFIDENCE } = require('./status');
const cap = require('./codexauthprobe');

const NO_REPORT = { found: false };
const now = 1_000_000;
const unknownScrape = { state: STATE.UNKNOWN, confidence: CONFIDENCE.NONE, because: 'nothing on its screen says what it is doing' };

// --- the produce, and its control ------------------------------------------

test('PRODUCE: an UNKNOWN codex scrape + a positive dead verdict (EXPIRED) reads auth_failed', () => {
  const r = reconcileReport(NO_REPORT, unknownScrape, now, undefined, null, cap.EXPIRED);
  assert.equal(r.state, STATE.AUTH_FAILED, 'a dead codex credential surfaces auth_failed, not the raw UNKNOWN');
  assert.match(r.because, /OpenAI sign-in is not working/);
  assert.ok(r.evidence && /[Rr]econnect/.test(r.evidence), 'carries a re-auth remedy the person can act on');
  assert.equal(r.conflict, null, 'no report -> no conflict');
});

test('CONTROL: the SAME UNKNOWN scrape WITHOUT the dead verdict stays UNKNOWN (proves the branch is what produces)', () => {
  const r = reconcileReport(NO_REPORT, unknownScrape, now, undefined, null, undefined);
  assert.notEqual(r.state, STATE.AUTH_FAILED);
  assert.equal(r.state, STATE.UNKNOWN);
});

test('a report present under a dead credential surfaces as a conflict (the report cannot know the token is dead)', () => {
  const reported = { found: true, state: 'working', at: new Date(now).toISOString() };
  const r = reconcileReport(reported, unknownScrape, now, undefined, null, cap.EXPIRED);
  assert.equal(r.state, STATE.AUTH_FAILED);
  assert.equal(r.reported, false);
  assert.ok(r.conflict && /OpenAI sign-in is being rejected/.test(r.conflict));
});

// --- SAFETY: the produce must NOT fire on anything but a positive dead read ---

test('SAFETY: a HEALTHY verdict never produces auth_failed', () => {
  const r = reconcileReport(NO_REPORT, unknownScrape, now, undefined, null, cap.HEALTHY);
  assert.notEqual(r.state, STATE.AUTH_FAILED);
});

test('SAFETY: an UNKNOWN/unreachable verdict never produces auth_failed', () => {
  const r = reconcileReport(NO_REPORT, unknownScrape, now, undefined, null, cap.UNKNOWN);
  assert.notEqual(r.state, STATE.AUTH_FAILED);
});

test('SAFETY: an UNCHECKED verdict never produces auth_failed', () => {
  const r = reconcileReport(NO_REPORT, unknownScrape, now, undefined, null, cap.UNCHECKED);
  assert.notEqual(r.state, STATE.AUTH_FAILED);
});

test('GUARD: a dead verdict never overrides a scrape that DID say something (WORKING stays WORKING)', () => {
  const workingScrape = { state: STATE.WORKING, confidence: CONFIDENCE.SCRAPED, because: 'it is mid-task' };
  const r = reconcileReport(NO_REPORT, workingScrape, now, undefined, null, cap.EXPIRED);
  assert.equal(r.state, STATE.WORKING, 'a real working codex screen is not reddened by a stale/racing live check');
});

// --- codexLiveAuthFor: the resolution seam ---------------------------------

test('codexLiveAuthFor probes a codex job through its own configDir', () => {
  let sawDir;
  const v = codexLiveAuthFor(
    'agentX',
    () => ({ runner: 'codex', configDir: '/codex/home-x' }),
    (d) => { sawDir = d; return cap.EXPIRED; });
  assert.equal(v, cap.EXPIRED);
  assert.equal(sawDir, '/codex/home-x', 'probes the agent OWN home');
});

test('codexLiveAuthFor resolves a default-home codex job (configDir null) to null for the probe to default', () => {
  let sawDir = 'unset';
  codexLiveAuthFor(
    'agentDefault',
    () => ({ runner: 'codex', configDir: null }),
    (d) => { sawDir = d; return cap.HEALTHY; });
  assert.equal(sawDir, null, 'null configDir is passed as null; codexauthprobe resolves it to defaultDir()');
});

test('SAFETY: codexLiveAuthFor NEVER probes a CLAUDE job (an OpenAI check must not judge a Claude agent)', () => {
  let probed = false;
  const v = codexLiveAuthFor(
    'claudeAgent',
    () => ({ runner: 'claude', configDir: '/claude/acct' }),
    () => { probed = true; return cap.EXPIRED; });
  assert.equal(v, undefined, 'a non-codex job yields no verdict');
  assert.equal(probed, false, 'and the probe is never even called');
});

test('SAFETY: an unresolvable job (readJob null) yields no verdict, so UNKNOWN stands', () => {
  assert.equal(codexLiveAuthFor('gone', () => null, () => cap.EXPIRED), undefined);
});

test('SAFETY: a throwing readJob yields no verdict (never a produce off a crash)', () => {
  assert.equal(codexLiveAuthFor('boom', () => { throw new Error('io'); }, () => cap.EXPIRED), undefined);
});

test('a malformed job (empty-string configDir) yields no verdict, same guard as liveAuthForAuthFailed', () => {
  assert.equal(codexLiveAuthFor('malformed', () => ({ runner: 'codex', configDir: '' }), () => cap.EXPIRED), undefined);
});
