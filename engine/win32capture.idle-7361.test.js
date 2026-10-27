'use strict';
/**
 * #7361: a new Windows agent's card stayed "working" for five minutes after its first reply (the 0.7.71 V2 run). Its
 * first turn's hook wrote the automatic `working` and the Stop hook's `idle` never landed; the supervisor's stream file
 * DID say idle when the turn's `result` came, but a Windows Claude idle never carried classify's liveToken (#5949 kept
 * it for per-turn runners, on the reading that a Claude idle came from `claude agents --json`, which also reads idle
 * while a session waits). Every agent Kosmos starts is a streaming session, so its idle comes from the stream.
 *
 * Pinned here:
 *   1. the stream file's idle reaches the card as proof the turn ended: a fresh automatic `working` written BEFORE it
 *      reads idle (end to end: the real publisher writes the file, the real stateFor and capture read it, snapshot)
 *   2. controls: the same report over an `agents --json` idle stays working; over a busy stream stays working; a
 *      `working` written AFTER the stream's idle (a new turn not yet seen, a background heartbeat) stays working; the
 *      agent's own (not automatic) `working` stays working
 *   3. a HELD (remembered) stream idle ends no report
 *   4. the token itself: stateFor answers `stream-idle <at>` only when asked, and a sign-in refusal's idle stays `auth`
 *
 * No real board or agent is touched; the store root is a throwaway folder.
 *
 *   node --test engine/win32capture.idle-7361.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'idle-7361-'));
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const status = require('./status');
const selfreport = require('./selfreport');
const win32roster = require('./win32roster');
const win32capture = require('./win32capture');
const win32streamstate = require('./win32streamstate');

/* The report and the stream's idle are compared by their times, so each step is a few ms apart. */
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

let nextPid = 7000;
/* One Windows Claude agent: its ownership record and its live row (a streaming session lists no status unless `listed`
   is given, as an interactive one would). */
function agent(name, listed) {
  const pid = nextPid++;
  const sid = 'sid-' + name;
  const record = { read: () => ({ [sid]: { name, runner: 'claude' } }) };
  const row = { pid, cwd: '/w', kind: 'interactive', startedAt: 1, sessionId: sid, name, ...(listed ? { status: listed } : {}) };
  /* The real supervisor's publisher, writing the real state file the real stateFor reads. */
  const stream = win32streamstate.publisher(name, { setTimer: () => {} });
  stream.started(pid, sid);
  return { name, record, row, stream };
}

function onBoard(a, capOpts) {
  status.setPaneSource(win32roster.make({ run: () => [a.row], record: a.record, codexLive: () => [] }));
  const cap = capOpts && capOpts.capture ? capOpts.capture : win32capture.make({ run: () => [a.row], record: a.record, log: () => {} });
  status.setPaneCapture(cap);
  try { return status.snapshot().agents.find((x) => x.sessionName === a.name); } finally {
    status.setPaneSource(null);
    status.setPaneCapture(null);
  }
}

function report(name, state, auto) {
  const r = selfreport.record(name, { state, because: 'answering a prompt', ...(auto ? { auto: true } : {}) });
  assert.equal(r.recorded, true, 'CONTROL: the ' + state + ' report was recorded (' + JSON.stringify(r) + ')');
}

/* A first turn: the message is written (busy), the hook's automatic working lands, the turn ends (result) and the Stop
   hook's idle never does. */
function firstTurnWithoutStop(a, auto) {
  a.stream.event({ type: 'system', subtype: 'init' });
  pause(5);
  report(a.name, 'working', auto !== false);
  pause(5);
  a.stream.event({ type: 'result', subtype: 'success', is_error: false });
}

test('#7361 END TO END: a fresh automatic working from a turn that has ended reads Idle off the stream file', () => {
  const a = agent('ann');
  firstTurnWithoutStop(a);
  const card = onBoard(a);
  assert.ok(card, 'the agent is on the board');
  assert.equal(card.state, status.STATE.IDLE, 'its stream said the turn ended after the report was written');
});

test('#7361 CONTROL: the same report over an `agents --json` idle stays working (it also reads idle while waiting)', () => {
  const a = agent('roo', 'idle');
  firstTurnWithoutStop(a);
  const card = onBoard(a);
  assert.ok(card, 'the agent is on the board');
  assert.equal(card.state, status.STATE.WORKING, 'unchanged for a listed idle until the report decays');
});

test('#7361 CONTROL: the same report over a busy stream stays working', () => {
  const a = agent('cat');
  a.stream.event({ type: 'system', subtype: 'init' });
  pause(5);
  report(a.name, 'working', true);
  const card = onBoard(a);
  assert.equal(card.state, status.STATE.WORKING);
});

test('#7361 CONTROL: an automatic working written AFTER the stream went idle stays working (a turn the file has not caught up with)', () => {
  const a = agent('dan');
  a.stream.event({ type: 'system', subtype: 'init' });
  a.stream.event({ type: 'result', subtype: 'success', is_error: false });
  pause(5);
  report(a.name, 'working', true);
  assert.equal(onBoard(a).state, status.STATE.WORKING);
});

test('#7361 CONTROL: the agent\'s own (not automatic) working outranks the stream\'s idle, as before', () => {
  const a = agent('eva');
  firstTurnWithoutStop(a, false);
  assert.equal(onBoard(a).state, status.STATE.WORKING);
});

test('#7361 a HELD stream idle ends no report (a remembered reading is not a look this tick)', () => {
  const a = agent('fay');
  firstTurnWithoutStop(a);
  let up = true;
  const cap = win32capture.make({ run: () => (up ? [a.row] : null), record: a.record, ttlMs: 0, log: () => {} });
  assert.equal(onBoard(a, { capture: cap }).state, status.STATE.IDLE, 'CONTROL: read live, the stream idle ends the report');
  up = false;   // the next look fails: the capture holds the stream idle it read
  assert.ok(win32streamstate.isStreamIdleToken(cap('fay:0.0')), 'CONTROL: the held token is the stream idle');
  assert.deepEqual(cap.note('fay:0.0') && cap.note('fay:0.0').held, true, 'CONTROL: and it is held');
  const card = onBoard(a, { capture: cap });
  /* Kept by #5949's rule that a held reading is first left out of reconcileReport; the stale case below is the one
     the liveToken strip in snapshot keeps. */
  assert.equal(card.state, status.STATE.WORKING, 'held, it cannot end the fresh working report');
});

/* Six minutes of quiet on the agent's latest report, as in win32codexsup.idle-5949.test.js. */
function ageLatestReport(name) {
  const file = selfreport.fileFor(name);
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  const last = JSON.parse(lines[lines.length - 1]);
  last.at = new Date(Date.now() - status.REPORT_WORKING_DECAY_MS - 60 * 1000).toISOString();
  lines[lines.length - 1] = JSON.stringify(last);
  fs.writeFileSync(file, lines.join('\n') + '\n');
}

test('#7361 a HELD stream idle does not end a stale automatic working either (it says it cannot check)', () => {
  const a = agent('gil');
  firstTurnWithoutStop(a);
  ageLatestReport(a.name);
  let up = true;
  const cap = win32capture.make({ run: () => (up ? [a.row] : null), record: a.record, ttlMs: 0, log: () => {} });
  assert.equal(onBoard(a, { capture: cap }).state, status.STATE.IDLE, 'CONTROL: read live, the stream idle ends the stale report');
  up = false;
  const card = onBoard(a, { capture: cap });
  assert.equal(card.screenRead, 'remembered', 'CONTROL: the reading was held');
  assert.equal(card.state, status.STATE.UNKNOWN, 'held, the stream idle is a memory, not proof');
});

test('#7361 reconcileReport: only a liveToken idle with a time AFTER an automatic working report ends it', () => {
  const now = Date.now();
  const at = new Date(now - 60 * 1000).toISOString();
  const auto = { found: true, state: 'working', at, by: 'auto', because: 'answering a prompt' };
  const idle = { state: status.STATE.IDLE, confidence: status.CONFIDENCE.SCRAPED, because: 'it is idle at its prompt' };
  const after = new Date(now - 30 * 1000).toISOString();
  const before = new Date(now - 90 * 1000).toISOString();
  const r = status.reconcileReport(auto, { ...idle, liveToken: true, liveIdleSince: after }, now);
  assert.equal(r.state, status.STATE.IDLE);
  assert.equal(r.liveToken, undefined, 'the proof is not carried onto the card');
  assert.equal(r.liveIdleSince, undefined);
  assert.equal(status.reconcileReport(auto, { ...idle, liveToken: true, liveIdleSince: before }, now).state, status.STATE.WORKING, 'idle before the report');
  assert.equal(status.reconcileReport(auto, { ...idle, liveToken: true }, now).state, status.STATE.WORKING, 'idle with no time');
  assert.equal(status.reconcileReport(auto, { ...idle, liveIdleSince: after }, now).state, status.STATE.WORKING, 'no liveToken (a held reading)');
  assert.equal(status.reconcileReport({ ...auto, by: 'agent' }, { ...idle, liveToken: true, liveIdleSince: after }, now).state, status.STATE.WORKING, 'the agent\'s own word');
});

test('#7361 stateFor answers `stream-idle <at>` only when asked; busy, limit and auth are unchanged', () => {
  const a = agent('hal');
  const live = { pid: a.row.pid, sessionId: a.row.sessionId };
  assert.equal(win32streamstate.stateFor('hal', live), 'idle', 'unchanged without the option');
  const t = win32streamstate.stateFor('hal', live, undefined, { streamIdle: true });
  assert.ok(win32streamstate.isStreamIdleToken(t), t);
  assert.ok(win32streamstate.streamIdleSince(t), 'with the file\'s time');
  a.stream.event({ type: 'system', subtype: 'init' });
  assert.equal(win32streamstate.stateFor('hal', live, undefined, { streamIdle: true }), 'busy');
  assert.equal(win32streamstate.isStreamIdleToken('auth 2026-10-27T17:00:00.000Z idle'), false, 'a refused turn\'s idle is the sign-in\'s');
  assert.equal(win32streamstate.isStreamIdleToken('idle'), false);
});
