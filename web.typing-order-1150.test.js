'use strict';

/**
 * #1150. Josh, 2026-08-27 16:18, on a fresh 0.5.86 install:
 *
 *   "I'm not seeing the '...' that they're talking or formulating a message
 *    until the message pops in and then I see the '...' kind of after it."
 *
 * 🛑 IT IS NOT STALENESS, WHICH IS WHY IT WAS NOT FOLDED INTO #972. The room's
 * messages and the working line are painted from DIFFERENT FETCHES ON DIFFERENT
 * CLOCKS, and the page says so itself at the history-delete call site: "the
 * threads are painted from their own fetches on their own clocks". So their
 * relative order is arbitrary, a refresh does not fix it, and the indicator can
 * follow the reply that produced it.
 *
 * 🔑 THE REAL FUNCTION, LIFTED FROM THE SHIPPED PAGE, not a copy of its logic.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const page = require('./test-support/page');
const fleet = require('./test-support/fleet');

const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));

/* The painter reads a handful of module-level values and one element. Both are
   supplied here so the test drives the real branch rather than a stub of it. */
function run({ agents, lastAt, spoke }) {
  const el = { hidden: null, innerHTML: '' };
  // eslint-disable-next-line no-new-func
  const paint = new Function(
    'AGENTS', 'LAST_AT_IN', 'SPOKE', 'EL',
    'const document = { getElementById: () => EL };\n'
    + 'let LAST = AGENTS; let LAST_AT = LAST_AT_IN;\n'
    + 'const ROOM_SPOKE_AT = SPOKE;\n'
    + "const WORKING_VERB = 'working';\n"
    + 'const esc = (t) => String(t == null ? "" : t);\n'
    + page.lift(SCRIPT, 'paintRoomBusy')
    + '; return paintRoomBusy;',
  )(agents, lastAt, spoke, el);
  paint(agents.map((a) => a.sessionName));
  return el;
}

/* 🔑 A REAL CARD FROM test-support/fleet, not a hand-built object. The repo's
   own fixture-discipline test refuses hand-built rows, and it is right: a
   hand-rolled fixture missing one field is how a measurement ends up answering
   a different question accurately. */
const board = fleet.install([fleet.agent('dana', { state: 'working' })]);
const dana = board.agents.find((a) => a && a.name === 'dana');
assert.ok(dana && dana.sessionName, 'the fixture produced no card, so nothing below is testing the painter');
assert.equal(dana.state, 'working', 'the fixture card is not in the state this whole file is about');

test('#1150: an agent whose reply is already on screen is not announced as still working', () => {
  const SNAP = 1000;

  /* 🔑 CONTROL FIRST: with no message at all, the working line paints. If this
     row ever goes quiet the assertions below stop meaning anything. */
  const plain = run({ agents: [dana], lastAt: SNAP, spoke: new Map() });
  assert.equal(plain.hidden, false, 'a working agent is not announced at all');
  assert.match(plain.innerHTML, new RegExp(dana.name), 'the name did not reach the line');
  assert.match(plain.innerHTML, /working/, 'the verb changed, which is a separate claim');

  /* THE DEFECT: we learned of Dana's message AFTER this snapshot was taken, so
     the state we are about to assert is older than the reply already painted. */
  const after = run({
    agents: [dana],
    lastAt: SNAP,
    spoke: new Map([['dana', { at: 1, learnedAt: SNAP + 1 }]]),
  });
  assert.equal(after.hidden, true,
    'the indicator still follows the reply it was supposed to precede');

  /* THE OTHER ARM: a message we learned of BEFORE the snapshot proves nothing
     about it, and the line must still paint. Without this the fix could be
     "never show the indicator" and both other rows would pass. */
  const before = run({
    agents: [dana],
    lastAt: SNAP,
    spoke: new Map([['dana', { at: 1, learnedAt: SNAP - 1 }]]),
  });
  assert.equal(before.hidden, false,
    'an older message is suppressing a state that is newer than it');
  assert.match(before.innerHTML, new RegExp(dana.name), 'the name did not reach the line');
});

test('#1150: the room history that arrives when you open a room is not everybody speaking', () => {
  /* ⚠️ THE SEEDING GUARD. A room opens with its whole history at once. Stamping
     those as "just spoke" would blank the working line for a poll every time
     somebody opens a room, which is a new defect wearing the fix's clothes. */
  assert.match(SCRIPT, /ROOM_SPOKE_SEEDED \? Date\.now\(\) : 0/,
    'the first paint is stamping history as if it had just arrived');
  const seeded = SCRIPT.indexOf('ROOM_SPOKE_SEEDED = true;');
  const stamp = SCRIPT.indexOf('ROOM_SPOKE_SEEDED ? Date.now() : 0');
  assert.ok(stamp > -1 && seeded > stamp,
    'the seed flag is set before the rows are stamped, so the first paint counts as speech');
});

test('#1150: both stamps come from this page, never from a server time', () => {
  /* Comparing a server timestamp to a browser clock is a skew bug waiting for a
     slow machine. Both sides of the comparison are Date.now() taken here. */
  assert.match(SCRIPT, /LAST_AT = Date\.now\(\);/, 'the snapshot stamp is not local');
  const fn = page.lift(SCRIPT, 'paintRoomBusy');
  assert.match(fn, /spoke\.learnedAt > LAST_AT/, 'the comparison is not the two local stamps');
  assert.doesNotMatch(fn, /Date\.parse|new Date/, 'a server time reached the comparison');
});
