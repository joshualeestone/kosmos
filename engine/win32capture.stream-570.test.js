'use strict';
/**
 * #570 7c-5: a STREAMING Windows agent's working/idle reaches its card.
 *
 * A streaming session's row in `claude agents --json` has no `status` (measured),
 * so the capture falls back to the state its supervisor keeps from the agent's
 * event stream. These drive the capture directly and END TO END through the real
 * status.snapshot(), with a real state file written by the real publisher.
 *
 *   node --test engine/win32capture.stream-570.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

// Sandbox the data root BEFORE requiring anything that reads the store.
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'win32capture-stream-570-'));
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const status = require('./status');
const win32capture = require('./win32capture');
const win32roster = require('./win32roster');
const win32streamstate = require('./win32streamstate');

/* A STREAMING row exactly as measured on the box: no `status` key at all. */
const streaming = (sessionId, pid, name) => ({ pid, cwd: 'C:\\w', kind: 'interactive', startedAt: 1, sessionId, name });
const recordOf = (map) => ({ read: () => map });

test('#570 7c-5 a status-less row reads the state its supervisor published, joined by name, session and pid', () => {
  const asked = [];
  const cap = win32capture.make({
    run: () => [streaming('sid-1', 11, 'cwd-name')],
    record: recordOf({ 'sid-1': { name: 'raph', runner: 'claude' } }),
    streamState: (name, hit) => { asked.push([name, hit.sessionId, hit.pid]); return 'busy'; },
  });
  assert.equal(cap('raph:0.0'), 'busy');
  assert.deepEqual(asked, [['raph', 'sid-1', 11]], 'asked by the RECORDED name, with the live session and pid');
});

test('#570 7c-5 an interactive session\'s own status still wins over the stream file', () => {
  const cap = win32capture.make({
    run: () => [Object.assign(streaming('sid-2', 12, 'x'), { status: 'idle' })],
    record: recordOf({ 'sid-2': { name: 'ana', runner: 'claude' } }),
    streamState: () => 'busy',
  });
  assert.equal(cap('ana:0.0'), 'idle');
});

test('#570 7c-5 a throwing stream reader is null for that card, never a thrown tick', () => {
  const cap = win32capture.make({
    run: () => [streaming('sid-3', 13, 'x')],
    record: recordOf({ 'sid-3': { name: 'zed', runner: 'claude' } }),
    streamState: () => { throw new Error('disk on fire'); },
  });
  assert.equal(cap('zed:0.0'), null);
});

test('#570 7c-5 END TO END: the real publisher\'s file makes the card WORKING, then IDLE, through the real snapshot', () => {
  const agents = [streaming('sid-e2e', 4321, 'live-cwd-name')];
  const rec = recordOf({ 'sid-e2e': { name: 'winstream', runner: 'claude' } });
  const pub = win32streamstate.publisher('winstream');
  status.setPaneSource(win32roster.make({ run: () => agents, record: rec }));
  /* ttlMs 0: each snapshot is a fresh look, so the second read sees the new file. */
  status.setPaneCapture(win32capture.make({ run: () => agents, record: rec, ttlMs: 0 }));
  try {
    const card = () => status.snapshot().agents.find((a) => a.sessionName === 'winstream');
    assert.equal(card().state, status.STATE.UNKNOWN, 'CONTROL: no file yet, so the card cannot tell');
    pub.started(4321, 'sid-e2e');
    assert.equal(card().state, status.STATE.IDLE, 'started: idle until told something');
    pub.wrote();
    assert.equal(card().state, status.STATE.WORKING, 'a message reached it: working');
    pub.event({ type: 'result', subtype: 'success' });
    assert.equal(card().state, status.STATE.IDLE, 'its turn ended: idle');
  } finally {
    pub.stopped();
    status.setPaneSource(null);
    status.setPaneCapture(null);
  }
});

test('#570 7c-5 END TO END: a file from ANOTHER process under the same session reads UNKNOWN, not its stale state', () => {
  const agents = [streaming('sid-restart', 2002, 'x')];            // the process running NOW
  const rec = recordOf({ 'sid-restart': { name: 'phoenix', runner: 'claude' } });
  const pub = win32streamstate.publisher('phoenix');
  pub.started(2001, 'sid-restart');                                // left by the process before a crash restart
  pub.wrote();
  status.setPaneSource(win32roster.make({ run: () => agents, record: rec }));
  status.setPaneCapture(win32capture.make({ run: () => agents, record: rec, ttlMs: 0 }));
  try {
    const a = status.snapshot().agents.find((x) => x.sessionName === 'phoenix');
    assert.ok(a, 'the live session is on the board');
    assert.equal(a.state, status.STATE.UNKNOWN, 'a stale WORKING from a dead pid never describes the live one');
  } finally {
    pub.stopped();
    status.setPaneSource(null);
    status.setPaneCapture(null);
  }
});
