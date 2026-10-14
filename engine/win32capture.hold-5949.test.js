'use strict';
/**
 * #5949: a healthy Windows Claude agent flipped to "Can't tell" on ONE failed status read,
 * every Claude card at once, with no reason anywhere.
 *
 * What is pinned here:
 *   - one failed read keeps each agent's last good state, marked as remembered (not a fresh look)
 *   - "Can't tell" comes only after FAILS_TO_UNKNOWN failed reads in a row AND HOLD_MS since the
 *     last good one, and a good read brings it straight back
 *   - each fall is written to the agent's own log with its cause, once per change, never per tick
 *   - one failed read does not blank the other cards (end to end through the real status.js)
 *   - the roster keeps the last good Claude list through a short gap, then refuses as before
 *
 * Pure: every reader, clock and log is injected, so this runs the same on any host.
 *
 *   node --test engine/win32capture.hold-5949.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'win32hold-5949-'));
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const status = require('./status');
const win32capture = require('./win32capture');
const win32roster = require('./win32roster');

const live = (sessionId, st) => ({ pid: 1, cwd: '/w', kind: 'interactive', startedAt: 1, sessionId, name: 'cwd-' + sessionId, status: st });
const RECORD = { 'sid-a': { name: 'ada', runner: 'claude' }, 'sid-b': { name: 'bob', runner: 'claude' }, 'sid-c': { name: 'cy', runner: 'claude' } };
const rec = { read: () => RECORD };

/* A scripted world: `answer` is what the next read returns, `t` is the clock, `lines` the log. */
function world() {
  const w = {
    t: 1000,
    answer: [live('sid-a', 'busy'), live('sid-b', 'idle')],
    why: null,
    lines: [],
  };
  w.cap = win32capture.make({
    run: () => w.answer,
    record: rec,
    now: () => w.t,
    ttlMs: 1000,
    problem: () => w.why,
    log: (name, event, because) => w.lines.push({ name, event, because }),
  });
  /* One read: move the clock past the memo window and ask. */
  w.look = (target, stepMs = 5000) => { w.t += stepMs; return w.cap(target); };
  return w;
}

test('#5949 one failed read keeps the last good state, marked as remembered, with its cause logged once', () => {
  const w = world();
  assert.equal(w.look('ada:0.0'), 'busy');
  assert.equal(w.cap.note('ada:0.0'), null, 'a fresh look carries no note');
  w.answer = null;
  w.why = 'the status read timed out after 15 s';
  assert.equal(w.look('ada:0.0'), 'busy', 'one failed read must not blank the card');
  assert.deepEqual(w.cap.note('ada:0.0'), { held: true, cause: 'the status read timed out after 15 s' });
  const failed = w.lines.filter((l) => l.name === 'ada' && l.event === 'status-read-failed');
  assert.equal(failed.length, 1);
  assert.match(failed[0].because, /timed out after 15 s/);
  assert.match(failed[0].because, /working/, 'the log names the state the card is keeping');
  /* Asked again inside the same memo window: still one read, still one line. */
  w.cap('ada:0.0'); w.cap('bob:0.0');
  assert.equal(w.lines.filter((l) => l.event === 'status-read-failed').length, 2, 'one line per agent, not per call');
});

test('#5949 Can\'t tell only after 3 failed reads in a row AND 15 s; said once; a good read brings it back', () => {
  const w = world();
  w.look('ada:0.0');
  w.answer = null;
  w.why = 'the status read failed (claude exited with code 1)';
  /* Three quick failures (1.1 s apart): the count is there but the time is not, so still held. */
  for (let i = 0; i < 3; i += 1) assert.equal(w.look('ada:0.0', 1100), 'busy', 'held on quick failure ' + (i + 1));
  /* Time passes with failures: past 15 s since the last good read, it gives up. */
  assert.equal(w.look('ada:0.0', 6000), 'busy', 'still held: 4 failures but only ~9.3 s');
  assert.equal(w.look('ada:0.0', 6000), null, 'gives up: 5 failures and ~15.3 s');
  assert.deepEqual(w.cap.note('ada:0.0'), { unreadable: true, cause: 'the status read failed (claude exited with code 1)' });
  w.look('ada:0.0'); w.look('ada:0.0');
  const gaveUp = w.lines.filter((l) => l.name === 'ada' && l.event === 'cant-tell');
  assert.equal(gaveUp.length, 1, 'the fall to Can\'t tell is logged once, not every tick');
  assert.match(gaveUp[0].because, /exited with code 1/);
  /* Back. */
  w.answer = [live('sid-a', 'idle'), live('sid-b', 'idle')];
  w.why = null;
  assert.equal(w.look('ada:0.0'), 'idle', 'a good read is used at once');
  assert.equal(w.cap.note('ada:0.0'), null);
  assert.equal(w.lines.filter((l) => l.name === 'ada' && l.event === 'status-read-back').length, 1);
});

test('#5949 with the default counts, slow reads give up on the third failure past 15 s, not the first', () => {
  const w = world();
  w.look('ada:0.0');
  w.answer = null;
  assert.equal(w.look('ada:0.0', 20000), 'busy', 'one failure, even long after the last good read, is held');
  assert.equal(w.look('ada:0.0', 5000), 'busy', 'two');
  assert.equal(w.look('ada:0.0', 5000), null, 'three in a row and well past 15 s: Can\'t tell');
});

test('#5949 an unknown status token and a state file that does not match are causes too', () => {
  const w = world();
  w.look('ada:0.0');
  const streaming = (sid) => ({ pid: 2, cwd: '/w', kind: 'interactive', startedAt: 1, sessionId: sid, name: 'x' });
  w.answer = [live('sid-a', 'compacting'), streaming('sid-b'), streaming('sid-c')];
  assert.equal(w.look('ada:0.0'), 'busy', 'an unknown token is held like a failed read');
  assert.match(w.cap.note('ada:0.0').cause, /status Kosmos does not know \("compacting"\)/);
  /* bob: no status listed and no matching state file in the sandbox; held, with that cause. */
  assert.equal(w.cap('bob:0.0'), 'idle');
  assert.deepEqual(w.cap.note('bob:0.0'), { held: true, cause: 'its state file did not match the running session' });
  /* cy was never read well: nothing to hold, so Can't tell at once; said only once it keeps
     failing (a streaming agent that has just started has no state file for a moment). */
  assert.equal(w.cap('cy:0.0'), null);
  assert.deepEqual(w.cap.note('cy:0.0'), { unreadable: true, cause: 'its state file did not match the running session' });
  assert.equal(w.lines.filter((l) => l.name === 'cy').length, 0, 'a first look with no state yet is not logged');
  w.look('cy:0.0'); w.look('cy:0.0');
  assert.equal(w.lines.filter((l) => l.name === 'cy' && l.event === 'cant-tell' && /3 times in a row/.test(l.because)).length, 1);
  w.look('cy:0.0');
  assert.equal(w.lines.filter((l) => l.name === 'cy').length, 1, 'said once');
});

test('#5949 an agent a good read no longer lists is forgotten quietly (it stopped; no card, no log)', () => {
  const w = world();
  w.look('ada:0.0');
  w.answer = [live('sid-b', 'idle')];
  assert.equal(w.look('ada:0.0'), null);
  assert.equal(w.cap.note('ada:0.0'), null);
  assert.equal(w.lines.length, 0, 'a stopped agent is not a failed check');
});

test('#5949 a throwing log never reaches the board', () => {
  const cap = win32capture.make({ run: () => null, record: rec, log: () => { throw new Error('disk full'); } });
  assert.equal(cap('ada:0.0'), null);
});

test('#5949 END TO END: one failed read keeps EVERY Claude card on its last state, marked remembered', () => {
  let answer = [live('sid-a', 'busy'), live('sid-b', 'idle')];
  let t = 1000;
  const run = () => answer;
  status.setPaneSource(win32roster.make({ run, record: rec, now: () => t }));
  status.setPaneCapture(win32capture.make({ run, record: rec, now: () => t, ttlMs: 1000, log: () => {} }));
  try {
    let board = status.snapshot();
    const fresh = (n) => board.agents.find((x) => x.sessionName === n);
    assert.equal(fresh('ada').state, status.STATE.WORKING);
    assert.equal(fresh('bob').state, status.STATE.IDLE);
    assert.equal('stateRead' in fresh('ada'), false, 'a fresh look adds no field');

    answer = null;   // the read fails, for the roster and the capture alike
    t += 5000;
    board = status.snapshot();   // before #5949 this threw: the roster refused the whole board
    for (const [n, st] of [['ada', status.STATE.WORKING], ['bob', status.STATE.IDLE]]) {
      const a = board.agents.find((x) => x.sessionName === n);
      assert.ok(a, n + ' is still on the board');
      assert.equal(a.state, st, n + ' keeps its last state');
      assert.equal(a.stateRead, 'remembered', n + ' is marked as remembered');
      assert.equal(a.screenRead, 'remembered', n + ' carries the held screen for the code that acts on it');
    }

    /* The failure lasts: the roster's hold ends at 15 s, and the board refuses as it always did. */
    t += 15000;
    assert.throws(() => status.snapshot(), /could not see what is running/);

    answer = [live('sid-a', 'idle'), live('sid-b', 'busy')];
    t += 5000;
    board = status.snapshot();
    assert.equal(board.agents.find((x) => x.sessionName === 'ada').state, status.STATE.IDLE);
    assert.equal(board.agents.find((x) => x.sessionName === 'bob').state, status.STATE.WORKING);
    assert.equal('stateRead' in board.agents.find((x) => x.sessionName === 'bob'), false);
  } finally {
    status.setPaneSource(null);
    status.setPaneCapture(null);
  }
});

test('#5949 END TO END: a capture that cannot read and is not holding marks the card unreadable', () => {
  const agents = [live('sid-a', 'busy')];
  status.setPaneSource(win32roster.make({ run: () => agents, record: rec }));
  status.setPaneCapture(win32capture.make({ run: () => null, record: rec, log: () => {} }));
  try {
    const a = status.snapshot().agents.find((x) => x.sessionName === 'ada');
    assert.equal(a.state, status.STATE.UNKNOWN);
    assert.equal(a.stateRead, 'unreadable');
  } finally {
    status.setPaneSource(null);
    status.setPaneCapture(null);
  }
});

test('#5949 the roster keeps the last good Claude list for 15 s, then refuses as before', () => {
  let answer = [live('sid-a', 'busy')];
  let t = 0;
  const src = win32roster.make({ run: () => answer, record: rec, now: () => t, codexLive: () => [] });
  const first = src();
  assert.match(first, /^ada\t/);
  answer = null;
  t = 14999;
  assert.equal(src(), first, 'inside the hold: the same rows');
  t = 15000;
  assert.equal(src(), null, 'past it: we could not look, said as itself');
});

test('#5949 the shared cached read keeps why it failed beside the null', () => {
  let why = 'the status read answered with something that is not JSON';
  const cached = win32roster.makeCachedRun({ run: () => null, runAsync: (cb) => cb(null), now: () => 0, problem: () => why });
  assert.equal(cached.problem(), null, 'nothing read yet');
  assert.equal(cached(), null);
  assert.equal(cached.problem(), 'the status read answered with something that is not JSON');
  why = 'something else later';
  assert.equal(cached.problem(), 'the status read answered with something that is not JSON', 'the why of THIS answer, not the latest global');
  const ok = win32roster.makeCachedRun({ run: () => [], now: () => 0, problem: () => 'stale' });
  ok();
  assert.equal(ok.problem(), null, 'a list has no problem');
});

test('#5949 a held "working" is not "Working now" beside a fresh wait (one fact at both #1921 and #2146)', () => {
  const selfreport = require('./selfreport');
  let answer = [live('sid-a', 'busy')];
  let t = 1000;
  const run = () => answer;
  status.setPaneSource(win32roster.make({ run, record: rec, now: () => t }));
  status.setPaneCapture(win32capture.make({ run, record: rec, now: () => t, ttlMs: 1000, log: () => {} }));
  try {
    status.snapshot();   // a good read: ada is busy
    const r = selfreport.record('ada', { state: 'needs_you', because: 'which colour should the button be?' });
    assert.equal(r.recorded, true, 'CONTROL: the wait was recorded (' + JSON.stringify(r) + ')');
    answer = null;
    t += 5000;
    const a = status.snapshot().agents.find((x) => x.sessionName === 'ada');
    assert.equal(a.state, status.STATE.NEEDS_YOU, 'the fresh wait decides the state');
    assert.equal(a.activeWhileWaiting, false, 'a remembered busy is not work seen now');
  } finally {
    status.setPaneSource(null);
    status.setPaneCapture(null);
  }
});

test('#5949 a failed read is named by its cause, on the error shapes measured on Windows', () => {
  const { problemOf } = win32roster;
  /* Measured 2026-10-12 with the runtime node on the Windows box (execFileSync / execFile). */
  assert.match(problemOf({ code: 'ETIMEDOUT', signal: 'SIGTERM', status: null }), /timed out after 15 s/, 'sync timeout');
  assert.match(problemOf({ code: null, signal: 'SIGTERM', killed: true }), /timed out after 15 s/, 'async timeout');
  assert.match(problemOf({ code: 'ENOBUFS', signal: 'SIGTERM', status: null }), /more text than it can hold/, 'sync overflow is NOT a timeout');
  assert.match(problemOf({ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }), /more text than it can hold/, 'async overflow');
  assert.match(problemOf({ signal: null, status: 3 }), /exited with code 3/, 'sync exit');
  assert.match(problemOf({ code: 3, signal: null, killed: false }), /exited with code 3/, 'async exit');
  assert.match(problemOf({ code: 'ENOENT' }), /could not be started/, 'missing binary');
  assert.equal(problemOf(null), null);
});

/* A remembered-state store in memory, shaped like fileLastState. */
function memoryLastState(initial) {
  const s = { data: JSON.parse(JSON.stringify(initial || {})), writes: 0 };
  s.read = () => JSON.parse(JSON.stringify(s.data));
  s.write = (o) => { s.writes += 1; s.data = JSON.parse(JSON.stringify(o)); };
  return s;
}

test('#5949 after a board start, a card shows its last known state, marked remembered, until its first live reading', () => {
  const t0 = Date.parse('2026-10-12T14:20:58Z');
  const store = memoryLastState({ ada: { token: 'busy', at: '2026-10-12T14:20:50Z' } });
  let answer = [{ pid: 2, cwd: '/w', kind: 'interactive', startedAt: 1, sessionId: 'sid-a', name: 'x' }];   // no status yet
  let t = t0;
  const lines = [];
  const cap = win32capture.make({ run: () => answer, record: rec, now: () => t, ttlMs: 1000, lastState: store,
    log: (name, event, because) => lines.push({ name, event, because }) });
  assert.equal(cap('ada:0.0'), 'busy', 'the board has just started and has no live reading: the remembered state stands in');
  assert.equal(cap.note('ada:0.0').held, true, 'marked as remembered, never as a fresh look');
  assert.match(lines[0].because, /Kosmos has just started/);
  answer = [live('sid-a', 'idle')];
  t += 5000;
  assert.equal(cap('ada:0.0'), 'idle', 'the first live reading replaces it');
  assert.equal(cap.note('ada:0.0'), null);
  assert.deepEqual(store.data.ada.token, 'idle', 'and is what the next start remembers');
  const before = store.writes;
  t += 5000; cap('ada:0.0');
  assert.equal(store.writes, before, 'an unchanged state is not written again');
});

test('#5949 a remembered state from a board that stopped long ago is not used', () => {
  const t0 = Date.parse('2026-10-12T14:20:58Z');
  const store = memoryLastState({ ada: { token: 'busy', at: '2026-10-12T13:00:00Z' } });
  const cap = win32capture.make({ run: () => [{ pid: 2, cwd: '/w', kind: 'interactive', startedAt: 1, sessionId: 'sid-a', name: 'x' }],
    record: rec, now: () => t0, lastState: store, log: () => {} });
  assert.equal(cap('ada:0.0'), null);
  assert.equal(cap.note('ada:0.0').unreadable, true);
});

test('#5949 fileLastState keeps the states on disk under the store root, and reads a missing or broken file as none', () => {
  const fls = win32capture.fileLastState();
  assert.deepEqual(fls.read(), {});
  fls.write({ ada: { token: 'idle', at: '2026-10-12T14:20:50Z' } });
  assert.deepEqual(win32capture.fileLastState().read(), { ada: { token: 'idle', at: '2026-10-12T14:20:50Z' } });
  fs.writeFileSync(nodePath.join(require('./store').ROOT, 'win32-laststate.json'), '\0\0\0');
  assert.deepEqual(fls.read(), {}, 'a torn file is none, never a throw');
});

test('#5949 code that acts because an agent is idle waits for a fresh look, not a remembered one', () => {
  const assigner = require('./assigner');
  const chat = require('./chat');
  /* A real card from the real producer (fixture-discipline), copied so the field can be added. */
  const fleet = require('../test-support/fleet');
  const board = fleet.install([fleet.agent('eve', { state: 'idle' })], { strict: false });
  let card;
  try { card = { ...board.card('eve') }; } finally { board.restore(); }
  assert.equal(card.state, 'idle', 'CONTROL: the fleet card reads idle');
  assert.equal(assigner.idleCard(card), true, 'CONTROL: a fresh idle card is one the Assigner may use');
  assert.equal(assigner.idleCard({ ...card, screenRead: 'remembered' }), false);
  assert.equal(status.stateIsRemembered({ ...card, stateRead: 'unreadable' }), false, 'a card that could not be read holds nothing');
  assert.equal(status.stateIsRemembered(card), false);
  const limited = { ...card, runner: 'claude' };
  assert.equal(chat.limitable(limited), true, 'CONTROL: a Claude card of ours is one a limit can hold');
  assert.equal(chat.limitReleased(limited), true, 'CONTROL: a fresh idle releases its backlog');
  assert.equal(chat.limitReleased({ ...limited, screenRead: 'remembered' }), false);
  /* The limit wait's other arm: a REPORTED blocked that carries the screen's reading along. */
  const waiting = { ...limited, state: 'blocked', screenState: 'idle' };
  assert.equal(chat.limitReleased(waiting), true, 'CONTROL: a blocked limit report over an idle screen releases');
  assert.equal(chat.limitReleased({ ...waiting, screenRead: 'remembered' }), false, 'not when that screen is remembered');
});

test('#5949 the carry is aged on when a state was last SEEN: an agent idle all morning still carries', () => {
  const store = memoryLastState({});
  let t = Date.parse('2026-10-12T08:00:00Z');
  let answer = [live('sid-a', 'idle')];
  const cap = win32capture.make({ run: () => answer, record: rec, now: () => t, ttlMs: 1000, lastState: store, log: () => {} });
  cap('ada:0.0');
  assert.equal(store.data.ada.at, '2026-10-12T08:00:00.000Z', 'written on the first reading');
  /* Idle, unchanged, read every 5 s until 09:20:50. */
  for (t += 5000; t <= Date.parse('2026-10-12T09:20:50Z'); t += 5000) cap('ada:0.0');
  const seen = Date.parse(store.data.ada.at);
  assert.ok(Date.parse('2026-10-12T09:20:50Z') - seen <= 60 * 1000, 'confirmed within the last minute, not stuck at 08:00: ' + store.data.ada.at);
  assert.ok(store.writes < 90, 'and confirmed about once a minute, not on every read (' + store.writes + ' writes)');
  /* The board restarts for an update; the new board's first look has no usable token yet. */
  const next = win32capture.make({ run: () => [{ pid: 2, cwd: '/w', kind: 'interactive', startedAt: 1, sessionId: 'sid-a', name: 'x' }],
    record: rec, now: () => Date.parse('2026-10-12T09:20:58Z'), lastState: memoryLastState(store.data), log: () => {} });
  assert.equal(next('ada:0.0'), 'idle', 'carried: it was seen seconds before the restart');
  assert.equal(next.note('ada:0.0').held, true);
});

test('#5949 an agent a good read no longer lists drops out of the remembered file once too old to carry', () => {
  const store = memoryLastState({ gone: { token: 'busy', at: '2026-10-12T07:00:00Z' }, recent: { token: 'idle', at: '2026-10-12T09:19:00Z' } });
  const cap = win32capture.make({ run: () => [live('sid-a', 'idle')], record: rec, now: () => Date.parse('2026-10-12T09:21:00Z'),
    lastState: store, log: () => {} });
  cap('ada:0.0');
  assert.equal('gone' in store.data, false, 'an old entry for an agent no longer running is dropped');
  assert.equal('recent' in store.data, true, 'a recent one stays: it may be an agent still starting');
  assert.equal(store.data.ada.token, 'idle');
});

test('#5949 a failed capture look served after a newer good roster read: the card is held and marked, counted once', () => {
  /* cy: no other test leaves a self-report for it, so the card reads the capture alone. */
  let answer = [live('sid-c', 'busy')];
  let t = 1000;
  const run = () => answer;
  const lines = [];
  const cap = win32capture.make({ run, record: rec, now: () => t, ttlMs: 1000, log: (name, event) => lines.push(event) });
  status.setPaneSource(win32roster.make({ run, record: rec, now: () => t }));
  status.setPaneCapture(cap);
  try {
    status.snapshot();
    answer = null;
    t += 5000;
    cap('cy:0.0');   // another caller looks while the read is failing: the capture's memo now holds a failed look
    answer = [live('sid-c', 'idle')];
    t += 500;         // inside the memo window: the roster reads the newer good list, the capture serves its memo
    const a = status.snapshot().agents.find((x) => x.sessionName === 'cy');
    assert.equal(a.state, status.STATE.WORKING, 'the held token, not the newer idle the roster saw');
    assert.equal(a.stateRead, 'remembered', 'and marked as remembered, never as a fresh look');
    assert.deepEqual(lines, ['status-read-failed'], 'one failed look counted once, however often it is served');
    t += 1500;
    const b = status.snapshot().agents.find((x) => x.sessionName === 'cy');
    assert.equal(b.state, status.STATE.IDLE, 'the next memo window reads fresh');
    assert.equal('stateRead' in b, false);
  } finally {
    status.setPaneSource(null);
    status.setPaneCapture(null);
  }
});

test('#5949 a failed Claude read while a codex agent is up holds the Claude cards (it is not "no Claude agents")', () => {
  const codexRow = { pid: 9, cwd: '/w', kind: 'interactive', startedAt: 1, sessionId: 'sid-x', name: 'x' };
  const record = { read: () => ({ 'sid-c': { name: 'cy', runner: 'claude' }, 'sid-x': { name: 'cx', runner: 'codex' } }) };
  let claude = [live('sid-c', 'busy')];
  let t = 1000;
  const lines = [];
  /* The live map win32live builds: the claude rows when the read answers, plus the codex row either way. */
  const run = () => claude;
  const cap = win32capture.make({ run, record, now: () => t, ttlMs: 1000, problem: () => 'the status read timed out after 15 s',
    streamState: () => 'idle', log: (name, event, because) => lines.push({ name, event, because }) });
  const win32live = require('./win32live');
  const realByName = win32live.byName;
  win32live.byName = (o) => realByName({ ...o, codexLive: () => [codexRow] });
  try {
    assert.equal(cap('cy:0.0'), 'busy');
    claude = null;
    t += 5000;
    assert.equal(cap('cy:0.0'), 'busy', 'held, not forgotten');
    assert.deepEqual(cap.note('cy:0.0'), { held: true, cause: 'the status read timed out after 15 s' });
    assert.equal(cap('cx:0.0'), 'idle', 'CONTROL: the codex agent is read as usual');
    assert.ok(lines.some((l) => l.name === 'cy' && l.event === 'status-read-failed'));
  } finally {
    win32live.byName = realByName;
  }
});

test('#5949 after the first good read, an agent that starts again does not wear its past session\'s state', () => {
  const store = memoryLastState({ ada: { token: 'busy', at: new Date(1000).toISOString() } });
  let t = 2000;
  let answer = [live('sid-b', 'idle')];   // the first good read: ada is not running
  const cap = win32capture.make({ run: () => answer, record: rec, now: () => t, ttlMs: 1000, lastState: store, log: () => {} });
  cap('bob:0.0');
  /* ada is relaunched: a new session with no state yet. */
  answer = [live('sid-b', 'idle'), { pid: 3, cwd: '/w', kind: 'interactive', startedAt: 2, sessionId: 'sid-a', name: 'x' }];
  t += 5000;
  assert.equal(cap('ada:0.0'), null, 'no carried state for a start after the board was already reading');
  assert.equal(cap.note('ada:0.0').unreadable, true);
});

test('#5949 a changing state is written at most once every few seconds', () => {
  const store = memoryLastState({});
  let t = 0;
  /* Flips on every look (keyed on the clock, so it does not depend on how often run() is asked). */
  const cap = win32capture.make({ run: () => [live('sid-a', Math.floor(t / 1100) % 2 ? 'busy' : 'idle')], record: rec, now: () => t, ttlMs: 1000, lastState: store, log: () => {} });
  for (t = 0; t < 30000; t += 1100) cap('ada:0.0');
  assert.ok(store.writes <= 7, 'flips every look for 30 s: ' + store.writes + ' writes');
  assert.ok(store.writes >= 2, 'CONTROL: it does write');
});


/* A report aged past REPORT_WORKING_DECAY_MS, as six minutes of quiet after an automatic "working" would leave it. */
function staleWorkingReport(name) {
  const selfreport = require('./selfreport');
  const r = selfreport.record(name, { state: 'working', because: 'answering a prompt', auto: true });
  assert.equal(r.recorded, true, 'CONTROL: the working report was recorded');
  const file = selfreport.fileFor(name);
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n');
  const last = JSON.parse(rows[rows.length - 1]);
  last.at = new Date(Date.now() - status.REPORT_WORKING_DECAY_MS - 60 * 1000).toISOString();
  rows[rows.length - 1] = JSON.stringify(last);
  fs.writeFileSync(file, rows.join('\n') + '\n');
}

test('#5949 a HELD idle for a per-turn runner never ends a stale working report (only a state file read this tick does)', () => {
  staleWorkingReport('coder');
  const record = { read: () => ({ 'sid-o': { name: 'coder', runner: 'codex' } }) };
  const row = { pid: 4242, cwd: '/w', kind: 'interactive', startedAt: 1, sessionId: 'sid-o', name: 'coder', runner: 'codex' };
  let token = 'idle';
  let t = 1000;
  status.setPaneSource(win32roster.make({ run: () => [row], record, codexLive: () => [] }));
  status.setPaneCapture(win32capture.make({ run: () => [row], record, now: () => t, ttlMs: 1000, streamState: () => token, log: () => {} }));
  try {
    const card = () => status.snapshot().agents.find((a) => a.sessionName === 'coder');
    const fresh = card();
    assert.equal(fresh.state, status.STATE.IDLE, 'CONTROL: its state file read this tick says idle, which ends the stale report');
    assert.equal('stateRead' in fresh, false, 'CONTROL: a fresh look adds no field');

    token = null;   // the state file stops matching for a moment (a relaunch), so the capture holds its last idle
    t += 5000;
    const held = card();
    assert.equal(held.screenRead, 'remembered', 'the capture is holding');
    assert.equal(held.state, status.STATE.UNKNOWN, 'a remembered idle is not the supervisor\'s record that no turn is running');
    assert.equal(held.stateRead, 'unreadable', 'and the card carries the hover\'s why');
  } finally {
    status.setPaneSource(null);
    status.setPaneCapture(null);
  }
});

test('#5949 a stale working report over a failed look is marked unreadable, not left unexplained', () => {
  staleWorkingReport('kai');
  const kaiRec = { read: () => ({ 'sid-k': { name: 'kai', runner: 'claude' } }) };
  const agents = [live('sid-k', 'idle')];
  status.setPaneSource(win32roster.make({ run: () => agents, record: kaiRec, codexLive: () => [] }));
  status.setPaneCapture(win32capture.make({ run: () => null, record: kaiRec, log: () => {} }));
  try {
    const a = status.snapshot().agents.find((x) => x.sessionName === 'kai');
    assert.equal(a.state, status.STATE.UNKNOWN);
    assert.equal(a.stateRead, 'unreadable');
  } finally {
    status.setPaneSource(null);
    status.setPaneCapture(null);
  }
  /* CONTROL: the same report over a look that worked carries no mark (a Windows Claude idle cannot end it either). */
  status.setPaneSource(win32roster.make({ run: () => agents, record: kaiRec, codexLive: () => [] }));
  status.setPaneCapture(win32capture.make({ run: () => agents, record: kaiRec, log: () => {} }));
  try {
    const a = status.snapshot().agents.find((x) => x.sessionName === 'kai');
    assert.equal(a.state, status.STATE.UNKNOWN);
    assert.equal('stateRead' in a, false);
  } finally {
    status.setPaneSource(null);
    status.setPaneCapture(null);
  }
});
