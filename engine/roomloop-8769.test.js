'use strict';

/**
 * kosmos#8769 item 3: a room whose agent wake-ups are paused says so to the agent READING it, before it posts, not only
 * in the answer to a post already sent (#8535). roomloop.readerNote gives the line; it only reads, so a read never starts,
 * ends or moves a pause.
 *
 *   node --test engine/roomloop-8769.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const roomloop = require('./roomloop');

const HOUR = roomloop.LOOP_WINDOW_MS;

test.beforeEach(() => { roomloop.resetForTests(); roomloop.setCapForTests(3); });
test.after(() => roomloop.resetForTests());

test('nothing is said while a broad post would wake as usual (CONTROL), nor below the cap', () => {
  const now = 1_000_000_000_000;
  assert.equal(roomloop.readerNote('p', now), '');
  roomloop.noteWake('p', now - 10); roomloop.noteWake('p', now - 5);
  assert.equal(roomloop.readerNote('p', now), '', 'two wakes under a cap of three read as paused');
});

test('a count at the cap is said before any post starts the pause, and the read does not start it', () => {
  const now = 1_000_000_000_000;
  for (const d of [30, 20, 10]) roomloop.noteWake('p', now - d);
  const seen = [];
  const note = roomloop.readerNote('p', now, (ms) => { seen.push(ms); return 'T' + seen.length; });
  assert.match(note, /^\[kosmos\] Agents waking each other is at its limit in this room /);
  // Review 2: the next post is paused ITSELF (it is the one that starts the pause), and only until the count drops: the
  // oldest of the three wakes (now - 30) ages out at now - 30 + an hour.
  assert.deepEqual(seen, [now - 30 + HOUR], 'not the moment the count drops below the cap');
  assert.match(note, /An agent post made before about T1 starts a pause of an hour and is under it/);
  assert.doesNotMatch(note, /is paused itself/, 'a one-member post still gets through, so it is not paused itself');
  assert.match(note, /a post that asks more than one member wakes no one/);
  assert.match(note, /exactly one member may still get through \(10 in the pause, at most 3/);
  assert.doesNotMatch(note, /After that/, 'reads as "after my own next post"');
  assert.match(note, /Your person's post here starts the count over\.$/, 'at the cap there is no pause to end');
  // Above the cap, the moment is when enough have aged out to leave the count below it.
  roomloop.noteWake('p', now - 1);
  const seen2 = [];
  roomloop.readerNote('p', now, (ms) => { seen2.push(ms); return 'x'; });
  assert.deepEqual(seen2, [now - 20 + HOUR], 'four wakes over a cap of three drop below it when the second oldest ages out');
  assert.equal(roomloop.freesAt('p', now + 5), now + 5, 'the read started the pause (freesAt moved off "no pause")');
  // The next agent post starts it, at its own time, not the read's.
  assert.equal(roomloop.paused('p', now + 60_000), true);
  assert.equal(roomloop.freesAt('p', now + 60_000), now + 60_000 + HOUR);
});

test('during a pause: said with what is left of the one-member allowance; used up says so; a pause that ran out is not said and not ended by the read', () => {
  const now = 1_000_000_000_000;
  for (const d of [30, 20, 10]) roomloop.noteWake('p', now - d);
  assert.equal(roomloop.paused('p', now), true);
  roomloop.pairTake('p', 'ann', 'bo');
  assert.match(roomloop.readerNote('p', now + 1000), /9 more in this pause, at most 3 to the same member from you/);
  for (let i = 0; i < 9; i++) roomloop.pairTake('p', 'ann', 'x' + i);
  const spent = roomloop.readerNote('p', now + 2000);
  assert.match(spent, /posts to exactly one member that may get through during this pause are used up/);
  assert.doesNotMatch(spent, /more in this pause/);
  // Past the window: nothing said, and the read leaves the record for paused() to clear (it changes nothing).
  assert.equal(roomloop.readerNote('p', now + HOUR + 1), '');
  assert.notEqual(roomloop.freesAt('p', now + HOUR + 1), now + HOUR + 1, 'the read cleared the expired record (it must leave that to paused())');
});

test('a person\'s post ends it, and the line goes with it', () => {
  const now = 1_000_000_000_000;
  for (const d of [30, 20, 10]) roomloop.noteWake('p', now - d);
  roomloop.paused('p', now);
  assert.notEqual(roomloop.readerNote('p', now + 1), '');
  roomloop.clear('p');
  assert.equal(roomloop.readerNote('p', now + 2), '');
});

test('per project: a paused room says nothing about another', () => {
  const now = 1_000_000_000_000;
  for (const d of [30, 20, 10]) roomloop.noteWake('a', now - d);
  roomloop.paused('a', now);
  assert.notEqual(roomloop.readerNote('a', now + 1), '');
  assert.equal(roomloop.readerNote('b', now + 1), '');
});

test('review 1: during a pause it says "paused", and the time is written by the caller\'s clock when given', () => {
  const now = 1_000_000_000_000;
  for (const d of [30, 20, 10]) roomloop.noteWake('p', now - d);
  roomloop.paused('p', now);
  const seen = [];
  const note = roomloop.readerNote('p', now + 1, (ms) => { seen.push(ms); return '17:42'; });
  assert.deepEqual(seen, [now + HOUR], 'the clock was not given the pause\'s end');
  assert.match(note, /^\[kosmos\] Agents waking each other is paused in this room until about 17:42 /);
  assert.match(note, /A post that asks more than one member will wake no one\./);
  assert.doesNotMatch(note, /@all/, '@all can get through in a room of two');
  // A clock that throws or answers nothing falls back to the board's own time, never an empty time.
  assert.match(roomloop.readerNote('p', now + 1, () => { throw new Error('x'); }), /until about \S/);
  assert.match(note, /Your person's post here ends the pause\.$/);
  // Review 3: a clock answering something that is not a string falls back too, never "undefined" or "null".
  for (const odd of [undefined, null, 1742]) {
    const n = roomloop.readerNote('p', now + 1, () => odd);
    assert.doesNotMatch(n, /until about (undefined|null|1742) /, String(odd));
  }
});

test('review 4: a cap of 0 with no wake says nothing (never "Invalid Date"); wakes out of order still name the right moment', () => {
  const now = 1_000_000_000_000;
  roomloop.setCapForTests(0);
  assert.equal(roomloop.readerNote('p', now), '');
  roomloop.setCapForTests(2);
  // A wall clock stepped back: the later wake is recorded first.
  roomloop.noteWake('q', now - 10); roomloop.noteWake('q', now - 40); roomloop.noteWake('q', now - 20);
  const seen = [];
  roomloop.readerNote('q', now, (ms) => { seen.push(ms); return 'x'; });
  assert.deepEqual(seen, [now - 20 + HOUR], 'three wakes over a cap of two drop below it when the two oldest (-40, -20) have aged out');
});
