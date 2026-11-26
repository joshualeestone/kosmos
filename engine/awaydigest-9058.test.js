'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
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

test('kosmos#9058 review 1: a /clear counts the session it is ending before that session\'s own stopped lands, never twice', () => {
  // The third /clear: its stopped is sent in the background and has not landed, so the ending session is open.
  const racing = [WAIT, row('stopped', 'auto', 1), row('working', 'auto', 2), row('idle', 'auto', 3), row('stopped', 'auto', 4),
    row('working', 'auto', 5), row('idle', 'auto', 6)];
  assert.equal(away.sessionsSinceWait(racing, WAIT.at), 1, 'CONTROL: without endingNow the open session is not counted');
  assert.equal(away.sessionsSinceWait(racing, WAIT.at, { endingNow: true }), 2);
  // Once that stopped lands, the open session is the new, empty one: the same count, not one more.
  const landed = racing.concat([row('stopped', 'auto', 7)]);
  assert.equal(away.sessionsSinceWait(landed, WAIT.at), 2);
  assert.equal(away.sessionsSinceWait(landed, WAIT.at, { endingNow: true }), 2);
});

test('kosmos#9058 review 4: a started closes a worked session as a stopped does (a crash leaves no stopped)', () => {
  const h = [WAIT, row('started', 'auto', 1), row('working', 'auto', 2), row('started', 'auto', 3), row('idle', 'auto', 4), row('started', 'auto', 5)];
  assert.equal(away.sessionsSinceWait(h, WAIT.at), 2);
  // the open session before a startup's own started lands (the Mac asks first): counted only with endingNow.
  const open = h.slice(0, 5);
  assert.equal(away.sessionsSinceWait(open, WAIT.at), 1);
  assert.equal(away.sessionsSinceWait(open, WAIT.at, { endingNow: true }), 2);
});

test('kosmos#9058 review 5: a crash relaunched with --resume (no stopped, no started) ends the session by its new run instance', () => {
  const r = (state, min, instance) => ({ state, by: 'auto', at: T0 + min * M, instance });
  // one clean quit, then crash, resume, crash, resume: before, every session after the stopped ran together (count 1).
  const h = [WAIT, r('stopped', 1, 'a'), r('working', 2, 'b'), r('idle', 3, 'b'), r('working', 4, 'c'), r('idle', 5, 'c')];
  assert.equal(away.sessionsSinceWait(h, WAIT.at), 1, 'run b ended when run c began');
  assert.equal(away.sessionsSinceWait(h, WAIT.at, { endingNow: true }), 2, 'and the resume now ends run c');
  // CONTROL: rows with no instance (older records) never split a session.
  const bare = h.map((x) => ({ ...x, instance: undefined }));
  assert.equal(away.sessionsSinceWait(bare, WAIT.at), 0);
  // a `started` that brings its new instance is one boundary, not two.
  const st = [WAIT, r('stopped', 1, 'a'), r('working', 2, 'b'), r('started', 3, 'c'), r('working', 4, 'c')];
  assert.equal(away.sessionsSinceWait(st, WAIT.at), 1);
});

test('kosmos#9058 review 6: the wait\'s own run is known, so a crash straight after it starts a session at the new run', () => {
  const r = (state, min, instance, by) => ({ state, by: by || 'auto', at: T0 + min * M, instance });
  const h = [r('needs_you', 0, 'a', 'agent'), r('working', 2, 'b'), r('idle', 3, 'b'), r('working', 4, 'c')];
  assert.equal(away.sessionsSinceWait(h, T0), 1, 'run b (after run a crashed with the wait standing) is a worked session');
});
