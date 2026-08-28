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

/**
 * The NaN guard in `paintRoom` is unreachable ONLY because another module
 * holds the line. This asserts that the other module still holds it.
 *
 * 🛑 I HAD WRITTEN THAT DEPENDENCY IN A COMMENT AND CALLED IT UNTESTABLE:
 * "a test here would assert the behaviour of a guarantee that lives over
 * there". Mona Lisa's correction in cross-review is the useful distinction and
 * it is right: **that is true of the BEHAVIOUR and false of the GUARANTEE'S
 * EXISTENCE**, and the existence is the half this file can hold.
 *
 * ⇒ A comment saying "safe only because X" is a tripwire nothing watches. Where
 * X is a fact about ANOTHER FILE it is assertable, and then the tripwire becomes
 * a guard. (Where X is a property of the code under test, asserting it is
 * circular and the answer is to remove the dependency instead - which is why
 * this is a grep and not a behavioural arm.)
 */
test('#1150: engine/messages.js still rejects unparseable timestamps, which is what makes the NaN guard unreachable', () => {
  const src = fs.readFileSync('engine/messages.js', 'utf8');
  assert.ok(src.length > 1000, 'engine/messages.js read looks broken, so the assertion below would pass for the wrong reason');
  assert.match(src, /typeof m\.at !== 'string' \|\| !Number\.isFinite\(Date\.parse\(m\.at\)\)/,
    'engine/messages.js no longer rejects rows whose `at` is not a parseable string. '
    + 'paintRoom\'s `Number.isFinite` guard was unreachable BECAUSE of that filter; '
    + 'if it has loosened, a NaN `at` now compares false against every later value, '
    + 'so that speaker is re-stamped forever and drops out of the working line permanently.');
  /* THE CONTROL: the matcher can say no. Without it a broken regex passes by
     matching nothing and reports the guarantee intact. */
  assert.doesNotMatch(src, /zzz-not-a-real-guarantee/, 'the matcher finds text that does not exist');
});

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
  /* Anchored on `const seededRoom =` rather than the whole expression: the
     right-hand side gained a PJ_CURRENT guard and the old literal stopped
     matching, which failed CLOSED with "the seeding block moved" - correct, and
     a reminder that a literal anchor is a position dressed as content. */
  const from = SCRIPT.indexOf('const seededRoom =');
  assert.ok(from > -1, 'the seeding block moved; this test is no longer reading the real one');
  const to = SCRIPT.indexOf('ROOM_SPOKE_SEEDED.add(PJ_CURRENT);', from);
  assert.ok(to > from, 'the seeding block no longer ends where this test expects');
  const BLOCK = SCRIPT.slice(from, to + 'ROOM_SPOKE_SEEDED.add(PJ_CURRENT);'.length);
  const seedRuns = [];
  // eslint-disable-next-line no-new-func
  /* 🔑 `Date` IS A PARAMETER SO THE CLOCK IS CONTROLLABLE. The block stamps with
     `Date.now()`, and two `seed()` calls in a fast test land in the SAME
     millisecond - so "the stamp was refreshed" and "the stamp was preserved"
     produce an identical number and no assertion can separate them. That is the
     defect this whole branch is about, arriving in the test harness itself.
     Shadowing `Date` with a stub that advances on demand makes the two
     distinguishable; `parse` is delegated to the real one because the block uses
     it on message timestamps. */
  const CLOCK = { t: 1000000 };
  const FakeDate = { now: () => CLOCK.t, parse: (v) => Date.parse(v) };
  const seed = new Function(
    'PJ_CURRENT', 'allRows', 'ROOM_SPOKE_SEEDED', 'ROOM_SPOKE_AT', 'OUT', 'body', 'Date',
    BLOCK + '\nOUT.push(seededRoom);',
  );
  const SEEDED = new Set();
  const SPOKE = new Map();
  const hist = (who) => [{ from: who, at: new Date().toISOString(), text: 'hi' }];
  /* `body` is `paintRoom`'s own argument; the slice needs it in scope because
     the seeded-set add is now gated on the paint having carried the record. */
  const OK = { ok: true };

  seed('project-a', hist('dana'), SEEDED, SPOKE, seedRuns, OK, FakeDate);
  assert.equal(SPOKE.get('dana').learnedAt, 0, 'the FIRST room stamped its history as speech');

  /* THE DEFECT: a second room, opened after the first, is history too. */
  seed('project-b', hist('erin'), SEEDED, SPOKE, seedRuns, OK, FakeDate);
  assert.equal(SPOKE.get('erin').learnedAt, 0,
    'a second room stamped its history as speech, so its working line blanks for a poll');

  /* 🔑 THE OTHER ARM: a post arriving in a room ALREADY open is real speech and
     must still stamp, or the fix has become "never suppress anything". */
  seed('project-b', [{ from: 'erin', at: new Date(Date.now() + 60000).toISOString(), text: 'later' }], SEEDED, SPOKE, seedRuns, OK, FakeDate);
  const firstSpeech = SPOKE.get('erin').learnedAt;
  /* 📌 SETUP, NOT A DISCRIMINATOR, and the label matters. Mona Lisa flagged in
     cross-review that this passes on REVERTED code too: the first room seeds
     under the bug as well, so a post in it stamps either way. It is here to
     establish `firstSpeech` for the refresh arm below and to fail loudly if the
     fixture goes inert - not to catch the defect. The two arms that actually
     discriminate are `erin.learnedAt === 0` in the SECOND room, and the
     `seedRuns` deepEqual. */
  assert.ok(firstSpeech > 0, 'the fixture went inert: a post in an open room recorded nothing, so the arms below prove nothing');

  /* 🛑 AND A SECOND POST MUST REFRESH THE STAMP, NOT KEEP THE FIRST ONE. Every
     other arm in this test speaks ONCE per agent per seeded room, so none of
     them could tell a refreshed stamp from a preserved one - which left the
     stamp-preservation clause with an unpinned half. Measured: dropping the
     `seededRoom` branch so a second speech takes the preserved path left all
     three tests GREEN while the stamp went stale.

     ⚠️ A stale stamp is not a harmless one. `LAST_AT` advances past it, the
     consumer's `!(learnedAt > LAST_AT)` stops dropping the agent, and the name
     renders beside a reply already on screen - #1150 itself, by a slower route. */
  CLOCK.t += 5000;
  seed('project-b', [{ from: 'erin', at: new Date(Date.now() + 120000).toISOString(), text: 'again' }], SEEDED, SPOKE, seedRuns, OK, FakeDate);
  assert.ok(SPOKE.get('erin').learnedAt > firstSpeech,
    'a second post in an open room kept the first stamp, so it goes stale and the agent reappears');

  /* 🔑 THE SEED FLAGS THEMSELVES, ASSERTED. They were collected and never read,
     so the per-room semantics were only ever INFERRED from `learnedAt`. This is
     the one line that states the fix's actual claim: unseeded, unseeded because
     it is a different room, then seeded. */
  /* `.slice(0, 3)`, because `seedRuns` is also the OUT sink for every arm below
     and a deepEqual on the whole array would redden this line whenever somebody
     inserts an arm above it. The assertion could not produce a false pass either
     way; this just stops it producing an unrelated false failure. */
  assert.deepEqual(seedRuns.slice(0, 3), [false, false, true],
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
  seed('room-a', [{ from: 'xavier', at: at(0), text: 'history' }], SEEN2, SPOKE2, seedRuns, OK, FakeDate);
  assert.equal(SPOKE2.get('xavier').learnedAt, 0, 'the first room stamped its own history');
  seed('room-a', [{ from: 'xavier', at: at(60000), text: 'real speech' }], SEEN2, SPOKE2, seedRuns, OK, FakeDate);
  const earned = SPOKE2.get('xavier').learnedAt;
  assert.ok(earned > 0, 'speech in an open room did not stamp, so the setup proves nothing');
  /* 🛑 ADVANCE THE CLOCK, OR THIS ARM CANNOT FAIL. `earned` and `Date.now()` were
     the same number across these two calls, so "preserved" and "refreshed"
     produced an identical value and the assertion held either way. Rewriting the
     page to refresh instead of preserve left the WHOLE SUITE green.
     ⭐ That is the exact harness defect this branch documents and fixed for the
     `erin` arm - applied to one arm and not to the other, which is the same
     class of miss as the precedence gap on my sibling branch. */
  CLOCK.t += 7000;
  /* 🔑 ASSERT THE CLOCK CAN DISTINGUISH THE TWO ANSWERS, BEFORE COMPARING THEM.
     The plan claimed this arm was safe "by construction" because `Date` is a
     stub. It is not: it is safe because of the line above, which can be removed,
     reduced or moved with no signal - `assert.equal(a, b)` on a frozen clock is
     trivially satisfied. Measured: neutralise the advance AND mutate the page to
     refresh instead of preserve, and the suite goes green. This makes the
     precondition explicit, so the arm fails rather than passing vacuously. */
  assert.ok(FakeDate.now() > earned,
    'the clock did not move, so "preserved" and "refreshed" are the same number and this arm cannot fail');
  seed('room-b', [{ from: 'xavier', at: at(120000), text: 'newer, in another room' }], SEEN2, SPOKE2, seedRuns, OK, FakeDate);
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
  seed('room-c', [{ from: 'xavier', at: at(30000), text: 'older' }], SEEN2, SPOKE2, seedRuns, OK, FakeDate);
  assert.equal(SPOKE2.get('xavier').at, before, 'the dedup let an older message through');

  /* 🛑 THE DEDUP BOUNDARY, WHICH NOTHING PINNED. A room re-serves the SAME rows
     on every poll - by far the most common thing paintRoom does - and the diff
     had no arm that repainted unchanged rows at all.

     Weakening `at <= seen.at` to `at < seen.at` left the whole suite green and
     BLANKS THE WORKING LINE PERMANENTLY IN EVERY ROOM: an unchanged `at` stops
     being skipped, so in a seeded room every agent is re-stamped on every tick,
     and the consumer drops anyone whose stamp is newer than the snapshot. The
     old test pinned only that SOME dedup exists (deleting the line goes red);
     it did not pin the boundary. */
  const SEEN4 = new Set();
  const SPOKE4 = new Map();
  const fixed = at(0);
  seed('room-e', [{ from: 'zoe', at: fixed, text: 'history' }], SEEN4, SPOKE4, seedRuns, OK, FakeDate);
  CLOCK.t += 3000;
  seed('room-e', [{ from: 'zoe', at: fixed, text: 'history' }], SEEN4, SPOKE4, seedRuns, OK, FakeDate);
  assert.equal(SPOKE4.get('zoe').learnedAt, 0,
    'repainting an unchanged row re-stamped it as speech, so the working line blanks every poll');
  /* THE CONTROL: a genuinely NEWER row in the same seeded room must still stamp,
     or the fix above has become "never count anything as speech". */
  CLOCK.t += 3000;
  seed('room-e', [{ from: 'zoe', at: at(60000), text: 'actually new' }], SEEN4, SPOKE4, seedRuns, OK, FakeDate);
  assert.ok(SPOKE4.get('zoe').learnedAt > 0, 'a genuinely new post in an open room stopped counting as speech');

  /* 🛑 AND THE SEEDING GATE ON THE `ok: true, rows: []` SIDE. The room-d arm below
     pins `{ok:false}`; nothing pinned an EMPTY BUT SUCCESSFUL paint. Tightening
     the gate to `body.ok !== false && allRows.length` - which reads like an
     improvement on the comment beside it - left the whole suite green and
     reintroduces #1150 on the newest-project path: a brand-new room is
     `{ok:true, rows:[]}` on first open, so it would never be seeded, and the
     first real post arrives with `learnedAt = 0` and is announced as working
     beside the reply already on screen. */
  const SEEN5 = new Set();
  const SPOKE5 = new Map();
  seed('room-f', [], SEEN5, SPOKE5, seedRuns, OK, FakeDate);
  assert.equal(SEEN5.has('room-f'), true,
    'an empty but SUCCESSFUL paint left the room unseeded, so its first real post is stamped as speech');
  CLOCK.t += 3000;
  seed('room-f', [{ from: 'ada', at: at(0), text: 'first post in a new project' }], SEEN5, SPOKE5, seedRuns, OK, FakeDate);
  assert.ok(SPOKE5.get('ada').learnedAt > 0,
    'the first post in a new room did not count as speech');

  /* 🛑 NO CURRENT ROOM. Found by Mona Lisa in cross-review, and no arm here
     constructed it because every fixture passes a real room id.

     `__lastBody` is cleared only when ENTERING a project, and the back handlers
     leave it set, so a docs fetch resolving after the user goes back repaints
     with PJ_CURRENT null. Without the guard `.add(null)` makes `.has(null)` true
     forever, and because ROOM_SPOKE_AT is keyed on the SPEAKER GLOBALLY, a later
     no-room paint stamps real agents and hides them from the working line. */
  const SEEN7 = new Set();
  const SPOKE7 = new Map();
  seed(null, [{ from: 'nate', at: at(0), text: 'a repaint with no room' }], SEEN7, SPOKE7, seedRuns, OK, FakeDate);
  assert.equal(SEEN7.has(null), false, 'a paint with no current room marked "null" as a seeded room');
  assert.equal(SEEN7.size, 0, 'a paint with no current room recorded a room at all');
  assert.equal(SPOKE7.has('nate'), false,
    'a paint with no current room recorded speech, which suppresses that agent globally');
  /* THE CONTROL: the same rows WITH a room do record, so the arm above is about
     the missing id and not about the fixture being inert. */
  seed('room-i', [{ from: 'nate', at: at(0), text: 'same rows, real room' }], SEEN7, SPOKE7, seedRuns, OK, FakeDate);
  assert.equal(SPOKE7.has('nate'), true, 'the control did not record, so the arm above proves nothing');

  /* 🛑 A MULTI-ROW BACKLOG, WHICH NO ARM IN THIS FILE EVER PAINTED - and a first
     paint has no other shape. Every fixture above passes `[]` or a single row,
     so the LOOP itself was unpinned: replacing `allRows` with `allRows.slice(0, 1)`
     left the whole 2811-test suite green, and so did turning the dedup's
     `continue` into `break`.

     ⚠️ The defect that hides is this card's own: with only one sender recorded
     on the first paint, every other member of the backlog has no entry, so on
     the next poll their unchanged history rows pass the dedup in a now-seeded
     room, take `Date.now()`, and the working line blanks. */
  const SEEN6 = new Set();
  const SPOKE6 = new Map();
  const backlog = [
    { from: 'ivy', at: at(0), text: 'first' },
    { from: 'jo', at: at(1000), text: 'second' },
    { from: 'kai', at: at(2000), text: 'third' },
  ];
  seed('room-g', backlog, SEEN6, SPOKE6, seedRuns, OK, FakeDate);
  for (const who of ['ivy', 'jo', 'kai']) {
    assert.ok(SPOKE6.has(who), `${who} was never recorded, so the loop stopped early`);
    assert.equal(SPOKE6.get(who).learnedAt, 0, `${who}'s history was stamped as speech`);
  }
  /* 🔑 AND THE STORED `at` MUST BE THE ROW'S OWN, or the next poll's dedup
     compares against the wrong value. Freezing what gets written - rather than
     what gets compared, which round 3 pinned - survived the full suite and
     re-stamps a speaker forever. */
  assert.equal(SPOKE6.get('kai').at, Date.parse(at(2000)),
    'the stored timestamp is not the row it came from, so the next dedup compares the wrong value');
  /* AN OLD ROW AT THE HEAD MUST NOT ABORT THE SCAN BEHIND IT (continue, not break). */
  CLOCK.t += 3000;
  seed('room-g', [
    { from: 'ivy', at: at(0), text: 'unchanged, must be skipped' },
    { from: 'jo', at: at(90000), text: 'genuinely new' },
  ], SEEN6, SPOKE6, seedRuns, OK, FakeDate);
  assert.equal(SPOKE6.get('ivy').learnedAt, 0, 'an unchanged row was re-stamped');
  assert.ok(SPOKE6.get('jo').learnedAt > 0,
    'a new row behind an old one was never reached, so the scan aborted instead of skipping');
  /* 🔑 AND THE STORED `at` MUST ADVANCE IN A SEEDED ROOM. My first assertion of
     this was on the FIRST paint, where `seededRoom` is false - so a mutation
     that freezes the stored value only when the room IS seeded slipped straight
     past it. Round 3 pinned the value the dedup COMPARES; this pins the value it
     WRITES for the next comparison. Frozen, a speaker passes `at <= seen.at`
     on every poll thereafter, is re-stamped forever, and drops out of the
     working line permanently. */
  assert.equal(SPOKE6.get('jo').at, Date.parse(at(90000)),
    'the stored timestamp did not advance in a seeded room, so this speaker is re-stamped forever');

  /* 🛑 RETURNING TO A ROOM ALREADY SEEDED. Every arm walked FORWARD only, so
     `ROOM_SPOKE_SEEDED.clear()` before the add left the suite green - the
     page-wide boolean wearing the fix's clothes, remembering the LAST room
     instead of the FIRST. */
  seed('room-h', [{ from: 'lena', at: at(0), text: 'other room' }], SEEN6, SPOKE6, seedRuns, OK, FakeDate);
  CLOCK.t += 3000;
  seed('room-g', [{ from: 'mo', at: at(120000), text: 'posted while you were away' }], SEEN6, SPOKE6, seedRuns, OK, FakeDate);
  assert.ok(SPOKE6.get('mo').learnedAt > 0,
    'a post in a room already seeded was treated as history, so the room was forgotten on leaving');

  /* 🛑 THE STAMP MUST COME FROM THIS PAGE'S CLOCK, NEVER THE SERVER'S TIME.
     `web/index.html` states this in prose and a sibling test asserts it - on the
     READER. The WRITER, which is the half that produces the stamp, was
     unguarded, so taking `at` (the record's own timestamp) instead of
     `Date.now()` survived the full suite. `learnedAt` means WHEN THIS PAGE
     LEARNED of the post; `m.at` means when it was posted, and the two differ by
     the delivery delay. */
  assert.notEqual(SPOKE6.get('mo').learnedAt, Date.parse(at(120000)),
    'the stamp was taken from the server time rather than this page clock');
  assert.equal(SPOKE6.get('mo').learnedAt, CLOCK.t,
    'the stamp is not this page clock');

  /* 🛑 A FIRST PAINT THAT CARRIED NO RECORD MUST NOT MARK THE ROOM SEEDED.
     `engine/messages.js` returns `{ ok: false, rows: [] }` on a read failure of
     the message log and the route sends it at HTTP 200, so this paints. If the
     room is marked seeded on that empty paint, the REAL backlog arrives next
     poll into a room believed already seeded and every member is stamped as
     having just spoken - which blanks the working line, the exact thing the
     guard exists to prevent. */
  const SEEN3 = new Set();
  const SPOKE3 = new Map();
  seed('room-d', [], SEEN3, SPOKE3, seedRuns, { ok: false }, FakeDate);
  assert.equal(SEEN3.has('room-d'), false,
    'a paint that carried no record still marked the room seeded');
  seed('room-d', [{ from: 'yuki', at: at(0), text: 'the real backlog' }], SEEN3, SPOKE3, seedRuns, OK, FakeDate);
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
