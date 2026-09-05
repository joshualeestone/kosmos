'use strict';
/**
 * #570: the win32 live-STATE source (the `capture-pane` analog). win32capture
 * joins the ownership record (recorded-name <-> sessionId) with `claude agents
 * --json` (sessionId <-> status) to answer a pane's live status, and classify()'s
 * win32 arm maps that token to a STATE. These tests drive the join directly AND
 * run it end-to-end through the REAL status.js (parsePanes -> classify ->
 * reconcileReport via snapshot), so what the capture produces is exactly what the
 * board reads.
 *
 *   node --test engine/win32capture.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

// Sandbox data root BEFORE requiring anything that reads the store, so neither
// the real ownership record nor real self-reports leak into these tests.
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'win32capture-570-'));
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');

const status = require('./status');
const win32capture = require('./win32capture');
const win32roster = require('./win32roster');

// A live `claude agents --json` row (interactive). NOTE the live `name` is the
// cwd-derived one Claude picks, DELIBERATELY different from the recorded Kosmos
// name, to prove the join goes through the sessionId and not the name.
const live = (sessionId, status, name) =>
  ({ pid: 1, cwd: '/w', kind: 'interactive', startedAt: 1, sessionId, name, status });

// The ownership record shape win32sessions.read() returns: sessionId -> {name,...}.
const recordOf = (map) => ({ read: () => map });

test('#570 capture joins recorded-name -> sessionId -> live status (NOT by live name)', () => {
  const cap = win32capture.make({
    run: () => [live('sid-1', 'busy', 'raph-cwdname')],
    record: recordOf({ 'sid-1': { name: 'raph-9a', runner: 'claude' } }),
  });
  // target is `${session}:${pane}` and win32roster emits session = RECORDED name.
  assert.equal(cap('raph-9a:0.0'), 'busy',
    'status found by joining the recorded name through the sessionId to the live row');
  // The live cwd-name is NOT how the board addresses it, so it must not resolve.
  assert.equal(cap('raph-cwdname:0.0'), null,
    'the live cwd-derived name is not the recorded name and must not join');
});

test('#570 an UNRECORDED live session has no capture (fail-closed parity with the roster)', () => {
  const cap = win32capture.make({
    run: () => [live('sid-op', 'busy', 'agent1-d2')],   // operator's own, not recorded
    record: recordOf({}),
  });
  assert.equal(cap('agent1-d2:0.0'), null, 'an unrecorded session yields no status');
});

test('#570 a FAILED live read refuses with null, never a state', () => {
  const cap = win32capture.make({
    run: () => null,   // claude agents --json unreadable
    record: recordOf({ 'sid-1': { name: 'raph-9a' } }),
  });
  assert.equal(cap('raph-9a:0.0'), null, 'a failed read is null (classify -> UNKNOWN), not a guessed idle');
});

test('#570 one read per TTL window: per-pane calls in a tick share a single agents --json read', () => {
  let reads = 0;
  let clock = 1000;
  const cap = win32capture.make({
    run: () => { reads++; return [live('sid-1', 'busy', 'x'), live('sid-2', 'idle', 'y')]; },
    record: recordOf({ 'sid-1': { name: 'a' }, 'sid-2': { name: 'b' } }),
    now: () => clock,
    ttlMs: 1500,
  });
  cap('a:0.0'); cap('b:0.0'); cap('a:0.0');
  assert.equal(reads, 1, 'three per-pane calls in one tick = one read');
  clock += 2000;   // past the TTL
  cap('a:0.0');
  assert.equal(reads, 2, 'a call past the TTL re-reads');
});

test('#570 END TO END: a win32 pane classifies working/idle through REAL snapshot (no self-report -> scrape stands)', () => {
  const agents = [
    live('sid-work', 'busy', 'work-cwd'),
    live('sid-idle', 'idle', 'idle-cwd'),
    live('sid-op', 'busy', 'agent1-d2'),   // operator's own, unrecorded -> invisible
  ];
  const record = {
    'sid-work': { name: 'worker-7', runner: 'claude' },
    'sid-idle': { name: 'idler-3', runner: 'claude' },
  };
  // Wire BOTH seams from the SAME fixtures, exactly as server.js wires them on win32.
  // Both take the same injected record so the roster's fail-closed filter and the
  // capture's join agree by construction (in production both read the one real store).
  const rec = { read: () => record };
  status.setPaneSource(win32roster.make({ run: () => agents, record: rec }));
  status.setPaneCapture(win32capture.make({ run: () => agents, record: rec }));
  try {
    const board = status.snapshot();
    const work = board.agents.find((a) => a.sessionName === 'worker-7');
    const idle = board.agents.find((a) => a.sessionName === 'idler-3');
    const op = board.agents.find((a) => a.sessionName === 'agent1-d2');
    assert.ok(work, 'the recorded busy session is on the board');
    assert.equal(work.state, status.STATE.WORKING, 'busy -> working, through the real classify + reconcileReport');
    assert.ok(idle, 'the recorded idle session is on the board');
    assert.equal(idle.state, status.STATE.IDLE, 'idle -> idle');
    assert.equal(op, undefined, 'the unrecorded operator session never reaches the board (roster fail-closed)');
  } finally {
    status.setPaneSource(null);
    status.setPaneCapture(null);
  }
});

test('#570 END TO END: a win32 pane whose live read fails reads UNKNOWN, not stopped/idle', () => {
  const agents = [live('sid-1', 'busy', 'x')];
  const record = { 'sid-1': { name: 'lonely-1', runner: 'claude' } };
  const rec = { read: () => record };
  status.setPaneSource(win32roster.make({ run: () => agents, record: rec }));   // roster sees it (live+recorded)
  status.setPaneCapture(win32capture.make({ run: () => null, record: rec }));    // capture read FAILS
  try {
    const board = status.snapshot();
    const a = board.agents.find((x) => x.sessionName === 'lonely-1');
    assert.ok(a, 'the session is still on the board (the roster read succeeded)');
    assert.equal(a.state, status.STATE.UNKNOWN, 'a failed state read is UNKNOWN, never a confident idle/stopped');
  } finally {
    status.setPaneSource(null);
    status.setPaneCapture(null);
  }
});
