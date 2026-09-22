'use strict';
/**
 * #3380 the codex supervisor: the per-turn loop that replaces the persistent
 * stream-json child for an OpenAI agent. Every arm runs on any platform -- the
 * turn runner, the session prepare, the token retire and the stream sink are all
 * seams -- so this drives an agent's whole life without spawning codex.
 *
 *   node --test engine/win32codexsup.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { superviseCodexStreaming } = require('./win32codexsup');

/* A recording stream sink, the shape win32streamstate.publisher presents. */
function fakeStream() {
  const calls = [];
  return {
    calls,
    started(pid, sessionId) { calls.push(['started', pid, sessionId]); },
    event(e) { calls.push(['event', e && e.type]); },
    wrote() { calls.push(['wrote']); },
    stopped() { calls.push(['stopped']); },
    rekey(id) { calls.push(['rekey', id]); },
  };
}

/* A prepare that mints a fixed session + token without touching the store. */
function fakePrepare(sessionId) {
  return () => ({ ok: true, sessionId, name: 'coder', token: 'tok', instance: 'inst', tokenBecause: null, launchArgs: [] });
}

function baseOpts(over) {
  return Object.assign({
    stream: fakeStream(),
    prepare: fakePrepare('sess-1'),
    retireRun: () => ({ ok: true }),
    sessions: { pruneName: () => ({ ok: true, removed: 0 }) },
    supervisorPid: 4242,
    env: { CODEX_HOME: '/acct' },   // skip childEnv so no real process.env work
    onEvent: () => {},
  }, over || {});
}

test('#3380 start records the session and publishes idle presence with the SUPERVISOR pid', () => {
  const stream = fakeStream();
  const events = [];
  const h = superviseCodexStreaming({ name: 'coder', cwd: 'C:/w', runner: 'codex' },
    baseOpts({ stream, runTurn: async () => ({ ok: true }), onEvent: (e) => events.push(e.action) }));
  assert.equal(h.sessionId, 'sess-1');
  assert.deepEqual(stream.calls[0], ['started', 4242, 'sess-1'], 'presence is the supervisor pid + kosmos session');
  assert.ok(events.includes('started'));
});

test('#3380 a delivered message runs a codex turn, resuming the thread across turns', async () => {
  const turns = [];
  let threadSeen = [];
  const runTurn = async (o) => {
    turns.push(o.message);
    threadSeen.push(o.sessionId || null);
    return { ok: true, response: 'ok', sessionId: 'thread-9' };   // establishes the thread id
  };
  const h = superviseCodexStreaming({ name: 'coder', cwd: 'C:/w', runner: 'codex' }, baseOpts({ runTurn }));

  await new Promise((res) => h.send('first', () => res()));
  // let the turn's promise settle
  await new Promise((r) => setImmediate(r));
  await new Promise((res) => h.send('second', () => res()));
  await new Promise((r) => setImmediate(r));

  assert.deepEqual(turns, ['first', 'second']);
  assert.equal(threadSeen[0], null, 'the first turn is fresh (no thread id yet)');
  assert.equal(threadSeen[1], 'thread-9', 'the second turn RESUMES the thread the first established');
});

test('#3380 send reports the message ACCEPTED (delivered), not the turn finished', async () => {
  let resolveTurn;
  const runTurn = () => new Promise((r) => { resolveTurn = r; });   // never settles until we say
  const h = superviseCodexStreaming({ name: 'coder', cwd: 'C:/w', runner: 'codex' }, baseOpts({ runTurn }));
  const verdict = await new Promise((res) => h.send('hi', res));
  assert.deepEqual(verdict, { ok: true }, 'delivery is confirmed on enqueue, before the turn completes');
  resolveTurn({ ok: true, response: 'done' });
});

test('#3380 turns are SERIALISED: a second message waits for the first turn', async () => {
  let running = 0;
  let maxConcurrent = 0;
  const gates = [];
  const runTurn = () => new Promise((resolve) => {
    running += 1; maxConcurrent = Math.max(maxConcurrent, running);
    gates.push(() => { running -= 1; resolve({ ok: true, response: 'x', sessionId: 't' }); });
  });
  const h = superviseCodexStreaming({ name: 'coder', cwd: 'C:/w', runner: 'codex' }, baseOpts({ runTurn }));
  h.send('a', () => {});
  h.send('b', () => {});
  await new Promise((r) => setImmediate(r));
  assert.equal(gates.length, 1, 'only ONE turn is in flight');
  gates[0]();                                   // finish the first
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.equal(gates.length, 2, 'the second turn starts only after the first finished');
  gates[1]();
  assert.equal(maxConcurrent, 1, 'never two codex turns against one thread at once');
});

test('#3380 the stream goes BUSY on a turn and IDLE when it completes', async () => {
  const stream = fakeStream();
  const h = superviseCodexStreaming({ name: 'coder', cwd: 'C:/w', runner: 'codex' },
    baseOpts({ stream, runTurn: async () => ({ ok: true, response: 'r', sessionId: 't' }) }));
  await new Promise((res) => h.send('go', () => res()));
  await new Promise((r) => setImmediate(r));
  const kinds = stream.calls.map((c) => c[0] + (c[0] === 'event' ? ':' + c[1] : ''));
  assert.ok(kinds.indexOf('wrote') !== -1, 'busy on turn start');
  assert.ok(kinds.indexOf('event:result') > kinds.indexOf('wrote'), 'idle (a result event) after the turn');
});

test('#3380 stop retires the token, clears presence, and refuses further sends', async () => {
  let retired = false;
  const stream = fakeStream();
  const h = superviseCodexStreaming({ name: 'coder', cwd: 'C:/w', runner: 'codex' },
    baseOpts({ stream, retireRun: () => { retired = true; return { ok: true }; }, runTurn: async () => ({ ok: true }) }));
  h.stop();
  assert.equal(retired, true, 'the run token is retired on stop');
  assert.ok(stream.calls.some((c) => c[0] === 'stopped'), 'presence is cleared');
  const verdict = await new Promise((res) => h.send('late', res));
  assert.equal(verdict.ok, false, 'a stopped supervisor takes no more messages');
});

test('#3380 stop KILLS an in-flight turn child so it does not outlive the supervisor', async () => {
  let killed = false;
  const fakeChild = { kill: () => { killed = true; } };
  const runTurn = (o) => { if (o.onSpawn) o.onSpawn(fakeChild); return new Promise(() => {}); };  // never settles
  const h = superviseCodexStreaming({ name: 'coder', cwd: 'C:/w', runner: 'codex' }, baseOpts({ runTurn }));
  h.send('work', () => {});
  await new Promise((r) => setImmediate(r));
  h.stop();
  assert.equal(killed, true, 'the running codex exec child is killed on stop');
});

test('#3380 a prepare that cannot record refuses the start rather than running blind', () => {
  const events = [];
  const h = superviseCodexStreaming({ name: 'coder', cwd: 'C:/w', runner: 'codex' },
    baseOpts({ prepare: () => ({ ok: false, because: 'the record is busy' }), onEvent: (e) => events.push(e) }));
  assert.equal(h.sessionId, null);
  assert.ok(events.some((e) => e.action === 'refused' && /record is busy/.test(e.because)));
});

test('#3380 mayStart:false does not start an agent for a task that was just ended', () => {
  const events = [];
  const h = superviseCodexStreaming({ name: 'coder', cwd: 'C:/w', runner: 'codex' },
    baseOpts({ mayStart: () => false, onEvent: (e) => events.push(e.action) }));
  assert.equal(h.sessionId, null);
  assert.ok(events.includes('not-starting'));
});
