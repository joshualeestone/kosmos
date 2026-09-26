'use strict';
/*
 * kosmos#2019 -- a dead pane reads as RESTARTING, not "gone", while a
 * deliberate disruption we initiated (restart / model / provider / account /
 * instructions change) is on file and fresh.
 *
 * Two tiers:
 *   - reconcileReport UNIT: the decision itself, with the discriminating control
 *     (same STOPPED input, WITH vs WITHOUT the record -> RESTARTING vs STOPPED).
 *   - snapshot() INTEGRATION: proves snapshot actually RESOLVES disruption.active
 *     and PASSES it (the unit test cannot see that wiring), and proves the
 *     isNamedOurs gate.
 *
 *   node --test engine/status.disruption-2019.test.js
 */
// Sandbox the store BEFORE requiring anything: disruption/store resolve their
// root at load, and the integration tests write real disruption records.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-disruption-2019-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const fleet = require('../test-support/fleet');
const status = require('./status');
const disruption = require('./disruption');

const { STATE, CONFIDENCE, reconcileReport } = status;
const freshRec = (cause) => ({ cause, startedAt: new Date(Date.now() - 1000).toISOString() });
const STOPPED_SCRAPE = { state: STATE.STOPPED, confidence: CONFIDENCE.STRUCTURED, because: 'Claude is not running for this one' };

// ---- reconcileReport unit ------------------------------------------------

test('THE FIX: a structured-STOPPED pane with a fresh disruption reads RESTARTING, carrying the cause', () => {
  const out = reconcileReport({ found: false }, STOPPED_SCRAPE, Date.now(), undefined, freshRec('model'));
  assert.equal(out.state, STATE.RESTARTING);
  assert.equal(out.confidence, CONFIDENCE.STRUCTURED);
  assert.ok(out.disruption, 'carries the disruption object');
  assert.equal(out.disruption.cause, 'model');
  assert.ok(Number.isFinite(Date.parse(out.disruption.startedAt)));
});

test('THE CONTROL: the SAME STOPPED input with NO disruption record reads STOPPED', () => {
  // This is the discriminator -- identical inputs but for the record. If this
  // returned RESTARTING the state would be meaningless; if the test above
  // returned STOPPED the fix would be absent. Both must hold.
  const out = reconcileReport({ found: false }, STOPPED_SCRAPE, Date.now(), undefined, null);
  assert.equal(out.state, STATE.STOPPED);
  assert.equal(out.disruption, undefined);
});

test('a disruption OUTRANKS a reported "stopped": an agent we restarted is mid-restart, not gone', () => {
  const reported = { found: true, state: 'stopped', because: 'it said it was stopping' };
  const out = reconcileReport(reported, STOPPED_SCRAPE, Date.now(), undefined, freshRec('restart'));
  assert.equal(out.state, STATE.RESTARTING);
  assert.equal(out.disruption.cause, 'restart');
});

test('without a disruption, a reported "stopped" over a stopped pane is unchanged (clean goodbye)', () => {
  const reported = { found: true, state: 'stopped', because: 'it said it was stopping' };
  const out = reconcileReport(reported, STOPPED_SCRAPE, Date.now(), undefined, null);
  assert.equal(out.state, STATE.STOPPED);
  assert.equal(out.reported, true);
});

test('the branch is gated on STOPPED: a LIVE pane with a disruption on file is NOT restarting (self-heal)', () => {
  // The pane coming back with a Claude process is how a successful restart ends
  // the state -- classify no longer says STOPPED, so reconcile never reaches the
  // disruption branch even though the record is still fresh.
  const working = { state: STATE.WORKING, confidence: CONFIDENCE.SCRAPED, because: 'it is mid-task' };
  const out = reconcileReport({ found: false }, working, Date.now(), undefined, freshRec('provider'));
  assert.equal(out.state, STATE.WORKING);
  assert.notEqual(out.state, STATE.RESTARTING);
});

test('a SCRAPED (not structured) stopped reading does not trip the disruption branch', () => {
  // rule 2 -- and the disruption branch inside it -- requires STRUCTURED
  // confidence; a soft/scraped stopped is not the "process is gone" signal.
  const softStop = { state: STATE.STOPPED, confidence: CONFIDENCE.SCRAPED, because: 'looked stopped' };
  const out = reconcileReport({ found: false }, softStop, Date.now(), undefined, freshRec('restart'));
  assert.notEqual(out.state, STATE.RESTARTING);
});

// ---- #2019 HONEST TIMEOUT (never a silent "doesn't exist") ----------------

test('HONEST TIMEOUT: a timed-out disruption over a stopped pane reads RESTARTING with timedOut + honest copy', () => {
  // The caller carries an aged-out record forward with timedOut:true. The old
  // behaviour let the pane's bare STOPPED stand once the window elapsed -- a
  // silent revert that reads as "this agent doesn't exist", the message this
  // card removes. Now it stays in the RESTARTING family with an honest message.
  const timedOutRec = { cause: 'restart', startedAt: new Date(Date.now() - 200000).toISOString(), timedOut: true };
  const out = reconcileReport({ found: false }, STOPPED_SCRAPE, Date.now(), undefined, timedOutRec);
  assert.equal(out.state, STATE.RESTARTING, 'a timed-out restart is NEVER a bare STOPPED / doesn\'t-exist');
  assert.equal(out.disruption.timedOut, true, 'the render reads timedOut to stop the animation and show the honest copy');
  assert.match(out.because, /has not come back yet/, 'the message says what happened, honestly');
});

test('a FRESH (not timed-out) disruption carries timedOut:false + the in-progress copy', () => {
  const out = reconcileReport({ found: false }, STOPPED_SCRAPE, Date.now(), undefined, freshRec('model'));
  assert.equal(out.state, STATE.RESTARTING);
  assert.equal(out.disruption.timedOut, false, 'a fresh restart is in-progress, not timed out');
  assert.match(out.because, /briefly out of view/);
});

test('snapshot INTEGRATION: an aged-out record on a stopped pane shows the honest timeout, not STOPPED', () => {
  fleet.install([fleet.agent('overrun', { state: 'stopped' })]);
  // Write the record with a startedAt older than the window so active() reads
  // null but read() still finds it -- the exact "restart has not come back" case.
  disruption.begin('overrun', 'provider', new Date(Date.now() - 200000).toISOString());
  const card = status.snapshot().agents.find((a) => a.sessionName === 'overrun');
  assert.equal(card.state, STATE.RESTARTING, 'the person who clicked restart is never told the agent does not exist');
  assert.ok(card.disruption, 'carries the disruption context');
  assert.equal(card.disruption.timedOut, true);
  assert.equal(card.disruption.cause, 'provider');
});

// ---- snapshot() integration (proves the wiring) --------------------------

test('snapshot RESOLVES and PASSES the record: a stopped OWNED pane flips to restarting once begun', () => {
  fleet.install([fleet.agent('resty', { state: 'stopped' })]);
  // Baseline control: no record yet, so the board says stopped -- proving the
  // flip below is the record's doing, not the fixture's.
  let card = status.snapshot().agents.find((a) => a.sessionName === 'resty');
  assert.ok(card, 'the stopped agent is on the board');
  assert.equal(card.state, STATE.STOPPED);
  assert.equal(card.disruption, null);

  disruption.begin('resty', 'model');
  card = status.snapshot().agents.find((a) => a.sessionName === 'resty');
  assert.equal(card.state, STATE.RESTARTING);
  assert.ok(card.disruption);
  assert.equal(card.disruption.cause, 'model');
});

test('snapshot FORWARD SELF-HEALS: a completed restart (pane back alive) clears the record, so a later crash reads STOPPED not restarting', () => {
  // 1. Stopped pane + fresh record -> restarting.
  fleet.install([fleet.agent('healme', { state: 'stopped' })]);
  disruption.begin('healme', 'restart');
  let card = status.snapshot().agents.find((a) => a.sessionName === 'healme');
  assert.equal(card.state, STATE.RESTARTING);

  // 2. The restart completes: the pane comes back with a live reading. snapshot
  //    clears the record on that first confident live state.
  fleet.install([fleet.agent('healme', { state: 'working' })]);
  card = status.snapshot().agents.find((a) => a.sessionName === 'healme');
  assert.equal(card.state, STATE.WORKING);
  assert.equal(disruption.read('healme').found, false, 'the completed restart did not clear the record');

  // 3. THE POINT: if it now genuinely crashes (within what WAS the window), the
  //    board reads STOPPED, not a lingering restarting -- because the record is
  //    gone. This is the residual the self-heal removes.
  fleet.install([fleet.agent('healme', { state: 'stopped' })]);
  card = status.snapshot().agents.find((a) => a.sessionName === 'healme');
  assert.equal(card.state, STATE.STOPPED);
});

test('snapshot does NOT self-heal on an UNKNOWN (mid-boot) reading -- the record survives so a flip back to STOPPED still reads restarting', () => {
  fleet.install([fleet.agent('booting', { state: 'stopped' })]);
  disruption.begin('booting', 'model');
  let card = status.snapshot().agents.find((a) => a.sessionName === 'booting');
  assert.equal(card.state, STATE.RESTARTING);

  // A mid-boot pane we cannot read yet classifies UNKNOWN. The record must
  // survive (the restart may still be in progress), so it is NOT cleared -- this
  // is the guard that distinguishes the self-heal (clear on a CONFIDENT live
  // reading) from clearing on any non-STOPPED reading. That the surviving record
  // then makes a flip back to STOPPED read RESTARTING is covered by the unit
  // tests above; here we assert only the thing this test is about -- the record
  // is not cleared on UNKNOWN. (We cannot re-install 'stopped' to show it: the
  // fixture's verify runs the reconciled state, which with the record on file is
  // RESTARTING, not the 'stopped' the spec would assert.)
  fleet.install([fleet.agent('booting', { state: 'unknown' })]);
  card = status.snapshot().agents.find((a) => a.sessionName === 'booting');
  assert.equal(disruption.read('booting').found, true, 'an UNKNOWN mid-boot reading wrongly cleared the record');
});

// Note on the isNamedOurs gate: snapshot only looks up a disruption for a pane
// TIED to its name (`isNamedOurs(pane) ? disruption.active(pane.name) : null`).
// It is not exercised end-to-end here because a stranger pane never presents as
// structured-STOPPED in the first place -- classify refuses to read a pane it
// cannot attribute, so it comes back `unknown` and never reaches the RESTARTING
// branch (verified: fleet.stranger(..., {state:'stopped'}) classifies unknown).
// The gate is therefore belt-and-suspenders, and the unit control above (STOPPED
// + null record -> STOPPED) already proves the branch fires only on a record.

// ---- #4006: a restart that did NOT come back -------------------------------

test('#4006: a FAILED restart record on a stopped pane reads needs_you and says so; a fresh one still reads restarting', () => {
  const failed = { cause: 'restart', startedAt: new Date(Date.now() - 1000).toISOString(), failed: true };
  const out = reconcileReport({ found: false }, STOPPED_SCRAPE, Date.now(), undefined, failed);
  assert.equal(out.state, STATE.NEEDS_YOU, 'a restart that did not come back is not a quiet stopped or a spinner');
  assert.match(out.because, /did not come back/);
  assert.equal(out.disruption.failed, true);
  // It outranks a stale report from the instance that died (Elon's trailing idle).
  const stale = reconcileReport({ found: true, state: 'idle', auto: true, at: new Date().toISOString() }, STOPPED_SCRAPE, Date.now(), undefined, failed);
  assert.equal(stale.state, STATE.NEEDS_YOU, 'the dying instance\'s last idle hid the failure');
  // CONTROL: the same record not marked failed is the ordinary in-flight restart.
  assert.equal(reconcileReport({ found: false }, STOPPED_SCRAPE, Date.now(), undefined, freshRec('restart')).state, STATE.RESTARTING);
});

test('#4006 snapshot: a failed restart keeps its red across ticks and clears once the agent is running again', () => {
  fleet.install([fleet.agent('elonpane', { state: 'stopped' })]);
  disruption.begin('elonpane', 'restart');
  disruption.fail('elonpane', { bootstrap: { ok: true, code: 5 } });
  let card = status.snapshot().agents.find((a) => a.sessionName === 'elonpane');
  assert.equal(card.state, STATE.NEEDS_YOU, JSON.stringify(card && { state: card.state, because: card.because }));
  assert.match(card.because, /did not come back/);
  card = status.snapshot().agents.find((a) => a.sessionName === 'elonpane');
  assert.equal(card.state, STATE.NEEDS_YOU, 'the self-heal cleared the failed record on the next tick');
  assert.equal(disruption.read('elonpane').failed, true);
  fleet.install([fleet.agent('elonpane', { state: 'working' })]);
  card = status.snapshot().agents.find((a) => a.sessionName === 'elonpane');
  assert.equal(card.state, STATE.WORKING);
  assert.equal(disruption.read('elonpane').found, false, 'the agent is back, and the failed record did not clear');
});

test('#4006 snapshot: a created agent with NO pane whose restart failed (Josh\'s Elon) reads needs_you, not "not running"', () => {
  fleet.install([]);
  status.setCreatedSource(() => ['elongone']);
  try {
    let card = status.snapshot().agents.find((a) => a.sessionName === 'elongone');
    assert.ok(card, 'the created agent is on the board');
    assert.equal(card.state, STATE.STOPPED, 'CONTROL: with no record it is the plain created-not-running');
    disruption.begin('elongone', 'restart');
    card = status.snapshot().agents.find((a) => a.sessionName === 'elongone');
    assert.equal(card.state, STATE.STOPPED, 'CONTROL: an in-flight (not failed) record does not change a paneless card');
    disruption.fail('elongone', null);
    card = status.snapshot().agents.find((a) => a.sessionName === 'elongone');
    assert.equal(card.state, STATE.NEEDS_YOU, JSON.stringify({ state: card.state, because: card.because }));
    assert.match(card.because, /did not come back/);
  } finally {
    status.setCreatedSource(null);
    disruption.clear('elongone');
  }
});

test('#4006: disruption.fail keeps the cause and start, marks it failed, and keeps the diagnostics on disk', () => {
  disruption.begin('diagme', 'model');
  const began = disruption.read('diagme');
  assert.equal(disruption.fail('diagme', { bootstrap: { ok: false, code: 5, stderr: 'Bootstrap failed: 5: Input/output error' } }).ok, true);
  const r = disruption.read('diagme');
  assert.equal(r.failed, true);
  assert.equal(r.cause, 'model');
  assert.equal(r.startedAt, began.startedAt);
  assert.ok(disruption.active('diagme').failed, 'a failed record inside the window must not read as an in-flight restart');
  const onDisk = JSON.parse(fs.readFileSync(disruption.fileFor('diagme'), 'utf8'));
  assert.match(onDisk.diagnostics.bootstrap.stderr, /Input\/output error/);
  disruption.clear('diagme');
});

test('#4006 snapshot: a failed record clears as soon as the pane runs anything, an UNKNOWN reading included', () => {
  fleet.install([fleet.agent('backunknown', { state: 'stopped' })]);
  disruption.begin('backunknown', 'restart');
  disruption.fail('backunknown', null);
  assert.equal(status.snapshot().agents.find((a) => a.sessionName === 'backunknown').state, STATE.NEEDS_YOU);
  fleet.install([fleet.agent('backunknown', { state: 'unknown' })]);
  const card = status.snapshot().agents.find((a) => a.sessionName === 'backunknown');
  assert.equal(card.state, STATE.UNKNOWN);
  assert.equal(disruption.read('backunknown').found, false, 'an agent that came back reading unknown kept its failed record');
});

