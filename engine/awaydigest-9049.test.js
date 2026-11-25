'use strict';
/**
 * kosmos#9049: the wait reminder for a session that went on after its SessionEnd (a /clear, a resume after a quit),
 * and the test for whether a session end set the wait aside.
 *
 *   node --test engine/awaydigest-9049.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const away = require('./awaydigest');

const W = { state: 'needs_you', atMs: Date.parse('2026-11-25T09:00:00Z') };

test('the ended wording says only that the board set the wait aside; the default keeps the startup wording', () => {
  const ended = away.waitText(W, { ended: true });
  assert.match(ended, /The board has since set that waiting report aside, so the board no longer shows it\./);
  assert.doesNotMatch(ended, /A new run replaces/);
  const plain = away.waitText(W);
  assert.match(plain, /A new run replaces a waiting report on the board, so the board no longer shows it\./);
  assert.doesNotMatch(plain, /has since set that waiting report aside/);
  // Everything else in the sentence is the same for both: the state, the time, and how to report it again.
  for (const t of [ended, plain]) {
    assert.match(t, /\(needs_you, at 2026-11-25T09:00:00Z\)/);
    assert.match(t, /kosmos report needs_you \.\.\./);
  }
  assert.equal(away.hookJson(null, W, { ended: true }), JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: ended } }));
  assert.equal(away.hookJson(null, null, { ended: true }), '', 'no wait, nothing to say');
});

test('endedAfter: a stopped recorded AFTER the wait, and no started after it', () => {
  const at = W.atMs;
  assert.equal(away.endedAfter([{ state: 'stopped', at: at + 1 }], at), true);
  assert.equal(away.endedAfter([{ state: 'stopped', at: at - 1 }], at), false, 'a stopped before the wait did not set it aside');
  assert.equal(away.endedAfter([{ state: 'stopped', at }], at), false, 'the same instant is not after');
  assert.equal(away.endedAfter([{ state: 'idle', at: at + 1 }, { state: 'working', at: at + 2 }], at), false);
  assert.equal(away.endedAfter(null, at), false);
  assert.equal(away.endedAfter([{ state: 'stopped', at: at + 1 }, { state: 'started', at: at + 2 }], at), false, 'a startup came in between and reminded already');
  assert.equal(away.endedAfter([{ state: 'started', at: at + 1 }, { state: 'stopped', at: at + 2 }], at), false, 'a started anywhere after the wait');
});
