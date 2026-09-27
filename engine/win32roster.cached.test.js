'use strict';
/**
 * The win32 roster's `claude agents --json` read is shared and kept for a moment,
 * so a request does not stall the board on it.
 *
 * 🛑 WHY. Measured on the fleet's Windows box: the read costs ~230ms, a DM send
 * made three of them back to back and a status poll two, all synchronous on the
 * thread that answers the page. On a slow laptop that queued every request behind
 * the polls and a person's message sat for over a minute. These tests pin the
 * rules of the shared reader: one read per moment for everybody, a stale answer
 * refreshed in the BACKGROUND rather than on the request, and a failed read kept
 * as a failure.
 *
 *   node -r <no-schtasks-preload> --test engine/win32roster.cached.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'win32roster-cached-'));
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');

const win32roster = require('./win32roster');
const win32capture = require('./win32capture');

const LIVE = [{ pid: 1, cwd: 'x', kind: 'interactive', startedAt: 1, sessionId: 'aaaa-1111', name: 'raph', status: 'idle' }];

function clockAt(t0) {
  const c = { t: t0 };
  c.now = () => c.t;
  return c;
}

test('an answer younger than the fresh window is served without asking again', () => {
  const clock = clockAt(1000);
  let sync = 0; let bg = 0;
  const read = win32roster.makeCachedRun({ run: () => { sync += 1; return LIVE; }, runAsync: () => { bg += 1; }, now: clock.now, freshMs: 2000, staleMs: 30000 });
  assert.deepEqual(read(), LIVE);
  clock.t += 1999;
  assert.deepEqual(read(), LIVE);
  assert.equal(sync, 1, 'one synchronous read for the first ask only');
  assert.equal(bg, 0, 'and nothing in the background while it is fresh');
});

test('a stale answer is served AT ONCE and refreshed in the background, one refresh at a time', () => {
  const clock = clockAt(1000);
  let sync = 0;
  const pending = [];
  const read = win32roster.makeCachedRun({ run: () => { sync += 1; return LIVE; }, runAsync: (cb) => { pending.push(cb); }, now: clock.now, freshMs: 2000, staleMs: 30000 });
  read();
  clock.t += 5000;
  assert.deepEqual(read(), LIVE, 'the last answer, without waiting');
  assert.deepEqual(read(), LIVE);
  assert.equal(sync, 1, 'no synchronous read on the request path');
  assert.equal(pending.length, 1, 'exactly one background read, however many ask');
  const next = [{ ...LIVE[0], status: 'busy' }];
  pending[0](next);
  assert.deepEqual(read(), next, 'the background answer is what the next ask gets');
});

test('a cold cache reads synchronously, as before', () => {
  const clock = clockAt(1000);
  let sync = 0; let bg = 0;
  const read = win32roster.makeCachedRun({ run: () => { sync += 1; return LIVE; }, runAsync: () => { bg += 1; }, now: clock.now, freshMs: 2000, staleMs: 30000 });
  read();
  clock.t += 30001;
  read();
  assert.equal(sync, 2, 'an answer older than the stale window is not served; it is read again');
  assert.equal(bg, 0);
});

test('a failed read is kept as a failure, never as the last good list', () => {
  const clock = clockAt(1000);
  const pending = [];
  const read = win32roster.makeCachedRun({ run: () => LIVE, runAsync: (cb) => { pending.push(cb); }, now: clock.now, freshMs: 2000, staleMs: 30000 });
  read();
  clock.t += 5000;
  read();
  pending[0](null);
  assert.equal(read(), null, '"we could not look" reaches the caller as itself');
});

test('the roster source and the live-state source share ONE read by default', () => {
  /* The real default wiring, with `claude` pointed at node running a script that
     counts its own runs. On the old code the source and the capture each spawned
     their own read, and a second source call spawned again: three. */
  const dir = fs.mkdtempSync(nodePath.join(SANDBOX, 'bin-'));
  const counter = nodePath.join(dir, 'count.txt');
  fs.writeFileSync(nodePath.join(dir, 'agents'),
    'require("fs").appendFileSync(' + JSON.stringify(counter) + ', "x"); process.stdout.write("[]");\n');
  const before = process.cwd();
  const bin = process.env.AGENT_WORKFORCE_CLAUDE_BIN;
  process.chdir(dir);
  process.env.AGENT_WORKFORCE_CLAUDE_BIN = process.execPath;
  try {
    win32roster.cachedRun.forget();
    const source = win32roster.make();
    const capture = win32capture.make();
    assert.equal(source(), '', 'the source answered (an empty machine)');
    capture('raph:0.0');
    source();
    const runs = fs.existsSync(counter) ? fs.readFileSync(counter, 'utf8').length : 0;
    assert.equal(runs, 1, 'one `claude agents --json` for a source read, a capture and a second source read');
  } finally {
    process.chdir(before);
    if (bin === undefined) delete process.env.AGENT_WORKFORCE_CLAUDE_BIN; else process.env.AGENT_WORKFORCE_CLAUDE_BIN = bin;
    win32roster.cachedRun.forget();
  }
});

test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
