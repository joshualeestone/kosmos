'use strict';
/**
 * #3016: an OLDER Kosmos.exe hands off to the NEWER copy instead of taking the fleet.
 *
 * 🛑 NO REAL schtasks, NO REAL BOARD. The board's task ops, the port probe, the clock
 * and the environment are injected, so a Mac exercises this and no suite ends or starts
 * a real board. The downgrade path must NEVER end or replace the running board -- doing
 * so would let the older build take over, the exact defect this guards.
 *
 *   node --test engine/win32handoff.downgrade-3016.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { handOffToTask } = require('./win32handoff');

const NEWER = '0.6.60@';
const DOWNGRADE = { ok: true, action: 'left-newer', downgrade: true };

/* A fake world: a port whose occupant can appear after `/Run`, a clock that sleeping
   advances, and a record of every board op. */
function world({ occupant = null, taskRunning = false, starts = null } = {}) {
  const w = { t: 0, occupant, taskRunning, ops: [] };
  w.board = {
    status: () => ({ registered: true, enabled: true, running: w.taskRunning }),
    end: () => { w.ops.push('end'); return { ok: true }; },
    runNow: () => {
      w.ops.push('run');
      if (!w.taskRunning && starts !== null) { w.taskRunning = true; w.pending = { at: w.t + 1200, id: starts }; }
      return { ok: true };
    },
  };
  w.probe = async () => {
    w.ops.push('probe');
    if (w.pending && w.t >= w.pending.at) { w.occupant = w.pending.id; w.pending = null; }
    return w.occupant === null
      ? { answering: false, identity: null, startedByTask: null, outcome: 'refused' }
      : { answering: true, identity: w.occupant, startedByTask: true, outcome: 'answered' };
  };
  w.sleep = async (ms) => { w.ops.push('sleep'); w.t += ms; };
  w.now = () => w.t;
  /* A world-attempt stub so the hand-off touches no real world state. */
  const worlds = { worldenv: { bootedBaseDir() { return null; }, bootedWorld() { return ''; } },
    guard: { retractAttempt() { return false; }, recordAttempt() {} } };
  w.opts = (extra) => Object.assign({
    platform: 'win32', env: {}, port: 16180, identity: '0.6.55@', startedAt: 0,
    ensured: DOWNGRADE, board: w.board, probe: w.probe, sleep: w.sleep, now: w.now, worlds,
  }, extra || {});
  w.taskOps = () => w.ops.filter((o) => o !== 'probe' && o !== 'sleep');
  return w;
}

test('the newer fleet board is already serving: LEAVE it, never end or replace it', async () => {
  const w = world({ occupant: NEWER, taskRunning: true });
  const r = await handOffToTask(w.opts());
  assert.equal(r.serve, false);
  assert.equal(r.exitCode, 0);
  assert.match(r.say, /newer one already installed keeps running/i);
  assert.deepEqual(w.taskOps(), [], 'an older build must never end or /Run over the newer fleet board');
});

test('nothing is up: /Run the task (the kept pointer starts the NEWER engine), then leave', async () => {
  const w = world({ occupant: null, taskRunning: false, starts: NEWER });
  const r = await handOffToTask(w.opts());
  assert.equal(r.serve, false, r.because);
  assert.equal(r.exitCode, 0);
  assert.ok(w.taskOps().includes('run'), 'it starts the newer board the pointer names');
  assert.ok(!w.taskOps().includes('end'), 'it never ends anything on the downgrade path');
});

test('a launch with its own PORT keeps to the launcher; the newer Kosmos keeps running', async () => {
  const w = world({ occupant: NEWER, taskRunning: true });
  const r = await handOffToTask(w.opts({ env: { PORT: '7777' } }));
  assert.equal(r.serve, true);
  assert.equal(r.attempted, false);
  assert.match(r.because, /PORT/);
  assert.deepEqual(w.taskOps(), [], 'an overridden launch touches no board');
});

test('the newer board will not come up at all: fall back to serving here', async () => {
  const w = world({ occupant: null, taskRunning: false, starts: null });
  const r = await handOffToTask(w.opts());
  assert.equal(r.serve, true);
  assert.equal(r.attempted, true);
  assert.match(r.because, /did not answer/i);
  assert.ok(!w.taskOps().includes('end'), 'even the fallback never ends the fleet board');
});
