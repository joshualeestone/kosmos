'use strict';
/* #6071 (#5154 slice D, increment D1): engine/toolloop.js counts the SAME failed tool call repeating inside one turn.
 *   node --test engine/toolloop-6071.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-toolloop-6071-'));
process.env.AGENT_WORKFORCE_DATA = SB;
const store = require('./store');
const toolloop = require('./toolloop');
test.after(() => { try { fs.rmSync(SB, { recursive: true, force: true }); } catch { /* best effort */ } });

const SIG_A = 'a'.repeat(64);
const SIG_B = 'b'.repeat(64);
const none = () => [];   // a self-report record with no turn end in it

test('the store is the sandbox', () => {
  assert.ok(store.ROOT.startsWith(SB), store.ROOT);
});

test('the same failure counts up, and the run is looping from LOOP_AT on, reached exactly once', () => {
  toolloop.forget('agent-a');
  const seen = [];
  for (let i = 1; i <= toolloop.LOOP_AT + 2; i++) {
    seen.push(toolloop.noteFailure('agent-a', { tool: 'Bash', sig: SIG_A, error: 'Exit code 2' }, { now: 1000 + i, history: none }));
  }
  assert.deepEqual(seen.map((r) => r.count), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(seen.map((r) => r.looping), [false, false, false, false, true, true, true]);
  assert.deepEqual(seen.filter((r) => r.reached).map((r) => r.count), [toolloop.LOOP_AT], 'reached only on the call that hits the threshold');
  const p = toolloop.peek('agent-a', { history: none });
  assert.equal(p.looping, true);
  assert.equal(p.count, 7);
  assert.equal(p.tool, 'Bash');
  assert.equal(p.error, 'Exit code 2');
  assert.equal(p.firstAt, 1001);
  assert.equal(p.turnOver, false);
});

test('a different failure starts a new run, so a retry that changes its input never adds up', () => {
  toolloop.forget('agent-b');
  for (let i = 0; i < 4; i++) toolloop.noteFailure('agent-b', { tool: 'Bash', sig: SIG_A }, { now: 2000 + i, history: none });
  const r = toolloop.noteFailure('agent-b', { tool: 'Bash', sig: SIG_B }, { now: 2010, history: none });
  assert.equal(r.count, 1);
  assert.equal(r.looping, false);
  const back = toolloop.noteFailure('agent-b', { tool: 'Bash', sig: SIG_A }, { now: 2011, history: none });
  assert.equal(back.count, 1, 'only CONSECUTIVE failures with one signature count');
});

test('a turn that ended after the last failure starts a new run', () => {
  toolloop.forget('agent-c');
  for (let i = 0; i < 4; i++) toolloop.noteFailure('agent-c', { tool: 'Bash', sig: SIG_A }, { now: 3000 + i, history: none });
  const ended = () => [{ state: 'working', at: 3001 }, { state: 'idle', at: 3500 }];
  assert.equal(toolloop.peek('agent-c', { history: ended }).turnOver, true, 'the run says its turn is over');
  const r = toolloop.noteFailure('agent-c', { tool: 'Bash', sig: SIG_A }, { now: 4000, history: ended });
  assert.equal(r.count, 1, 'the same failure in the NEXT turn is a new run');
});

test('a turn end BEFORE the run, or a working report during it, does not split it', () => {
  toolloop.forget('agent-d');
  const h = () => [{ state: 'idle', at: 100 }, { state: 'working', at: 5002 }];
  let r;
  for (let i = 0; i < 3; i++) r = toolloop.noteFailure('agent-d', { tool: 'Read', sig: SIG_A }, { now: 5000 + i * 10, history: h });
  assert.equal(r.count, 3);
});

test('stopped and started end a run too; an unreadable self-report record never splits one', () => {
  for (const state of ['stopped', 'started']) {
    toolloop.forget('agent-e');
    toolloop.noteFailure('agent-e', { tool: 'Bash', sig: SIG_A }, { now: 6000, history: none });
    assert.equal(toolloop.noteFailure('agent-e', { tool: 'Bash', sig: SIG_A }, { now: 6100, history: () => [{ state, at: 6050 }] }).count, 1, state);
  }
  toolloop.forget('agent-e');
  toolloop.noteFailure('agent-e', { tool: 'Bash', sig: SIG_A }, { now: 7000, history: () => null });
  assert.equal(toolloop.noteFailure('agent-e', { tool: 'Bash', sig: SIG_A }, { now: 7001, history: () => { throw new Error('x'); } }).count, 2);
});

test('a signature that is not hex, or no agent, is refused and writes nothing', () => {
  toolloop.forget('agent-f');
  for (const sig of ['', 'short', 'g'.repeat(64), '../../etc', SIG_A + '\n']) {
    const r = toolloop.noteFailure('agent-f', { tool: 'Bash', sig }, { history: none });
    assert.equal(r.ok, false, JSON.stringify(sig));
  }
  assert.equal(toolloop.peek('agent-f', { history: none }), null);
  assert.equal(toolloop.noteFailure('', { tool: 'Bash', sig: SIG_A }).ok, false);
});

test('the tool and the error are kept short and on one line', () => {
  toolloop.forget('agent-g');
  toolloop.noteFailure('agent-g', { tool: 'Ba\nsh\u0007' + 'x'.repeat(200), sig: SIG_A, error: 'line one\u0000\r\n' + 'y'.repeat(500) }, { history: none });
  const p = toolloop.peek('agent-g', { history: none });
  assert.ok(!/[\u0000-\u001f]/.test(p.tool + p.error));
  assert.ok(p.tool.length <= 80 && p.error.length <= 300);
  assert.ok(p.tool.startsWith('Ba sh'));
});

test('forget drops the run; a malformed record reads as no run and is replaced on the next failure', () => {
  toolloop.noteFailure('agent-h', { tool: 'Bash', sig: SIG_A }, { history: none });
  toolloop.forget('agent-h');
  assert.equal(toolloop.peek('agent-h', { history: none }), null);
  const file = path.join(store.ROOT, 'toolloop', store.safeKey('agent-h') + '.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{ not json');
  assert.equal(toolloop.peek('agent-h', { history: none }), null);
  assert.equal(toolloop.noteFailure('agent-h', { tool: 'Bash', sig: SIG_A }, { history: none }).count, 1);
});
