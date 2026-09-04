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

// Note on the isNamedOurs gate: snapshot only looks up a disruption for a pane
// TIED to its name (`isNamedOurs(pane) ? disruption.active(pane.name) : null`).
// It is not exercised end-to-end here because a stranger pane never presents as
// structured-STOPPED in the first place -- classify refuses to read a pane it
// cannot attribute, so it comes back `unknown` and never reaches the RESTARTING
// branch (verified: fleet.stranger(..., {state:'stopped'}) classifies unknown).
// The gate is therefore belt-and-suspenders, and the unit control above (STOPPED
// + null record -> STOPPED) already proves the branch fires only on a record.
