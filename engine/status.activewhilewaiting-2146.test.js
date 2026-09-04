'use strict';
/*
 * kosmos#2146 -- an agent that IS actively working but also carries a sticky
 * needs_you/blocked report has its "Working" indicator hidden, because the
 * report state wins (rule 6: needs_you never decays). The fix is an ADDITIVE
 * coexistence flag `activeWhileWaiting` -- the state and its count are unchanged,
 * the render shows the working animation alongside the pending needs_you.
 *
 * THE DANGEROUS-ANSWER CONTROL (Pete): a JUST-filed needs_you must NOT
 * self-trigger the flag. The report route pins the report's own liveness beat to
 * the report's `at`, and the heartbeat leg uses a STRICT `>` gate, so the
 * report's own beat is excluded. If a bare just-asked needs_you ever reads
 * activeWhileWaiting:true, the flag is firing on the ask itself.
 *
 *   node --test engine/status.activewhilewaiting-2146.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-aww-2146-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const status = require('./status');
const activity = require('./activity');
const { STATE, freshestActivity, activeWhileWaitingFrom } = status;

// ---- activeWhileWaitingFrom: the pure decision + the control ---------------

test('pane leg: a WAITING state with a live pane WORKING_LINE this tick is active', () => {
  const fresh = { atMs: 1000, source: 'pane' };
  assert.equal(activeWhileWaitingFrom(STATE.NEEDS_YOU, fresh, 999), true);
  assert.equal(activeWhileWaitingFrom(STATE.BLOCKED, fresh, 999), true);
  // pane is definitionally "this tick" -> after any ask, and even with no ask time.
  assert.equal(activeWhileWaitingFrom(STATE.NEEDS_YOU, fresh, NaN), true);
});

test('heartbeat leg: active only when the beat is STRICTLY newer than the ask', () => {
  assert.equal(activeWhileWaitingFrom(STATE.NEEDS_YOU, { atMs: 2000, source: 'report' }, 1000), true, 'a beat after the ask = still working after it asked');
  // THE CONTROL: the report's own pinned beat (atMs === askedAt) is EXCLUDED.
  assert.equal(activeWhileWaitingFrom(STATE.NEEDS_YOU, { atMs: 1000, source: 'report' }, 1000), false, 'the report\'s OWN beat must never self-trigger');
  // and a beat older than the ask (stale) never fires.
  assert.equal(activeWhileWaitingFrom(STATE.NEEDS_YOU, { atMs: 500, source: 'report' }, 1000), false);
  // with no ask time we cannot prove "after", so the heartbeat leg abstains.
  assert.equal(activeWhileWaitingFrom(STATE.NEEDS_YOU, { atMs: 2000, source: 'report' }, NaN), false);
});

test('never fires outside a WAITING state, and never on no evidence', () => {
  assert.equal(activeWhileWaitingFrom(STATE.WORKING, { atMs: 2000, source: 'pane' }, 1000), false, 'a working agent is just working, not "active while waiting"');
  assert.equal(activeWhileWaitingFrom(STATE.IDLE, { atMs: 2000, source: 'report' }, 1000), false);
  assert.equal(activeWhileWaitingFrom(STATE.NEEDS_YOU, null, 1000), false, 'no activity evidence -> false');
});

// ---- freshestActivity: the composer ----------------------------------------

test('freshestActivity: pane leg reports source pane at now', () => {
  const f = freshestActivity(null, { nowMs: 5000, paneWorking: true });
  assert.deepEqual(f, { atMs: 5000, source: 'pane' });
});

test('freshestActivity: work-marker leg reads the WORKING marker, and null when there is no evidence', () => {
  assert.equal(freshestActivity('nobody-worked', { nowMs: 5000, paneWorking: false }), null, 'no pane, no work marker -> null (never false)');
  activity.record('worker', 'working', 1, new Date(4900).toISOString());
  const f = freshestActivity('worker', { nowMs: 5000, paneWorking: false });
  assert.equal(f.source, 'report');
  assert.equal(f.atMs, 4900);
});

test('freshestActivity: a STALE work-marker ages out (it is not activity) -- the idle-agent fix', () => {
  // A marker older than the work-stale window means the agent worked once and has
  // since stopped; it must NOT read as active. This is what stops a needs_you
  // agent that finished a turn from reading activeWhileWaiting forever.
  activity.record('stopped-working', 'working', 1, new Date(1000).toISOString());
  // now is far past the marker + the 180s window -> dropped.
  assert.equal(freshestActivity('stopped-working', { nowMs: 1000 + 181 * 1000, paneWorking: false }), null, 'a stale work-marker is not fresh activity');
  // and inside the window it IS considered.
  assert.ok(freshestActivity('stopped-working', { nowMs: 1000 + 60 * 1000, paneWorking: false }), 'a fresh marker within the window counts');
});

test('freshestActivity: reads NOTHING from the liveness beat (work != life)', () => {
  // A liveness heartbeat with NO working marker must not make the agent read
  // active -- liveness beats on idle too, and this is the false-positive a review
  // caught. Only the working marker counts.
  const liveness = require('./liveness');
  liveness.seen('alive-not-working', new Date(4999).toISOString());
  assert.equal(freshestActivity('alive-not-working', { nowMs: 5000, paneWorking: false }), null, 'a mere proof-of-life beat is NOT work activity');
});

test('freshestActivity: the freshest wins across legs', () => {
  activity.record('mix', 'working', 1, new Date(9000).toISOString());
  // pane (now=9500) vs work marker (9000) -> pane is newer
  assert.equal(freshestActivity('mix', { nowMs: 9500, paneWorking: true }).source, 'pane');
  // a marker newer than now would win, but time only moves forward; instead pin
  // a case where the marker is the freshest available and the pane leg is absent.
  assert.equal(freshestActivity('mix', { nowMs: 9100, paneWorking: false }).source, 'report');
});

// ---- snapshot INTEGRATION: the heartbeat leg on a real card ----------------
// The paneless path is the one this role exists for (Windows/Codex). We drive it
// through the pane path here via the fleet fixture for the pane leg, and assert
// the self-trigger control on a plain needs_you.

test('INTEGRATION: a needs_you agent whose pane shows WORKING reads activeWhileWaiting (pane leg)', () => {
  const fleet = require('../test-support/fleet');
  // A pane classified WORKING, but a sticky needs_you SELF-REPORT on file: the
  // report wins the STATE (needs_you), and the flag surfaces the hidden work.
  fleet.install([fleet.agent('busy-waiter', { state: 'working' })]);
  const selfreport = require('./selfreport');
  // A sticky needs_you SELF-REPORT (never decays, rule 6) so the reconciled state
  // is needs_you and the pane's WORKING is the coexisting activity.
  const rec = selfreport.record('busy-waiter', { state: 'needs_you', because: 'May I merge?' });
  assert.equal(rec.recorded, true, 'the needs_you report registered');
  const card = status.snapshot().agents.find((a) => a.sessionName === 'busy-waiter');
  assert.ok(card, 'the agent is on the board');
  assert.equal(card.state, STATE.NEEDS_YOU, 'the sticky needs_you still wins the state (and stays counted)');
  assert.equal(card.activeWhileWaiting, true, 'but the coexisting work is surfaced');
});

test('INTEGRATION: a needs_you agent with a FRESH work-marker after the ask reads activeWhileWaiting (heartbeat leg)', () => {
  const fleet = require('../test-support/fleet');
  const selfreport = require('./selfreport');
  // Pane is IDLE (not working), so the pane leg is off -- only the work-marker
  // (heartbeat) leg can set the flag. This is the Windows/Codex-shaped case.
  fleet.install([fleet.agent('working-quietly', { state: 'idle' })]);
  const rec = selfreport.record('working-quietly', { state: 'needs_you', because: 'May I merge?' });
  assert.equal(rec.recorded, true);
  // A working report landed AFTER the ask (a refused auto-working still writes the
  // marker) -> the agent is working while its needs_you stands.
  activity.record('working-quietly', 'working', 1, new Date(Date.parse(rec.at) + 1000).toISOString());
  const card = status.snapshot().agents.find((a) => a.sessionName === 'working-quietly');
  assert.equal(card.state, STATE.NEEDS_YOU);
  assert.equal(card.activeWhileWaiting, true, 'the heartbeat leg surfaces work under a sticky needs_you with no pane signal');
});

test('INTEGRATION: a work-marker from BEFORE the ask does NOT fire (worked, then asked, then idle)', () => {
  const fleet = require('../test-support/fleet');
  const selfreport = require('./selfreport');
  fleet.install([fleet.agent('asked-then-idle', { state: 'idle' })]);
  // The agent worked, then asked. The last work-marker predates the ask.
  const now = Date.now();
  activity.record('asked-then-idle', 'working', 1, new Date(now - 5000).toISOString());
  const rec = selfreport.record('asked-then-idle', { state: 'needs_you', because: 'May I merge?' });
  assert.equal(rec.recorded, true);
  const card = status.snapshot().agents.find((a) => a.sessionName === 'asked-then-idle');
  assert.equal(card.state, STATE.NEEDS_YOU);
  assert.equal(card.activeWhileWaiting, false, 'a marker older than the ask is "worked then asked", not "working while waiting"');
});

test('INTEGRATION CONTROL: a plain needs_you agent (no coexisting work) reads activeWhileWaiting:false', () => {
  const fleet = require('../test-support/fleet');
  fleet.install([fleet.agent('just-asking', { state: 'needs_you' })]);
  const card = status.snapshot().agents.find((a) => a.sessionName === 'just-asking');
  assert.equal(card.state, STATE.NEEDS_YOU);
  assert.equal(card.activeWhileWaiting, false, 'a needs_you with nothing working behind it is NOT active-while-waiting');
});
