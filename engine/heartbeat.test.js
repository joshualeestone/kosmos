'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { tick, step, rowsFrom } = require('./heartbeat');
const fleet = require('../test-support/fleet');

// Real board rows for the given [name, state] specs, produced by the actual
// snapshot()/classify() via the fleet fixture (test-support/fleet), so a test of
// the board-consuming code (rowsFrom, step) reads the fields the producer really
// emits -- fixture-discipline.test.js forbids hand-building a roster row exactly
// because a hand-built one can carry a field the board does not.
function boardRows(specs) {
  const b = fleet.install(specs.map(([n, s]) => fleet.agent(n, { state: s })));
  const rows = b.agents.map((a) => ({ ...a })); // plain copies of the real rows, all fields, no sessionName literal
  b.restore();
  return rows;
}

/* #1722. The heartbeat composes the board's already-classified states and asks a
 * check-in QUESTION when an agent is in an open stall. These cases pin the three
 * decisions this module makes: the edge (an episode opens on working -> stall),
 * Splinter's silence fix (working -> UNREADABLE is asked about, not passed over
 * -- Kitty's 70-minute stall), and the delivery contract (an UNCONFIRMED ask
 * must not burn the slot: an open stall keeps being asked until the runner marks
 * `asked` on confirmed delivery). Detection is status.js classify()'s job and is
 * not re-tested here. */

const row = (sessionName, state, confidence) => ({ sessionName, state, confidence });

test('working -> stopped opens an episode and asks', () => {
  const t1 = tick([row('a', 'working', 'scraped')], new Map());
  assert.deepEqual(t1.toAsk, []);
  const t2 = tick([row('a', 'stopped', 'structured')], t1.next);
  assert.equal(t2.toAsk.length, 1);
  assert.equal(t2.toAsk[0].session, 'a');
  assert.equal(t2.toAsk[0].from, 'working');
  assert.equal(t2.toAsk[0].to, 'stopped');
});

test('an UNCONFIRMED ask does NOT burn the slot: a still-stopped agent is re-asked', () => {
  let s = tick([row('a', 'working', 'scraped')], new Map()).next;
  const t2 = tick([row('a', 'stopped', 'structured')], s); // asked, delivery unconfirmed
  assert.equal(t2.toAsk.length, 1);
  // The runner did NOT confirm delivery, so `asked` stays false in t2.next.
  const t3 = tick([row('a', 'stopped', 'structured')], t2.next);
  assert.equal(t3.toAsk.length, 1, 'unconfirmed => re-ask, never leave it sitting stopped un-asked');
});

test('a CONFIRMED-delivered ask suppresses re-asks within the episode', () => {
  let s = tick([row('a', 'working', 'scraped')], new Map()).next;
  const t2 = tick([row('a', 'stopped', 'structured')], s);
  assert.equal(t2.toAsk.length, 1);
  // The runner confirms delivery: it sets asked=true on the record it carries.
  t2.next.get('a').asked = true;
  const t3 = tick([row('a', 'stopped', 'structured')], t2.next);
  assert.deepEqual(t3.toAsk, [], 'a confirmed ask holds until the agent resumes');
});

test('working -> UNREADABLE asks (never fail toward silence -- the Splinter fix, Kitty 70 min)', () => {
  const s = tick([row('a', 'working', 'scraped')], new Map()).next;
  const t = tick([row('a', 'unknown', 'none')], s); // classify could not read the pane
  assert.equal(t.toAsk.length, 1, 'a working agent gone unreadable must be asked about');
  assert.equal(t.toAsk[0].to, 'unknown');
});

test('working -> idle asks (finished a step, may not have started the next)', () => {
  const s = tick([row('a', 'working', 'scraped')], new Map()).next;
  const t = tick([row('a', 'idle', 'scraped')], s);
  assert.equal(t.toAsk.length, 1);
  assert.equal(t.toAsk[0].to, 'idle');
});

test('working -> needs_you does NOT ask (the person\'s own path)', () => {
  const s = tick([row('a', 'working', 'scraped')], new Map()).next;
  const t = tick([row('a', 'needs_you', 'scraped')], s);
  assert.deepEqual(t.toAsk, []);
});

test('a came-up-stalled agent that NEVER worked is asked after STARTUP_STALL_TICKS (Splinter, 21:31 dead-on-boot)', () => {
  // No working frame ever -- the edge can never fire. The persistent-stall opener
  // must still ask, or a bot dead from the moment it started is never chased.
  const t1 = tick([row('a', 'stopped', 'structured')], new Map());
  assert.deepEqual(t1.toAsk, [], 'tick 1 is a boot grace, not yet a question');
  const t2 = tick([row('a', 'stopped', 'structured')], t1.next);
  assert.equal(t2.toAsk.length, 1, 'a never-worked agent still stalled after 2 ticks has earned a question');
  assert.equal(t2.toAsk[0].to, 'stopped');
});

test('a fast normal boot (stalled one tick, then works) is never asked -- boot grace', () => {
  const s = tick([row('a', 'stopped', 'structured')], new Map()); // tick 1: grace
  assert.deepEqual(s.toAsk, []);
  const t = tick([row('a', 'working', 'scraped')], s.next);       // booted and working
  assert.deepEqual(t.toAsk, [], 'a normal boot within the grace window is not nagged');
});

test('resuming closes the episode; a fresh stall opens a new one and asks again', () => {
  let s = tick([row('a', 'working', 'scraped')], new Map()).next;
  s = tick([row('a', 'idle', 'scraped')], s).next;    // asked (episode 1)
  s = tick([row('a', 'working', 'scraped')], s).next; // back to work: episode closed
  const t = tick([row('a', 'idle', 'scraped')], s);   // stalls again: episode 2
  assert.equal(t.toAsk.length, 1, 'a new working->stall episode is a new question');
});

test('a missing state field is treated as unreadable and asked about from working', () => {
  const s = tick([row('a', 'working', 'scraped')], new Map()).next;
  const t = tick([row('a')], s); // no state, no confidence: a malformed/unreadable row
  assert.equal(t.toAsk.length, 1);
  assert.equal(t.toAsk[0].to, 'unknown');
});

test('rows with no session name are skipped without throwing', () => {
  const t = tick([{ state: 'stopped' }, null, row('a', 'working', 'scraped')], new Map());
  assert.deepEqual(t.toAsk, []);
  assert.equal(t.next.get('a').prev, 'working');
});

test('rowsFrom maps the REAL board stateConfidence field (not confidence) and tolerates null', () => {
  assert.deepEqual(rowsFrom(null), []);
  assert.deepEqual(rowsFrom(undefined), []);
  // A real board row from the fixture, so this proves rowsFrom reads the field
  // the producer actually emits (stateConfidence), not a name I hand-picked.
  const real = boardRows([['mara', 'stopped']]);
  const mapped = rowsFrom(real);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].confidence, real[0].stateConfidence,
    'rowsFrom must carry the board stateConfidence into confidence, or every reading looks fully confident');
  assert.ok(mapped[0].confidence, 'a real stopped row has a confidence, so the mapping is not vacuously undefined');
  // A row with no session name is dropped (no sessionName key: not a hand-built card).
  const withStray = rowsFrom([...real, { name: 'noSession', state: 'working' }]);
  assert.equal(withStray.length, 1);
});

test('step ON runs the tick; step OFF resets the baseline so re-enabling cannot fabricate an edge', () => {
  const workingRow = boardRows([['mara', 'working']]); // real board rows
  const stoppedRow = boardRows([['mara', 'stopped']]);
  const working = step(new Map(), workingRow, true);
  const off = step(working.next, stoppedRow, false);
  assert.deepEqual(off.toAsk, [], 'OFF asks nothing');
  assert.equal(off.next.size, 0, 'OFF resets the baseline');
  // Re-enabling: the reset baseline means the stall is a first sighting, not a
  // working->stall edge, so no spurious ask on the very first on-tick.
  const backOn = step(off.next, stoppedRow, true);
  assert.deepEqual(backOn.toAsk, [], 'the first on-tick after off is a fresh baseline, not a stale edge');
});
