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
  const note = roomloop.readerNote('p', now);
  assert.match(note, /^\[kosmos\] Agents waking each other is paused in this room until about /);
  assert.match(note, /will wake no one/);
  assert.match(note, /exactly one member may still get through: 10 more in this pause/);
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
  assert.notEqual(roomloop.freesAt('p', now + HOUR + 1), now + HOUR + 1, 'the read cleared the expired pause itself');
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
