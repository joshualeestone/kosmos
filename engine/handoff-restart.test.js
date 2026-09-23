'use strict';

/**
 * #3492 restart-with-handoff pure core: the two prompts and the freshness gate.
 * The load-bearing behaviours:
 *  - the pre-restart prompt asks for the SAME handoff contract as the sweep, but
 *    tells the agent it is being restarted and NOT to keep working;
 *  - the pickup prompt points the fresh session at the handoff path;
 *  - handoffIsFresh returns true only on a real appearance or rewrite, and is
 *    conservative (false) whenever the evidence of a finished write is missing --
 *    because a false "fresh" is what would restart an agent and lose its context.
 *
 *   node --test engine/handoff-restart.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const hr = require('./handoff-restart');
const ah = require('./autohandoff');

const PATH = '/data/handoffs/angel.md';

test('handoffForRestartPrompt names the path and the handoff contract contents', () => {
  const p = hr.handoffForRestartPrompt(PATH);
  assert.match(p, /\/data\/handoffs\/angel\.md/);
  // The shared contract (autohandoff.HANDOFF_CONTENTS) is present, not a re-typed copy.
  for (const line of ah.HANDOFF_CONTENTS) {
    const bullet = line.replace(/^- /, '');
    assert.ok(p.includes(bullet), 'the prompt asks for: ' + bullet);
  }
  assert.match(p, /about to be restarted/);
  assert.match(p, /fresh session will read this handoff/);
  assert.match(p, /not into a message/, 'the path-not-message rule is carried over');
});

test('handoffForRestartPrompt INVERTS the sweep prompt: no fill %, and do NOT keep working', () => {
  const p = hr.handoffForRestartPrompt(PATH);
  /* 🛑 The fill-triggered prompt opens "Your context window is X% full" and closes
     "Keep working after this". A restart-triggered prompt must do NEITHER: the
     trigger is an explicit restart, and the agent must stop, or work started after
     the handoff is lost to the restart. These are the two assertions that would go
     red if someone reused autohandoff.handoffPrompt verbatim here. */
  assert.doesNotMatch(p, /% full/, 'a restart handoff has no context-fill percentage');
  assert.doesNotMatch(p, /Keep working after/, 'a restart handoff must not say keep working');
  assert.match(p, /do NOT keep\s+working after/i);
});

test('pickupPrompt points the fresh session at its handoff path', () => {
  const p = hr.pickupPrompt(PATH);
  assert.match(p, /\/data\/handoffs\/angel\.md/);
  assert.match(p, /just been?\s+restarted|were just restarted/i);
  assert.match(p, /[Rr]ead your handoff/);
});

test('neither prompt uses an em dash (house style, all spellings)', () => {
  for (const p of [hr.handoffForRestartPrompt(PATH), hr.pickupPrompt(PATH)]) {
    assert.doesNotMatch(p, /—/, 'no em dash char');
    assert.doesNotMatch(p, /&mdash;|&#8212;|&#x2014;/i, 'no em dash entity');
  }
});

test('handoffIsFresh: true only on a real appearance or a rewrite', () => {
  // appeared (did not exist before, exists now)
  assert.equal(hr.handoffIsFresh({ exists: false, mtimeMs: null }, { exists: true, mtimeMs: 100 }), true);
  // rewritten (mtime advanced)
  assert.equal(hr.handoffIsFresh({ exists: true, mtimeMs: 100 }, { exists: true, mtimeMs: 200 }), true);
});

test('handoffIsFresh: false when nothing changed or nothing was written', () => {
  // 🛑 The dangerous direction: an UNCHANGED mtime must NOT read fresh, or a
  // restart would proceed on a handoff the agent never (re)wrote.
  assert.equal(hr.handoffIsFresh({ exists: true, mtimeMs: 100 }, { exists: true, mtimeMs: 100 }), false, 'same mtime: not fresh');
  assert.equal(hr.handoffIsFresh({ exists: true, mtimeMs: 200 }, { exists: true, mtimeMs: 100 }), false, 'older mtime: not fresh');
  // still absent
  assert.equal(hr.handoffIsFresh({ exists: false, mtimeMs: null }, { exists: false, mtimeMs: null }), false, 'never written: not fresh');
  // existed before, but its time now is unreadable -> conservative false (no evidence of a NEW write)
  assert.equal(hr.handoffIsFresh({ exists: true, mtimeMs: 100 }, { exists: true, mtimeMs: null }), false, 'existed before, null time now: not fresh');
  assert.equal(hr.handoffIsFresh({ exists: true, mtimeMs: 100 }, { exists: true, mtimeMs: NaN }), false, 'existed before, NaN time now: not fresh');
});

test('handoffIsFresh: existed with an unreadable time before, finite time now => fresh', () => {
  // A prior unreadable mtime is not evidence, so a finite one now IS a write.
  assert.equal(hr.handoffIsFresh({ exists: true, mtimeMs: null }, { exists: true, mtimeMs: 100 }), true);
});

test('handoffIsFresh: tolerates missing/garbage snapshots without throwing', () => {
  assert.equal(hr.handoffIsFresh(null, null), false);
  assert.equal(hr.handoffIsFresh(undefined, { exists: true, mtimeMs: 5 }), true, 'no baseline, file present => appeared');
  assert.equal(hr.handoffIsFresh({ exists: true, mtimeMs: 5 }, undefined), false);
});
