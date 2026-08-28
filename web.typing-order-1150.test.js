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

test('#1150: the room history that arrives when you open a room is not everybody speaking, in EVERY room', () => {
  /* ⚠️ THE SEEDING GUARD. A room opens with its whole history at once. Stamping
     those as "just spoke" blanks the working line for a poll every time somebody
     opens a room, which is a new defect wearing the fix's clothes.
     🛑 AND IT USED TO BE ONE BOOLEAN FOR THE WHOLE PAGE, set after the first
     room painted and never reset, so it protected exactly the room you happened
     to open FIRST and stamped every room after it. Found by spot-checking this
     PR after learning it had merged ungated.
     🔑 DRIVEN, NOT MATCHED. The previous version of this test asserted the
     SHAPE of the guard and would have passed against the one-boolean version,
     which is how the defect shipped under a green test. */
  /* 🔑 THE PAGE'S OWN SEEDING BLOCK, SLICED OUT OF THE SHIPPED SOURCE rather
     than retyped here. Retyping it would test this file's copy of the logic,
     which is precisely how the one-boolean version passed a green test. */
  const from = SCRIPT.indexOf('const seededRoom = ROOM_SPOKE_SEEDED.has(PJ_CURRENT);');
  assert.ok(from > -1, 'the seeding block moved; this test is no longer reading the real one');
  const to = SCRIPT.indexOf('ROOM_SPOKE_SEEDED.add(PJ_CURRENT);', from);
  assert.ok(to > from, 'the seeding block no longer ends where this test expects');
  const BLOCK = SCRIPT.slice(from, to + 'ROOM_SPOKE_SEEDED.add(PJ_CURRENT);'.length);
  const seedRuns = [];
  // eslint-disable-next-line no-new-func
  const seed = new Function(
    'PJ_CURRENT', 'allRows', 'ROOM_SPOKE_SEEDED', 'ROOM_SPOKE_AT', 'OUT', 'body',
    BLOCK + '\nOUT.push(seededRoom);',
  );
  const SEEDED = new Set();
  const SPOKE = new Map();
  const hist = (who) => [{ from: who, at: new Date().toISOString(), text: 'hi' }];
  /* `body` is `paintRoom`'s own argument; the slice needs it in scope because
     the seeded-set add is now gated on the paint having carried the record. */
  const OK = { ok: true };

  seed('project-a', hist('dana'), SEEDED, SPOKE, seedRuns, OK);
  assert.equal(SPOKE.get('dana').learnedAt, 0, 'the FIRST room stamped its history as speech');

  /* THE DEFECT: a second room, opened after the first, is history too. */
  seed('project-b', hist('erin'), SEEDED, SPOKE, seedRuns, OK);
  assert.equal(SPOKE.get('erin').learnedAt, 0,
    'a second room stamped its history as speech, so its working line blanks for a poll');

  /* 🔑 THE OTHER ARM: a post arriving in a room ALREADY open is real speech and
     must still stamp, or the fix has become "never suppress anything". */
  seed('project-b', [{ from: 'erin', at: new Date(Date.now() + 60000).toISOString(), text: 'later' }], SEEDED, SPOKE, seedRuns, OK);
  assert.ok(SPOKE.get('erin').learnedAt > 0, 'a new post in an open room stopped counting as speech');

  /* 🔑 THE SEED FLAGS THEMSELVES, ASSERTED. They were collected and never read,
     so the per-room semantics were only ever INFERRED from `learnedAt`. This is
     the one line that states the fix's actual claim: unseeded, unseeded because
     it is a different room, then seeded. */
  assert.deepEqual(seedRuns, [false, false, true],
    'the seeding flags do not follow the room, so the guard is not per room');

  /* 🛑 SEEDING A ROOM MUST NOT CLEAR A STAMP ANOTHER ROOM EARNED, and this arm
     is a REGRESSION GUARD AGAINST MY OWN FIX: without it the branch was WORSE
     than the page-wide boolean on this one path, because main happened to have
     already flipped its flag by then and so suppressed correctly.

     X speaks for real in room A, then room B is opened unseeded holding a NEWER
     X message. `learnedAt` is drop-when-recent, so clearing it to 0 RENDERS the
     name next to a reply already on screen. That is #1150 itself, narrowly. */
  const SEEN2 = new Set();
  const SPOKE2 = new Map();
  const T0 = Date.now();
  const at = (ms) => new Date(T0 + ms).toISOString();
  seed('room-a', [{ from: 'xavier', at: at(0), text: 'history' }], SEEN2, SPOKE2, seedRuns, OK);
  assert.equal(SPOKE2.get('xavier').learnedAt, 0, 'the first room stamped its own history');
  seed('room-a', [{ from: 'xavier', at: at(60000), text: 'real speech' }], SEEN2, SPOKE2, seedRuns, OK);
  const earned = SPOKE2.get('xavier').learnedAt;
  assert.ok(earned > 0, 'speech in an open room did not stamp, so the setup proves nothing');
  seed('room-b', [{ from: 'xavier', at: at(120000), text: 'newer, in another room' }], SEEN2, SPOKE2, seedRuns, OK);
  assert.equal(SPOKE2.get('xavier').learnedAt, earned,
    'opening a second room cleared a stamp the first room earned, so the working '
    + 'line renders an agent whose reply is already on screen');
  /* AND THE TIMESTAMP STILL MOVES, or the dedup goes stale and later speech in
     the newer room can never register. */
  assert.equal(SPOKE2.get('xavier').at, Date.parse(at(120000)),
    'preserving the stamp also froze `at`, which the dedup compares');
  /* THE CONTROL: an OLDER message in the second room is skipped by the dedup,
     so this arm can come out the other way and the trace above is a measurement
     rather than an artefact of the fixture. */
  const before = SPOKE2.get('xavier').at;
  seed('room-c', [{ from: 'xavier', at: at(30000), text: 'older' }], SEEN2, SPOKE2, seedRuns, OK);
  assert.equal(SPOKE2.get('xavier').at, before, 'the dedup let an older message through');

  /* 🛑 A FIRST PAINT THAT CARRIED NO RECORD MUST NOT MARK THE ROOM SEEDED.
     `engine/messages.js` returns `{ ok: false, rows: [] }` on a read failure of
     the message log and the route sends it at HTTP 200, so this paints. If the
     room is marked seeded on that empty paint, the REAL backlog arrives next
     poll into a room believed already seeded and every member is stamped as
     having just spoken - which blanks the working line, the exact thing the
     guard exists to prevent. */
  const SEEN3 = new Set();
  const SPOKE3 = new Map();
  seed('room-d', [], SEEN3, SPOKE3, seedRuns, { ok: false });
  assert.equal(SEEN3.has('room-d'), false,
    'a paint that carried no record still marked the room seeded');
  seed('room-d', [{ from: 'yuki', at: at(0), text: 'the real backlog' }], SEEN3, SPOKE3, seedRuns, OK);
  assert.equal(SPOKE3.get('yuki').learnedAt, 0,
    'the backlog arriving after an empty paint was stamped as speech');

  /* And the shipped page uses the per-room set rather than a page-wide flag. */
  assert.match(SCRIPT, /const ROOM_SPOKE_SEEDED = new Set\(/,
    'the page-wide boolean is back');
  assert.match(SCRIPT, /ROOM_SPOKE_SEEDED\.has\(PJ_CURRENT\)/,
    'the seed is no longer keyed on the room');
});

test('#1150: both stamps come from this page, never from a server time', () => {
  /* Comparing a server timestamp to a browser clock is a skew bug waiting for a
     slow machine. Both sides of the comparison are Date.now() taken here. */
  assert.match(SCRIPT, /LAST_AT = Date\.now\(\);/, 'the snapshot stamp is not local');
  const fn = page.lift(SCRIPT, 'paintRoomBusy');
  assert.match(fn, /spoke\.learnedAt > LAST_AT/, 'the comparison is not the two local stamps');
  assert.doesNotMatch(fn, /Date\.parse|new Date/, 'a server time reached the comparison');
});
