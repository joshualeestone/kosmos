'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeKeep, SLOW_ROUND_MS, CALM_ROUNDS, MAX_AGE_MS } = require('./capturekeep');

function rig({ blockingMs = 0 } = {}) {
  const r = { t: 1000, blockingCalls: 0, pending: [], blockingMs, screen: 'one' };
  r.keep = makeKeep({
    now: () => r.t,
    blocking: () => { r.blockingCalls += 1; r.t += r.blockingMs; return r.screen; },
    background: (target, lines, done) => { r.pending.push(done); },
  });
  r.round = (panes = ['a', 'b']) => {
    r.keep.begin();
    const out = panes.map((p) => r.keep.read(p, 40));
    r.keep.end();
    return out;
  };
  r.finishBackground = (text) => { const p = r.pending; r.pending = []; p.forEach((d) => d(text)); };
  return r;
}

test('a quick computer: every read is the blocking capture and nothing runs in the background', () => {
  const r = rig({ blockingMs: 10 });
  r.round(); r.round();
  assert.equal(r.blockingCalls, 4);
  assert.equal(r.pending.length, 0);
  assert.equal(r.keep.isSlow(), false);
});

test('CONTROL for the test above: a slow round does start the background captures', () => {
  const r = rig({ blockingMs: SLOW_ROUND_MS });
  r.round();
  assert.equal(r.keep.isSlow(), true);
  assert.equal(r.pending.length, 2);
});

test('after a slow round the next round reads kept text with no blocking call', () => {
  const r = rig({ blockingMs: SLOW_ROUND_MS });
  r.round();
  const before = r.blockingCalls;
  r.finishBackground('two');
  assert.deepEqual(r.round(), ['two', 'two']);
  assert.equal(r.blockingCalls, before);
});

test('kept text past its age is not used: the read blocks', () => {
  const r = rig({ blockingMs: SLOW_ROUND_MS });
  r.round();
  r.finishBackground(null);   // the background look failed, so the text does not get newer
  r.t += MAX_AGE_MS + 1;
  r.screen = 'three';
  assert.deepEqual(r.round(['a']), ['three']);
});

test('a pane with no kept text blocks, even when slow', () => {
  const r = rig({ blockingMs: SLOW_ROUND_MS });
  r.round(['a']);
  const before = r.blockingCalls;
  r.finishBackground('two');
  r.round(['a', 'new']);
  assert.equal(r.blockingCalls, before + 1);
});

test('quick background rounds go back to live reads', () => {
  const r = rig({ blockingMs: SLOW_ROUND_MS });
  r.round();
  r.blockingMs = 0;
  for (let i = 0; i < CALM_ROUNDS; i += 1) { r.finishBackground('kept'); if (i < CALM_ROUNDS - 1) r.round(); }
  assert.equal(r.keep.isSlow(), false);
  const before = r.blockingCalls;
  r.round();
  assert.equal(r.blockingCalls, before + 2);
});

test('a slow background round does not count as calm', () => {
  const r = rig({ blockingMs: SLOW_ROUND_MS });
  r.round();
  for (let i = 0; i < CALM_ROUNDS + 1; i += 1) { r.t += SLOW_ROUND_MS; r.finishBackground('kept'); r.round(); }
  assert.equal(r.keep.isSlow(), true);
});

test('only one background round at a time', () => {
  const r = rig({ blockingMs: SLOW_ROUND_MS });
  r.round();
  const first = r.pending.length;
  r.round();
  assert.equal(r.pending.length, first);
});

test('a background capture that throws does not stick the rounds', () => {
  let t = 0, calls = 0;
  const keep = makeKeep({ now: () => t, blocking: () => { t += SLOW_ROUND_MS; return 'x'; }, background: () => { calls += 1; throw new Error('no tmux'); } });
  for (let i = 0; i < 2; i += 1) { keep.begin(); keep.read('a', 40); keep.end(); }
  assert.ok(calls >= 2);
});

test('a null capture keeps nothing, so a gone pane does not read as its old text', () => {
  const r = rig({ blockingMs: SLOW_ROUND_MS });
  r.round(['a']);
  r.keep.begin(); r.t += MAX_AGE_MS + 1; r.screen = null;
  assert.equal(r.keep.read('a', 40), null);
  r.keep.end();
  r.screen = 'back';
  r.keep.begin();
  assert.equal(r.keep.read('a', 40), 'back');
  r.keep.end();
});

test('forgetExcept drops panes not asked for this round', () => {
  const r = rig({ blockingMs: SLOW_ROUND_MS });
  r.round(['a', 'b']);
  r.finishBackground('kept');
  r.round(['a']);
  r.keep.forgetExcept();
  const before = r.blockingCalls;
  r.round(['a', 'b']);
  assert.equal(r.blockingCalls, before + 1);
});

test('only the captures count: a round slow for other reasons stays live', () => {
  const r = rig({ blockingMs: 1 });
  r.keep.begin(); r.keep.read('a', 40); r.t += SLOW_ROUND_MS * 5; r.keep.end();
  assert.equal(r.keep.isSlow(), false);
  assert.equal(r.pending.length, 0);
});
