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

test('#570 7c-5 a start without a real pid or session publishes nothing, and clears only its OWN earlier process', () => {
  /* A launch that did not spawn proves nothing about the file at this name -- it
     may be a still-running previous supervisor's (headless overlap, review round
     2). So with no earlier process of its own, it clears nothing. */
  const r = recording();
  r.pub.started(undefined, 'sid');
  r.pub.started(5, '');
  assert.deepEqual(r.wrote, []);
  assert.equal(r.clears(), 0, 'no earlier process of its own, so nothing is cleared');
  r.pub.started(7, 'sid-ok');
  r.pub.started(undefined, 'sid-next');
  assert.equal(r.clears(), 1, 'its own earlier process is cleared');
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

test('#570 7c-5 a clear that fails after a second write failure is SAID, not swallowed', () => {
  /* Found in review round 3: clearing a LIVE process's older state is the one
     clear whose failure matters -- that state stays readable under a matching
     session and pid -- and it failed silently. */
  const problems = [];
  const timers = [];
  const pub = ss.publisher('agent-a', {
    write: () => ({ ok: false, because: 'EPERM' }),
    clear: () => false,
    setTimer: (fn) => timers.push(fn),
    onProblem: (why) => problems.push(why),
  });
  pub.started(1, 'sid');
  timers[0]();
  assert.equal(problems.length, 3, 'two write failures, then the failed clear');
  assert.match(problems[2], /could not clear its older state/);
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

test('#570 headless: a LEAVING supervisor\'s stop does not erase the file of the one that replaced it', () => {
  /* Measured on the box: a restart ran the new supervisor while the old one was
     still leaving (up to ~1s after /End). The old one's stop deleted the state
     file BY NAME, the new agent sat idle, and its card read UNKNOWN. */
  const oldOne = ss.publisher('overlap');
  const newOne = ss.publisher('overlap');
  oldOne.started(111, 'sid-old');
  newOne.started(222, 'sid-new');            // the replacement has written its state
  oldOne.stopped();                          // then the old one finally leaves
  assert.equal(ss.stateFor('overlap', { sessionId: 'sid-new', pid: 222 }), 'idle', 'the new file survives');
  newOne.stopped();                          // its own stop still clears its own file
  assert.equal(ss.stateFor('overlap', { sessionId: 'sid-new', pid: 222 }), null);
});

test('#570 headless: a new supervisor whose launch failed does not erase the old one\'s file', () => {
  /* Found in review round 2: a spawn that fails leaves no pid, and started()
     cleared the file at this name with NO owner -- the still-running previous
     supervisor's valid state. */
  const oldOne = ss.publisher('failspawn');
  const newOne = ss.publisher('failspawn');
  oldOne.started(333, 'sid-old');
  newOne.started(undefined, 'sid-new');       // the new launch never spawned
  assert.equal(ss.stateFor('failspawn', { sessionId: 'sid-old', pid: 333 }), 'idle', 'the old file survives the start');
  /* Review round 3: on Windows a spawn that fails does not throw; its child
     reports 'error' a moment later, and the supervisor's death handler then calls
     stopped(). That is the sequence that erased the old file. */
  newOne.stopped();
  assert.equal(ss.stateFor('failspawn', { sessionId: 'sid-old', pid: 333 }), 'idle', 'and the stop that follows');
  oldOne.stopped();
});

test('#570 headless: a stop leaves alone a file it cannot read, rather than deleting on a doubt', () => {
  const pub = ss.publisher('garbled');
  pub.started(444, 'sid-g');
  const dir = path.join(require('./store').ROOT, 'win32-state');
  const file = fs.readdirSync(dir).map((f) => path.join(dir, f)).find((f) => fs.readFileSync(f, 'utf8').includes('sid-g'));
  fs.writeFileSync(file, '{not json');
  pub.stopped();
  assert.equal(fs.existsSync(file), true, 'an unreadable file is put back, not destroyed');
  assert.equal(fs.readFileSync(file, 'utf8'), '{not json');
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.clear')), [], 'no private claim is left behind');
  fs.rmSync(file, { force: true });
});

test('#570 headless: when the put-back itself fails, the claim KEEPS the file that was not ours', () => {
  /* Review round 4: the non-EEXIST branch (a volume without hard links, say) had no
     test. The claim is then the only copy of another process's state, so it must
     survive, and the clear must not pretend it went cleanly. */
  const pub = ss.publisher('nolink');
  pub.started(555, 'sid-mine');
  const dir = path.join(require('./store').ROOT, 'win32-state');
  const file = fs.readdirSync(dir).map((f) => path.join(dir, f)).find((f) => fs.readFileSync(f, 'utf8').includes('sid-mine'));
  const theirs = JSON.stringify({ v: 1, state: 'busy', sessionId: 'sid-theirs', pid: 666, at: 'x' });
  fs.writeFileSync(file, theirs);                       // a newer supervisor's file now sits at the name
  const realLink = fs.linkSync;
  fs.linkSync = () => { throw Object.assign(new Error('no hard links here'), { code: 'EPERM' }); };
  try {
    assert.doesNotThrow(() => pub.stopped(), 'a failed put-back never throws out of a stop');
  } finally {
    fs.linkSync = realLink;
  }
  const claims = fs.readdirSync(dir).filter((f) => f.endsWith('.clear'));
  assert.equal(claims.length, 1, 'the claim is kept');
  assert.equal(fs.readFileSync(path.join(dir, claims[0]), 'utf8'), theirs, 'with the other process\'s state intact');
  for (const c of claims) fs.rmSync(path.join(dir, c), { force: true });
});

test('#2669 rekey re-stamps the file with the new session id, forcing a write though the state is unchanged', () => {
  const r = recording();
  r.pub.started(9, 'sid-before');
  r.pub.rekey('sid-after');
  assert.deepEqual(r.wrote.map((w) => [w.state, w.sessionId, w.pid]), [['idle', 'sid-before', 9], ['idle', 'sid-after', 9]]);
  r.pub.rekey('sid-after');
  assert.equal(r.wrote.length, 2, 'the same id again changes nothing');
  r.pub.wrote();
  assert.equal(r.wrote[2].sessionId, 'sid-after', 'and later transitions carry the new id');
});

test('#2669 rekey does nothing before a start, after a stop, or for a non-id', () => {
  const r = recording();
  r.pub.rekey('sid-x');
  r.pub.started(1, 'sid-a');
  r.pub.rekey('');
  r.pub.rekey(42);
  r.pub.stopped();
  r.pub.rekey('sid-y');
  assert.deepEqual(r.states(), ['idle']);
});

test('#2669 a retry armed under the OLD id cannot act after a rekey', () => {
  let fail = true;
  const got = [];
  const timers = [];
  const pub = ss.publisher('agent-a', {
    write: (rec) => { if (fail) return { ok: false, because: 'EPERM' }; got.push(rec.sessionId); return { ok: true }; },
    clear: () => {},
    setTimer: (fn) => timers.push(fn),
  });
  pub.started(1, 'sid-old');         // fails; a retry is armed for the old id
  fail = false;
  pub.rekey('sid-new');              // writes under the new id
  timers[0]();                       // the old retry fires late
  assert.deepEqual(got, ['sid-new'], 'written once, under the new id only');
});

test('#2669 a rekey whose own write fails arms a FRESH retry: the old one cannot act, and nothing is cleared', () => {
  /* Pins both of rekey's guards. Without the generation bump the old retry would
     act for the new id; without the `retrying` reset the rekey's failure would
     count as the old retry's SECOND failure and clear the file. */
  let fails = 2;
  const wrote = [];
  let clears = 0;
  const timers = [];
  const pub = ss.publisher('agent-a', {
    write: (rec) => { if (fails > 0) { fails -= 1; return { ok: false, because: 'EPERM' }; } wrote.push(rec.sessionId); return { ok: true }; },
    clear: () => { clears += 1; },
    setTimer: (fn) => timers.push(fn),
  });
  pub.started(1, 'sid-old');          // fails: a retry is armed for the old id
  pub.rekey('sid-new');               // fails too
  assert.equal(clears, 0, 'one failure under the new id is not the old id\'s second');
  assert.equal(timers.length, 2, 'a fresh retry is armed for the new id');
  timers[0]();                        // the old retry fires late
  assert.deepEqual(wrote, [], 'and does nothing');
  timers[1]();                        // the fresh one lands
  assert.deepEqual(wrote, ['sid-new']);
});

test('#2669 END TO END on the real file: after a rekey the board matches the NEW session, not the old', () => {
  const pub = ss.publisher('Cleared One');
  pub.started(4321, 'sid-pre-clear');
  pub.rekey('sid-post-clear');
  assert.equal(ss.stateFor('Cleared One', { sessionId: 'sid-post-clear', pid: 4321 }), 'idle');
  assert.equal(ss.stateFor('Cleared One', { sessionId: 'sid-pre-clear', pid: 4321 }), null);
  pub.stopped();
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
