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

test('the store is the sandbox', () => {
  assert.ok(store.ROOT.startsWith(SB), store.ROOT);
});

test('the same failure counts up, and the run is looping from LOOP_AT on, reached exactly once', () => {
  toolloop.forget('agent-a');
  const seen = [];
  for (let i = 1; i <= toolloop.LOOP_AT + 2; i++) {
    seen.push(toolloop.noteFailure('agent-a', { tool: 'Bash', sig: SIG_A, error: 'Exit code 2' }, { now: 1000 + i }));
  }
  assert.deepEqual(seen.map((r) => r.count), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(seen.map((r) => r.looping), [false, false, false, false, true, true, true]);
  assert.deepEqual(seen.filter((r) => r.reached).map((r) => r.count), [toolloop.LOOP_AT], 'reached only on the call that hits the threshold');
  const p = toolloop.peek('agent-a');
  assert.equal(p.looping, true);
  assert.equal(p.count, 7);
  assert.equal(p.tool, 'Bash');
  assert.equal(p.error, 'Exit code 2');
  assert.equal(p.firstAt, 1001);
  assert.equal(p.turnOver, false);
});

test('a different failure starts a new run, so a retry that changes its input never adds up', () => {
  toolloop.forget('agent-b');
  for (let i = 0; i < 4; i++) toolloop.noteFailure('agent-b', { tool: 'Bash', sig: SIG_A }, { now: 2000 + i });
  const r = toolloop.noteFailure('agent-b', { tool: 'Bash', sig: SIG_B }, { now: 2010 });
  assert.equal(r.count, 1);
  assert.equal(r.looping, false);
  const back = toolloop.noteFailure('agent-b', { tool: 'Bash', sig: SIG_A }, { now: 2011 });
  assert.equal(back.count, 1, 'only CONSECUTIVE failures with one signature count');
});

test('a turn end after the last failure starts a new run, and the run says its turn is over', () => {
  toolloop.forget('agent-c');
  for (let i = 0; i < 4; i++) toolloop.noteFailure('agent-c', { tool: 'Bash', sig: SIG_A }, { now: 3000 + i });
  assert.equal(toolloop.peek('agent-c').turnOver, false);
  assert.equal(toolloop.noteTurnEnd('agent-c', { now: 3500 }), true);
  assert.equal(toolloop.peek('agent-c').turnOver, true);
  assert.equal(toolloop.peek('agent-c').count, 4, 'the finished run is still what happened');
  assert.equal(toolloop.noteTurnEnd('agent-c', { now: 3600 }), false, 'a second turn end writes nothing');
  const r = toolloop.noteFailure('agent-c', { tool: 'Bash', sig: SIG_A }, { now: 4000 });
  assert.equal(r.count, 1, 'the same failure in the NEXT turn is a new run');
  assert.equal(toolloop.peek('agent-c').turnOver, false);
});

test('a turn end with no run writes nothing', () => {
  toolloop.forget('agent-d');
  assert.equal(toolloop.noteTurnEnd('agent-d'), false);
  assert.equal(toolloop.peek('agent-d'), null);
  assert.equal(toolloop.noteTurnEnd(''), false);
});

test('a signature that is not hex, or no agent, is refused and writes nothing', () => {
  toolloop.forget('agent-f');
  for (const sig of ['', 'short', 'g'.repeat(64), '../../etc', SIG_A + '\n']) {
    const r = toolloop.noteFailure('agent-f', { tool: 'Bash', sig });
    assert.equal(r.ok, false, JSON.stringify(sig));
  }
  assert.equal(toolloop.peek('agent-f'), null);
  assert.equal(toolloop.noteFailure('', { tool: 'Bash', sig: SIG_A }).ok, false);
});

test('the tool and the error are kept short and on one line', () => {
  toolloop.forget('agent-g');
  toolloop.noteFailure('agent-g', { tool: 'Ba\nsh\u0007' + 'x'.repeat(200), sig: SIG_A, error: 'line one\u0000\r\n' + 'y'.repeat(500) });
  const p = toolloop.peek('agent-g');
  assert.ok(!/[\u0000-\u001f]/.test(p.tool + p.error));
  assert.ok(p.tool.length <= 80 && p.error.length <= 300);
  assert.ok(p.tool.startsWith('Ba sh'));
});

test('forget drops the run; a malformed record reads as no run and is replaced on the next failure', () => {
  toolloop.noteFailure('agent-h', { tool: 'Bash', sig: SIG_A });
  toolloop.forget('agent-h');
  assert.equal(toolloop.peek('agent-h'), null);
  const file = path.join(store.ROOT, 'toolloop', store.safeKey('agent-h') + '.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{ not json');
  assert.equal(toolloop.peek('agent-h'), null);
  assert.equal(toolloop.noteFailure('agent-h', { tool: 'Bash', sig: SIG_A }).count, 1);
});
