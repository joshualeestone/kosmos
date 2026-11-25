'use strict';
/**
 * kosmos#9058: a wait is reminded at the first session end after it and once more, not at every /clear and resume for
 * 7 days (sessionsSinceWait, REMIND_SESSIONS), and the reminder says "no report of its own", which is what is true.
 *
 *   node --test engine/awaydigest-9058.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const away = require('./awaydigest');

const T0 = Date.parse('2026-11-25T09:00:00Z');
const M = 60 * 1000;
const row = (state, by, min) => ({ state, by, at: T0 + min * M });
const WAIT = row('needs_you', 'agent', 0);

test('kosmos#9058: the session the wait was raised in does not count; each later session with a turn that ended does', () => {
  // wait, turns in the same session, the first /clear: nothing counted yet, so it is reminded.
  const h1 = [WAIT, row('working', 'auto', 1), row('idle', 'auto', 2), row('stopped', 'auto', 3)];
  assert.equal(away.sessionsSinceWait(h1, WAIT.at), 0);
  // the agent works on after that reminder and /clears again: one session counted, under the limit, reminded once more.
  const h2 = h1.concat([row('working', 'auto', 4), row('idle', 'auto', 5), row('stopped', 'auto', 6)]);
  assert.equal(away.sessionsSinceWait(h2, WAIT.at), 1);
  assert.ok(away.sessionsSinceWait(h2, WAIT.at) < away.REMIND_SESSIONS);
  // and once more: two sessions it worked through, so it is not reminded again.
  const h3 = h2.concat([row('working', 'auto', 7), row('stopped', 'auto', 8)]);
  assert.equal(away.sessionsSinceWait(h3, WAIT.at), 2);
  assert.ok(away.sessionsSinceWait(h3, WAIT.at) >= away.REMIND_SESSIONS);
});

test('kosmos#9058: a session with no turn, or one still open, does not count; a startup session counts like a /clear', () => {
  // /clear, /clear again with no prompt between: nothing was worked through.
  assert.equal(away.sessionsSinceWait([WAIT, row('stopped', 'auto', 1), row('stopped', 'auto', 2), row('stopped', 'auto', 3)], WAIT.at), 0);
  // a session still open (no stopped after its turns) is not counted.
  assert.equal(away.sessionsSinceWait([WAIT, row('stopped', 'auto', 1), row('working', 'auto', 2)], WAIT.at), 0);
  // #9049's pinned case: quit, a startup that reminded, a turn, a quit: one session, so the next resume is reminded.
  assert.equal(away.sessionsSinceWait([WAIT, row('stopped', 'auto', 1), row('started', 'auto', 10), row('working', 'auto', 11), row('stopped', 'auto', 12)], WAIT.at), 1);
  // only automatic turns count: a turn the agent reported itself ends the wait in lastWait, never reaching here.
  assert.equal(away.sessionsSinceWait([WAIT, row('stopped', 'auto', 1), row('working', 'agent', 2), row('stopped', 'auto', 3)], WAIT.at), 0);
  // rows before the wait never count.
  assert.equal(away.sessionsSinceWait([row('stopped', 'auto', -9), row('working', 'auto', -8), row('stopped', 'auto', -7), WAIT], WAIT.at), 0);
  assert.equal(away.sessionsSinceWait(null, WAIT.at), 0);
});

test('kosmos#9058: the reminder says the agent made no report of its own, at a startup and after a session end', () => {
  const w = { state: 'needs_you', atMs: T0 };
  for (const t of [away.waitText(w), away.waitText(w, { ended: true })]) {
    assert.match(t, /and it has made no report of its own since\./);
    assert.doesNotMatch(t, /has not said otherwise/);
  }
});
