'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/**
 * kosmos#9049: the wait reminder for a session that went on after its SessionEnd (a /clear, a resume after a quit),
 * and the newest session event after a wait (sessionAfter).
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
  assert.match(ended, /if not, report what it is doing \(kosmos report working \.\.\.\) so Kosmos stops reminding it\.$/);
  assert.match(away.waitText(W), /if not, there is nothing to do\.$/, 'the startup wording is unchanged (#8634)');
  const plain = away.waitText(W);
  assert.match(plain, /A new run replaces a waiting report on the board, so the board no longer shows it\./);
  assert.doesNotMatch(plain, /has since set that waiting report aside/);
  // Everything else in the sentence is the same for both: the state, the time, and how to report it again.
  for (const t of [ended, plain]) {
    assert.match(t, /\(needs_you, at 2026-11-25T09:00:00Z\)/);
    assert.match(t, /kosmos report needs_you \.\.\./);
  }
  const held = away.waitText({ ...W, held: true }, { ended: true });
  assert.match(held, /kosmos report needs_you --held \.\.\., held as before, so nothing buzzes the person\); if not, report what it is doing/);
  assert.equal(away.hookJson(null, W, { ended: true }), JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: ended } }));
  assert.equal(away.hookJson(null, null, { ended: true }), '', 'no wait, nothing to say');
});

test('sessionAfter: the newest stopped or started after the wait, or null', () => {
  const at = W.atMs;
  assert.equal(away.sessionAfter([{ state: 'stopped', at: at + 1 }], at), 'stopped');
  assert.equal(away.sessionAfter([{ state: 'stopped', at: at - 1 }], at), null, 'a stopped before the wait does not count');
  assert.equal(away.sessionAfter([{ state: 'stopped', at }], at), null, 'the same instant is not after');
  assert.equal(away.sessionAfter([{ state: 'idle', at: at + 1 }, { state: 'working', at: at + 2 }], at), null, 'other states are not session events');
  assert.equal(away.sessionAfter([{ state: 'stopped', at: at + 1 }, { state: 'started', at: at + 2 }], at), 'started', 'the newest wins');
  assert.equal(away.sessionAfter([{ state: 'started', at: at + 1 }, { state: 'stopped', at: at + 2 }, { state: 'working', at: at + 3 }], at), 'stopped');
  assert.equal(away.sessionAfter(null, at), null);
});
