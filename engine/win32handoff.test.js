'use strict';
/**
 * #570: a board started by hand from the Windows zip hands itself to its logon
 * task instead of serving from the launcher's window.
 *
 * 🛑 NO REAL schtasks, NO REAL BOARD. The board's task ops, the port probe, the
 * clock, the environment and the platform are all injected, so a Mac asserts the
 * Windows arm and no suite ever starts or ends a real board. The two probe tests
 * use a throwaway local server on an ephemeral port.
 *
 *   node --test engine/win32handoff.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const http = require('node:http');

const { handOffToTask, buildIdentity, BOARD_BUILD_HEADER } = require('./win32handoff');

const REFRESHED = { ok: true, action: 'refreshed' };
const MINE = '0.6.55+6182640d6a1f';
const OLDER = '0.6.55+2f841189aaaa';
const BUDGET = 14000;

/* A fake world: a clock that sleeping advances, a port whose occupant changes as
   the task is ended and run, and a record of every task op in order.
   occupant: null = nothing on the port; '' = a board with no build header;
   any other string = the build that board names. */
function world({ occupant = null, taskRunning = false, starts = MINE, runOk = true, endFrees = true } = {}) {
  const w = { t: 0, occupant, taskRunning, ops: [], probes: 0 };
  w.board = {
    status: () => ({ registered: true, enabled: true, running: w.taskRunning }),
    end: () => {
      w.ops.push('end');
      if (w.taskRunning && endFrees) { w.taskRunning = false; w.occupant = null; }
      return { ok: true };
    },
    runNow: () => {
      w.ops.push('run');
      if (!runOk) return { ok: false, because: 'we could not start the board (access denied)' };
      /* IgnoreNew: a run while the task runs starts nothing new. */
      if (!w.taskRunning && starts !== null) { w.taskRunning = true; w.pending = { at: w.t + 1200, build: typeof starts === 'function' ? starts() : starts }; }
      return { ok: true };
    },
  };
  w.probe = async () => {
    w.probes++;
    if (w.pending && w.t >= w.pending.at) { w.occupant = w.pending.build; w.pending = null; }
    return w.occupant === null ? { answering: false, build: null } : { answering: true, build: w.occupant || null };
  };
  w.sleep = async (ms) => { w.ops.push('sleep:' + ms); w.t += ms; };
  w.now = () => w.t;
  w.opts = (extra) => Object.assign({
    platform: 'win32', env: {}, byTask: false, bundle: true, live: true, ensured: REFRESHED,
    port: 16180, build: MINE, startedAt: 0,
    board: w.board, probe: w.probe, sleep: w.sleep, now: w.now,
  }, extra || {});
  w.taskOps = () => w.ops.filter((o) => !o.startsWith('sleep'));
  return w;
}

// ── when no hand-off is due, nothing is touched ────────────────────────────

for (const [name, extra, why] of [
  ['a Mac', { platform: 'darwin' }, /not Windows/],
  ['the task\'s own board', { byTask: true }, /logon task started/],
  ['a source checkout', { bundle: false }, /source checkout/],
  ['an unarmed process', { live: false }, /not armed/],
  ['a launch with its own PORT', { env: { PORT: '17000' } }, /sets PORT/],
  ['a launch with its own data folder', { env: { AGENT_WORKFORCE_HOME: 'C:\\sandbox' } }, /sets AGENT_WORKFORCE_HOME/],
  ['a task the person switched off', { ensured: { ok: true, action: 'left-disabled' } }, /left-disabled/],
  ['a task the person removed', { ensured: { ok: false, action: 'left-removed' } }, /left-removed/],
  ['a registration that failed', { ensured: { ok: false, action: 'failed', because: 'x' } }, /failed/],
  ['no ensureInstalled answer', { ensured: null }, /unknown/],
]) {
  test('no hand-off for ' + name + ': serve here and touch nothing', async () => {
    const w = world({ occupant: MINE, taskRunning: true });
    const r = await handOffToTask(w.opts(extra));
    assert.equal(r.serve, true);
    assert.equal(r.attempted, false, 'a skipped hand-off must not print the "could not move" line');
    assert.match(r.because, why);
    assert.deepEqual(w.ops, [], 'nothing may be ended or run');
    assert.equal(w.probes, 0, 'not even a probe');
  });
}

test('an empty PORT is no override', async () => {
  const w = world();
  const r = await handOffToTask(w.opts({ env: { PORT: '' } }));
  assert.equal(r.serve, false);
});

test('under node --test, live execution is not armed, and the real default says so', async () => {
  const w = world();
  const opts = w.opts();
  delete opts.live;
  const r = await handOffToTask(opts);
  assert.equal(r.serve, true);
  assert.match(r.because, /not armed/);
  assert.deepEqual(w.ops, []);
});

test('a freshly registered task is handed off to, the same as a refreshed one', async () => {
  const w = world();
  const r = await handOffToTask(w.opts({ ensured: { ok: true, action: 'registered' } }));
  assert.equal(r.serve, false);
  assert.deepEqual(w.taskOps(), ['run']);
});

// ── the ordinary cases ──────────────────────────────────────────────────────

test('first run: nothing answers, the task is run, and this board leaves once the task\'s board answers', async () => {
  const w = world();
  const r = await handOffToTask(w.opts());
  assert.equal(r.serve, false);
  assert.equal(r.exitCode, 0, 'exit 0, so the launcher closes its window instead of holding it');
  assert.match(r.say, /background/);
  assert.deepEqual(w.taskOps(), ['run'], 'run once, end nothing');
});

test('relaunch: the same build already answers, so leave at once and touch nothing', async () => {
  const w = world({ occupant: MINE, taskRunning: true });
  const r = await handOffToTask(w.opts());
  assert.equal(r.serve, false);
  assert.equal(r.exitCode, 0);
  assert.match(r.say, /already running/);
  assert.deepEqual(w.ops, [], 'a working board must not be bounced by a double-click');
});

test('update by hand: an older task board is given the grace period, ended, and replaced', async () => {
  const w = world({ occupant: OLDER, taskRunning: true });
  const r = await handOffToTask(w.opts());
  assert.equal(r.serve, false);
  assert.match(r.say, /background/);
  assert.deepEqual(w.taskOps(), ['end', 'run'], 'end the old board BEFORE running, or the new one dies on the port');
  const grace = w.ops.indexOf('sleep:3000');
  assert.ok(grace >= 0 && grace < w.ops.indexOf('end'),
    'the old board stays up long enough for the browser to redeem its boot nonce there');
});

test('🛑 the SAME version from a different commit is an update, not "already running"', async () => {
  /* Windows zips are cut from main between version bumps, so two 0.6.55 zips can
     carry different code. The build identity includes the commit. */
  const w = world({ occupant: '0.6.55+2f841189aaaa', taskRunning: true });
  const r = await handOffToTask(w.opts({ build: '0.6.55+6182640d6a1f' }));
  assert.equal(r.serve, false);
  assert.match(r.say, /background/);
  assert.deepEqual(w.taskOps(), ['end', 'run']);
});

test('a board with no build header predates the hand-off, so it is replaced, never taken for this one', async () => {
  const w = world({ occupant: '', taskRunning: true });
  const r = await handOffToTask(w.opts());
  assert.equal(r.serve, false);
  assert.deepEqual(w.taskOps(), ['end', 'run']);
});

test('a task board still booting at logon answers AFTER /Run with its older build: the second round replaces it', async () => {
  /* The first probe finds nothing (it is still booting), /Run is ignored because
     the task already runs, then the old build answers. */
  const w = world({ taskRunning: true });
  w.pending = { at: 800, build: OLDER };
  const r = await handOffToTask(w.opts());
  assert.equal(r.serve, false, 'the window must not be left serving over a board we could replace');
  assert.match(r.say, /background/);
  assert.deepEqual(w.taskOps(), ['run', 'end', 'run']);
});

// ── every case it cannot confirm serves here, as before ────────────────────

test('a board the task did not start holds the port: leave it alone and serve here', async () => {
  const w = world({ occupant: OLDER, taskRunning: false });
  const r = await handOffToTask(w.opts());
  assert.equal(r.serve, true);
  assert.equal(r.attempted, true);
  assert.match(r.because, /did not start/);
  assert.deepEqual(w.taskOps(), [], 'somebody else\'s board is never ended from here');
});

test('the task\'s board never answers: end the task so a late start cannot steal the port, then serve here', async () => {
  const w = world({ starts: null });
  const r = await handOffToTask(w.opts());
  assert.equal(r.serve, true);
  assert.equal(r.attempted, true);
  assert.match(r.because, /did not answer/);
  assert.deepEqual(w.taskOps(), ['run', 'end']);
  assert.ok(w.t >= BUDGET, 'it waited out the budget before giving up');
});

test('🛑 the budget counts from PROCESS START, so a slow boot leaves the fallback time to serve before the opener gives up', async () => {
  /* The opener waits 20s and then opens the plain url, which an enforcing board
     403s. Here the process spent 13s booting, so 1s of budget is left. */
  const w = world({ starts: null });
  const r = await handOffToTask(w.opts({ startedAt: -13000 }));
  assert.equal(r.serve, true);
  assert.ok(w.t <= 1000 + 2000 + 300, 'the hand-off overran its budget: ' + w.t + 'ms after a 13s boot');
});

test('the whole update path fits the budget, grace and all', async () => {
  const w = world({ occupant: OLDER, taskRunning: true, starts: null });
  const r = await handOffToTask(w.opts());
  assert.equal(r.serve, true);
  assert.ok(w.t <= BUDGET + 2000 + 300, 'the fallback came too late for the opener: ' + w.t + 'ms');
});

test('a /Run that fails: serve here with its reason', async () => {
  const w = world({ runOk: false });
  const r = await handOffToTask(w.opts());
  assert.equal(r.serve, true);
  assert.equal(r.attempted, true);
  assert.match(r.because, /access denied/);
});

test('an older board that will not stop: serve here, and never run a second board onto its port', async () => {
  const w = world({ occupant: OLDER, taskRunning: true, endFrees: false });
  const r = await handOffToTask(w.opts());
  assert.equal(r.serve, true);
  assert.match(r.because, /did not stop/);
  assert.deepEqual(w.taskOps(), ['end'], 'no /Run while the port is still held');
});

test('a probe that throws does not escape: serve here', async () => {
  const w = world();
  const r = await handOffToTask(w.opts({ probe: async () => { throw new Error('boom'); } }));
  assert.equal(r.serve, true);
  assert.equal(r.attempted, true);
  assert.match(r.because, /boom/);
});

test('a throw while gathering the facts does not escape either: the promise never rejects', async () => {
  const w = world();
  w.board.startedByTask = () => { throw new Error('schtasks exploded'); };
  const opts = w.opts();
  delete opts.byTask;
  const r = await handOffToTask(opts);
  assert.equal(r.serve, true);
  assert.match(r.because, /schtasks exploded/);
});

// ── the real probe, against a real local server ────────────────────────────

async function serveOnce(handler, fn) {
  const srv = http.createServer(handler);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try { return await fn(srv.address().port); } finally { await new Promise((r) => srv.close(r)); }
}

test('the default probe reads the build the running process names in its header', async () => {
  await serveOnce((q, s) => { s.writeHead(200, { [BOARD_BUILD_HEADER]: MINE }); s.end('<html></html>'); }, async (port) => {
    const w = world();
    const opts = w.opts({ port });
    delete opts.probe;
    const r = await handOffToTask(opts);
    assert.equal(r.serve, false, 'the real probe saw the same build and reported the board as already running');
    assert.match(r.say, /already running/);
  });
});

test('🛑 an OLD board serving a NEW page (a zip unpacked over the running install) is not taken for this one', async () => {
  /* server.js reads web/index.html per request, so after an unpack-over the old
     process serves the new page, version meta included. Only the header names the
     code that is running, and an old board has none. */
  await serveOnce((q, s) => { s.end('<html><head><meta name="kosmos-version" content="0.6.55"></head></html>'); }, async (port) => {
    const w = world({ taskRunning: true });
    w.board.end = () => { w.ops.push('end'); return { ok: true }; };
    const opts = w.opts({ port, build: '0.6.55' });
    delete opts.probe;
    const r = await handOffToTask(opts);
    assert.doesNotMatch(String(r.say), /already running/);
    assert.equal(w.taskOps()[0], 'end', 'the old task board is ended so the new code can serve');
  });
});

test('the default probe says "not answering" on a closed port', async () => {
  const port = await serveOnce((q, s) => s.end(), async (p) => p); // bound, then closed
  const w = world({ starts: null });
  const opts = w.opts({ port });
  delete opts.probe;
  const r = await handOffToTask(opts);
  assert.equal(r.serve, true, 'nothing answers on the closed port, so the unstarted task is not proof');
  assert.deepEqual(w.taskOps(), ['run', 'end']);
});

// ── buildIdentity: one derivation for both sides ───────────────────────────

function appTree({ version = '1.2.3', bundle = false, manifest } = {}) {
  const root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-handoff-570-'));
  const app = nodePath.join(root, 'app');
  fs.mkdirSync(app);
  fs.writeFileSync(nodePath.join(app, 'package.json'), JSON.stringify({ name: 'agent-workforce', version }));
  if (bundle) {
    fs.mkdirSync(nodePath.join(root, 'runtime'));
    fs.writeFileSync(nodePath.join(root, 'runtime', 'node.exe'), '');
  }
  if (manifest !== undefined) fs.writeFileSync(nodePath.join(root, 'manifest.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
  return { root, app, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('buildIdentity: the bundle adds the commit the zip was built from', () => {
  const t = appTree({ bundle: true, manifest: { source_sha: '6182640d6a1fd6e578e7cdd78b943097674ca760' } });
  try { assert.equal(buildIdentity(t.app), '1.2.3+6182640d6a1f'); } finally { t.done(); }
});

test('buildIdentity: a source checkout is its version alone, even with a manifest.json beside it', () => {
  const t = appTree({ bundle: false, manifest: { source_sha: '6182640d6a1fd6e578e7cdd78b943097674ca760' } });
  try { assert.equal(buildIdentity(t.app), '1.2.3', 'a stray ../manifest.json beside a repo must not be read'); } finally { t.done(); }
});

test('buildIdentity: a manifest with no usable commit, or a broken one, falls back to the version', () => {
  for (const manifest of [{ source_sha: 'unknown' }, '{not json', {}]) {
    const t = appTree({ bundle: true, manifest });
    try { assert.equal(buildIdentity(t.app), '1.2.3'); } finally { t.done(); }
  }
});

test('buildIdentity: no readable package.json is no identity', () => {
  assert.equal(buildIdentity(nodePath.join(os.tmpdir(), 'aw-handoff-570-nothing-here')), null);
});

test('with no identity of its own, no answering board is ever taken for this one', async () => {
  const w = world({ occupant: '', taskRunning: true });
  const r = await handOffToTask(w.opts({ build: null }));
  assert.notEqual(r.say, 'Kosmos is already running. Your browser is opening it.');
});
