'use strict';
/**
 * #570 7c-5: a Windows agent's working/idle from its own event stream.
 *
 *   node --test engine/win32streamstate.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Sandbox the data root BEFORE requiring anything that reads the store.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'win32streamstate-570-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const ss = require('./win32streamstate');

/* The event sequences MEASURED on the box (2026-09-10), reduced to the fields the
   reader looks at. A turn that only answers, and a turn that runs a tool. */
const PLAIN_TURN = [
  { type: 'system', subtype: 'init' },
  { type: 'rate_limit_event' },
  { type: 'assistant', message: { content: [{ type: 'text' }] } },
  { type: 'rate_limit_event' },
  { type: 'result', subtype: 'success', is_error: false },
];
const TOOL_TURN = [
  { type: 'system', subtype: 'init' },
  { type: 'assistant', message: { content: [{ type: 'tool_use' }] } },
  { type: 'user', message: { content: [{ type: 'tool_result' }] } },
  { type: 'assistant', message: { content: [{ type: 'thinking' }] } },
  { type: 'assistant', message: { content: [{ type: 'text' }] } },
  { type: 'result', subtype: 'success', is_error: false },
];

/** A publisher whose writes land in an array instead of on disk. */
function recording(opts) {
  const wrote = [];
  let clears = 0;
  const timers = [];
  const pub = ss.publisher('agent-a', Object.assign({
    write: (rec) => { wrote.push(rec); return { ok: true }; },
    clear: () => { clears += 1; },
    setTimer: (fn) => timers.push(fn),
  }, opts));
  return { pub, wrote, states: () => wrote.map((r) => r.state), clears: () => clears, timers };
}

test('#570 7c-5 a fresh agent is IDLE, a message makes it BUSY, and its result makes it IDLE', () => {
  const r = recording();
  r.pub.started(4242, 'sid-1');
  r.pub.wrote();
  for (const e of PLAIN_TURN) r.pub.event(e);
  assert.deepEqual(r.states(), ['idle', 'busy', 'idle']);
  assert.deepEqual(r.wrote.map((w) => [w.v, w.pid, w.sessionId]), [[1, 4242, 'sid-1'], [1, 4242, 'sid-1'], [1, 4242, 'sid-1']]);
});

test('#570 7c-5 writes happen on a TRANSITION only: a tool turn of six events costs two writes', () => {
  const r = recording();
  r.pub.started(1, 'sid');
  for (const e of TOOL_TURN) r.pub.event(e);
  assert.deepEqual(r.states(), ['idle', 'busy', 'idle']);
});

test('#570 7c-5 two back-to-back messages read as two turns, ending IDLE (measured: never batched)', () => {
  const r = recording();
  r.pub.started(1, 'sid');
  r.pub.wrote(); r.pub.wrote();
  for (const e of PLAIN_TURN) r.pub.event(e);
  for (const e of PLAIN_TURN) r.pub.event(e);
  assert.deepEqual(r.states(), ['idle', 'busy', 'idle', 'busy', 'idle']);
});

test('#570 7c-5 a turn we did not see written (the channel was unsure) still reads BUSY from its own events', () => {
  const r = recording();
  r.pub.started(1, 'sid');
  for (const e of TOOL_TURN) r.pub.event(e);
  assert.equal(r.states()[1], 'busy');
});

test('#570 7c-5 events that say nothing about working or idle change nothing', () => {
  const r = recording();
  r.pub.started(1, 'sid');
  for (const e of [{ type: 'rate_limit_event' }, { type: 'system', subtype: 'compact_boundary' }, { type: 'mystery' }, null, 'text', [], 7]) r.pub.event(e);
  assert.deepEqual(r.states(), ['idle'], 'only init opens a turn; another system subtype between turns must not strand the card on WORKING');
});

test('#570 7c-5 nothing is published before a start or after a death', () => {
  const r = recording();
  r.pub.wrote();
  r.pub.event({ type: 'assistant' });
  assert.deepEqual(r.wrote, []);
  r.pub.started(1, 'sid');
  r.pub.stopped();
  r.pub.event({ type: 'assistant' });
  r.pub.wrote();
  assert.deepEqual(r.states(), ['idle']);
  assert.equal(r.clears(), 1, 'the death clears the file');
});

test('#570 7c-5 a start without a real pid or session publishes nothing and clears', () => {
  const r = recording();
  r.pub.started(undefined, 'sid');
  r.pub.started(5, '');
  assert.deepEqual(r.wrote, []);
  assert.equal(r.clears(), 2);
});

test('#570 7c-5 a restart is a new process: its first state is written even if it matches the last one', () => {
  const r = recording();
  r.pub.started(1, 'sid');
  r.pub.stopped();
  r.pub.started(2, 'sid');
  assert.deepEqual(r.wrote.map((w) => [w.state, w.pid]), [['idle', 1], ['idle', 2]]);
});

test('#570 7c-5 a failed write is said, retried once, and a second failure CLEARS rather than leaving an older state', () => {
  let fail = true;
  const problems = [];
  const r = recording({
    write: () => (fail ? { ok: false, because: 'EPERM' } : { ok: true }),
    onProblem: (why) => problems.push(why),
  });
  r.pub.started(1, 'sid');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /could not record its state \(EPERM\)/);
  assert.equal(r.timers.length, 1, 'one retry armed');
  r.timers[0]();
  assert.equal(problems.length, 2);
  assert.equal(r.clears(), 1, 'the second failure clears the file');
  assert.equal(r.timers.length, 1, 'and no further retry is armed');

  fail = false;
  r.pub.wrote();
  assert.equal(problems.length, 2, 'the next transition writes again from scratch');
});

test('#570 7c-5 a retry that succeeds writes the state; a success before it makes it a no-op', () => {
  let fail = true;
  const got = [];
  const timers = [];
  const pub = ss.publisher('agent-a', {
    write: (rec) => { if (fail) return { ok: false, because: 'EPERM' }; got.push(rec.state); return { ok: true }; },
    clear: () => {},
    setTimer: (fn) => timers.push(fn),
  });
  pub.started(1, 'sid');            // fails; a retry is armed
  fail = false;
  timers[0]();
  assert.deepEqual(got, ['idle'], 'the retry writes the state that failed');

  fail = true;
  pub.wrote();                          // busy, but the write fails; another retry is armed
  fail = false;
  pub.event({ type: 'assistant' });     // still busy: this transition's write gets there first
  timers[1]();
  assert.deepEqual(got, ['idle', 'busy'], 'written once by the transition; the pending retry has nothing left to do');

  fail = true;
  pub.event({ type: 'result' });        // idle, write fails; a retry is armed
  fail = false;
  pub.wrote();                          // back to busy, which is what the disk already says
  timers[2]();
  assert.deepEqual(got, ['idle', 'busy'], 'no write when the disk already holds the current state');
});

test('#570 7c-5 a retry armed for one process never acts as the second attempt for the next', () => {
  const timers = [];
  let clears = 0;
  const problems = [];
  const pub = ss.publisher('agent-a', {
    write: () => ({ ok: false, because: 'EPERM' }),
    clear: () => { clears += 1; },
    setTimer: (fn) => timers.push(fn),
    onProblem: (why) => problems.push(why),
  });
  pub.started(1, 'sid');            // fails; retry armed for process 1
  pub.stopped();                    // clears (1)
  pub.started(2, 'sid');            // fails; retry armed for process 2
  const before = clears;
  timers[0]();                      // process 1's retry fires late
  assert.equal(clears, before, 'the old retry did nothing, so process 2 still gets its full retry');
  assert.equal(problems.length, 2);
  timers[1]();                      // process 2's own retry: its second failure
  assert.equal(clears, before + 1);
});

test('#570 7c-5 the line reader joins split chunks, keeps a split multibyte character, and skips blanks', () => {
  const lines = [];
  const feed = ss.lineReader((l) => lines.push(l));
  const e = Buffer.from('{"t":"é"}\n', 'utf8');
  const cut = e.indexOf(0xc3) + 1;   // between the two bytes of é
  feed(Buffer.from('{"a":1}\n\n{"b"'));
  feed(Buffer.from(':2}\n'));
  feed(e.subarray(0, cut));
  feed(e.subarray(cut));
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}', '{"t":"é"}']);
});

test('#570 7c-5 an overlong line is skipped whole, and reading resumes at the next line', () => {
  const lines = [];
  const feed = ss.lineReader((l) => lines.push(l));
  const huge = 'x'.repeat(16 * 1024 * 1024 + 10);
  feed(huge);
  feed('still the same line\n{"after":true}\n');
  assert.deepEqual(lines, ['{"after":true}']);
});

test('#570 7c-5 parseEvent answers null for a line that is not JSON', () => {
  assert.deepEqual(ss.parseEvent('{"type":"result"}'), { type: 'result' });
  assert.equal(ss.parseEvent('not json'), null);
});

test('#570 7c-5 THE FILE ROUND TRIP: the real publisher writes what stateFor reads, for THIS process only', () => {
  const pub = ss.publisher('Round Trip');
  pub.started(777, 'sid-rt');
  assert.equal(ss.stateFor('Round Trip', { sessionId: 'sid-rt', pid: 777 }), 'idle');
  pub.wrote();
  assert.equal(ss.stateFor('Round Trip', { sessionId: 'sid-rt', pid: 777 }), 'busy');
  assert.equal(ss.stateFor('Round Trip', { sessionId: 'sid-rt', pid: 778 }), null, 'another process under the same session');
  assert.equal(ss.stateFor('Round Trip', { sessionId: 'sid-other', pid: 777 }), null, 'another session');
  assert.equal(ss.stateFor('Round Trip', { sessionId: 'sid-rt' }), null, 'a live row with no pid proves nothing');
  assert.equal(ss.stateFor('Round Trip', null), null);
  pub.stopped();
  assert.equal(ss.stateFor('Round Trip', { sessionId: 'sid-rt', pid: 777 }), null, 'a death clears it');
});

test('#570 7c-5 stateFor refuses a file it was not written to read', () => {
  const dir = path.join(require('./store').ROOT, 'win32-state');
  const live = { sessionId: 'sid-x', pid: 9 };
  const pub = ss.publisher('shapes');
  pub.started(9, 'sid-x');
  const file = fs.readdirSync(dir).map((f) => path.join(dir, f)).find((f) => fs.readFileSync(f, 'utf8').includes('sid-x'));
  assert.ok(file, 'the publisher wrote a file');
  const put = (obj) => fs.writeFileSync(file, typeof obj === 'string' ? obj : JSON.stringify(obj));
  put({ v: 2, state: 'busy', sessionId: 'sid-x', pid: 9 });
  assert.equal(ss.stateFor('shapes', live), null, 'another version');
  put({ v: 1, state: 'thinking', sessionId: 'sid-x', pid: 9 });
  assert.equal(ss.stateFor('shapes', live), null, 'an unknown token');
  put('{not json');
  assert.equal(ss.stateFor('shapes', live), null, 'an unreadable file');
  put({ v: 1, state: 'busy', sessionId: 'sid-x', pid: '9' });
  assert.equal(ss.stateFor('shapes', live), null, 'a pid that only looks equal');
  pub.stopped();
});
