'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/*
 * kosmos#8593 (Windows): a Codex agent's supervisor waits out a swap of the managed Codex before each turn. It spawns
 * the codex.exe it resolved once (it never asks resolveBin), so without this a turn could start on a tree that an
 * upgrade is taking away. runners.waitForSwap is the wait; this file pins the wiring: a Codex turn runs only after it
 * resolves, a timed-out wait still runs the turn (as before), and a keyed runner never waits.
 *
 *   node --test engine/win32codexsup.swapwait-8593.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { superviseCodexStreaming } = require('./win32codexsup');

function opts(over) {
  return Object.assign({
    stream: { started() {}, event() {}, wrote() {}, stopped() {}, rekey() {} },
    prepare: () => ({ ok: true, sessionId: 'sess-1', name: 'coder', token: 'tok', instance: 'inst', tokenBecause: null, launchArgs: [] }),
    retireRun: () => ({ ok: true }),
    sessions: { pruneName: () => ({ ok: true, removed: 0 }) },
    supervisorPid: 4242,
    env: { CODEX_HOME: '/acct' },
    onEvent: () => {},
    bin: 'C:\\runners\\openai\\pkg\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe',
  }, over || {});
}
const tick = () => new Promise((r) => setImmediate(r));

test('a Codex turn does not start until the swap wait resolves, and is asked about the codex it will run', async () => {
  let release;
  const asked = [];
  const turns = [];
  const h = superviseCodexStreaming({ name: 'coder', cwd: 'C:/w', runner: 'codex' }, opts({
    swapWait: (bin) => { asked.push(bin); return new Promise((r) => { release = r; }); },
    runTurn: async (o) => { turns.push(o.message); return { ok: true, sessionId: 't1' }; },
  }));
  await new Promise((res) => h.send('hello', () => res()));
  for (let i = 0; i < 5; i++) await tick();
  assert.deepEqual(asked, [opts().bin], 'asked about the managed codex.exe this agent runs');
  assert.deepEqual(turns, [], 'no turn while the swap is under way');
  release(true);
  for (let i = 0; i < 5; i++) await tick();
  assert.deepEqual(turns, ['hello'], 'the turn runs once the swap is over');
});

test('a wait that ran out (false) still runs the turn, as before this card', async () => {
  const turns = [];
  const h = superviseCodexStreaming({ name: 'coder', cwd: 'C:/w', runner: 'codex' }, opts({
    swapWait: async () => false,
    runTurn: async (o) => { turns.push(o.message); return { ok: true, sessionId: 't1' }; },
  }));
  await new Promise((res) => h.send('hello', () => res()));
  for (let i = 0; i < 5; i++) await tick();
  assert.deepEqual(turns, ['hello']);
});

test('a keyed runner (Gemini) never waits on the Codex swap', async () => {
  let asked = 0;
  const turns = [];
  const h = superviseCodexStreaming({ name: 'coder', cwd: 'C:/w', runner: 'gemini' }, opts({
    bin: 'C:\\runners\\google\\gemini.cmd',
    swapWait: async () => { asked += 1; return true; },
    runTurn: async (o) => { turns.push(o.message); return { ok: true, sessionId: 't1' }; },
  }));
  await new Promise((res) => h.send('hello', () => res()));
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(asked, 0);
  assert.deepEqual(turns, ['hello']);
});
