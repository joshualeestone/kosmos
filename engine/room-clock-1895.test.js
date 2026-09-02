'use strict';

/**
 * #1895: the `kosmos room` TEXT view showed UTC and named no zone, and a room
 * post rendered with no recipient at all.
 *
 * The card's own bar: it is not done when a helper returns a string, it is done
 * when the line an AGENT reads changes. The page was always right (it formats
 * with toLocaleTimeString); the text view cut characters 11-15 out of the stored
 * ISO string, so the two surfaces showed the same post a whole UTC offset apart
 * and neither said which was which. The surface that was wrong is the one a
 * machine reads and then quotes back to a person.
 *
 * So both assertions below are made against the EXACT expressions server.js
 * composes for a room line, not against roomClock in isolation.
 *
 *   node --test engine/room-clock-1895.test.js
 */

const os = require('node:os');
const path = require('node:path');

// ⚠️ Sandbox the data root BEFORE requiring store, exactly as the sibling
// suites do: nothing here writes, but requiring store unsandboxed points the
// module at the operator's real record and a later edit would inherit that.
const SANDBOX = path.join(os.tmpdir(), 'kosmos-room-1895-test-' + process.pid);
process.env.AGENT_WORKFORCE_DATA = SANDBOX;

const test = require('node:test');
const assert = require('node:assert/strict');

const messages = require('./messages');

/* The instant from the original report: 14:50:17 Central, stored as UTC. The
   text view rendered this as "19:50", which is what the bug looked like. */
const AT = '2026-09-02T19:50:17.326Z';

/** The line server.js composes for a post, byte for byte (server.js ~6959). */
function postLine(m, zone) {
  const when = messages.roomClock(m.at, zone);
  const who = m.operator ? 'operator' : m.from;
  return when + '  ' + who + ' -> '
    + (Array.isArray(m.to) && m.to.length ? m.to.join(', ') : 'the room')
    + ': ' + String(m.text || '');
}

test('the clock is the operator\'s zone, not UTC', () => {
  assert.equal(messages.roomClock(AT, 'America/Chicago'), '14:50');
  assert.equal(messages.roomClock(AT, 'Asia/Tokyo'), '04:50');
  /* The regression itself: the stored string's own characters 11-15. If this
     ever passes again the slice is back. */
  assert.notEqual(messages.roomClock(AT, 'America/Chicago'), AT.slice(11, 16));
});

test('a stale or unknown zone id keeps the time rather than dropping it', () => {
  /* Deliberately NOT the '' that operatorNowLabel returns for a bad id. Losing
     every timestamp in a room because one setting went stale is worse than
     showing them in the board's own zone. */
  const out = messages.roomClock(AT, 'Not/AZone');
  assert.match(out, /^\d{2}:\d{2}$/);
});

test('midnight is 00:00, never 24:00', () => {
  assert.equal(messages.roomClock('2026-09-03T05:00:00.000Z', 'America/Chicago'), '00:00');
});

test('an unreadable instant degrades to the placeholder, and never throws', () => {
  assert.equal(messages.roomClock(null, 'America/Chicago'), '--:--');
  assert.equal(messages.roomClock('nonsense', 'America/Chicago'), '--:--');
  assert.equal(messages.roomClock(undefined, null), '--:--');
});

test('a room post names the room instead of nobody', () => {
  /* A post to a room stores `to: []`. `Array.isArray([])` is true, so the old
     test took the join branch and produced the empty string -- the one case
     the words "the room" were written for was the one case that could not
     reach them. */
  const line = postLine({ at: AT, from: 'splinter2', to: [], text: 'hello' }, 'America/Chicago');
  assert.equal(line, '14:50  splinter2 -> the room: hello');
  assert.ok(!line.includes(' -> :'), 'the arrow must never point at nothing');
});

test('an addressed message still names its recipients', () => {
  const one = postLine({ at: AT, from: 'you', to: ['splinter2'], operator: true, text: 'Hola' }, 'America/Chicago');
  assert.equal(one, '14:50  operator -> splinter2: Hola');

  const many = postLine({ at: AT, from: 'splinter2', to: ['a', 'b'], text: 'hi' }, 'America/Chicago');
  assert.equal(many, '14:50  splinter2 -> a, b: hi');
});

test('a missing or malformed `to` still falls back to the room', () => {
  assert.match(postLine({ at: AT, from: 'x', text: 'y' }, null), / -> the room: y$/);
  assert.match(postLine({ at: AT, from: 'x', to: null, text: 'y' }, null), / -> the room: y$/);
});
