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

const { handOffToTask, buildIdentity, BOARD_IDENTITY_HEADER, BOARD_STARTED_BY_TASK_HEADER, probeBoard, boardStartedByTaskHeaderValue } = require('./win32handoff');

const REFRESHED = { ok: true, action: 'refreshed' };
const MINE = '0.6.55+6182640d6a1f';
const OLDER = '0.6.55+2f841189aaaa';
const BUDGET = 12000;
const RELEASE_FLOOR = 2000;

/* A fake world: a clock that sleeping advances, a port whose occupant changes as
   the task is ended and run, and a record of every task op in order.
   occupant: null = nothing on the port; '' = a board with no build header;
   any other string = the build that board names. */
function world({ occupant = null, taskRunning = false, starts = MINE, runOk = true, endFrees = true, releaseAfter = 0, probeCost = 0 } = {}) {
  const w = { t: 0, occupant, taskRunning, ops: [], probes: 0 };
  w.board = {
    status: () => ({ registered: true, enabled: true, running: w.taskRunning }),
    end: () => {
      w.ops.push('end');
      /* releaseAfter: the ended board lets go of the port that many ms later, as a
         real one does (about a second, measured). */
      if (w.taskRunning && endFrees) { w.taskRunning = false; w.releasing = w.t + releaseAfter; }
      return { ok: true };
    },
    runNow: () => {
      w.ops.push('run');
      if (!runOk) return { ok: false, because: 'we could not start the board (access denied)' };
      /* IgnoreNew: a run while the task runs starts nothing new. */
      if (!w.taskRunning && starts !== null) { w.taskRunning = true; w.pending = { at: w.t + 1200, identity: typeof starts === 'function' ? starts() : starts }; }
      return { ok: true };
    },
  };
  w.probe = async () => {
    w.probes++;
    w.t += probeCost; // a probe that takes time, as one to a hung board does
    if (w.releasing !== undefined && w.t >= w.releasing) { w.occupant = null; delete w.releasing; }
    if (w.pending && w.t >= w.pending.at) { w.occupant = w.pending.identity; w.pending = null; }
    return w.occupant === null ? { answering: false, identity: null } : { answering: true, identity: w.occupant || null };
  };
  w.sleep = async (ms) => { w.ops.push('sleep:' + ms); w.t += ms; };
  w.now = () => w.t;
  w.opts = (extra) => Object.assign({
    platform: 'win32', env: {}, byTask: false, bundle: true, live: true, ensured: REFRESHED,
    port: 16180, identity: MINE, startedAt: 0,
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

test('#2973 a task whose running state could not be read is never ended: serve here, and say so', async () => {
  for (const status of [
    { known: true, registered: true, enabled: true, running: null },
    { known: false, registered: false, because: 'ERROR: Access is denied.' },
  ]) {
    const w = world({ occupant: OLDER, taskRunning: true });
    w.board.status = () => status;
    const r = await handOffToTask(w.opts());
    assert.equal(r.serve, true);
    assert.match(r.because, /could not tell whether the logon task started what is already using port 16180/);
    assert.deepEqual(w.taskOps(), [], 'nothing ended, nothing run');
  }
});

test('#2973 German Windows, a board too old to say: the REAL status read sees the task running, so the older board is replaced', async () => {
  /* 267009 while running; -2147020576 (0x800710E0) while running after a /Run that
     IgnoreNew ignored (review round 1, measured). Both are running. */
  for (const code of ['267009', '-2147020576']) {
    const realBoard = require('./win32board');
    realBoard.setRunner((args) => {
      if (args.includes('/XML')) return { ok: true, out: '<?xml version="1.0" encoding="UTF-16"?>\r\n<Task><Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy></Settings></Task>' };
      if (args.includes('/V')) return { ok: true, out: '"BUERO-PC","\\Kosmos\\board","N/A","Wird ausgeführt","Nur interaktiv","12.09.2026 22:41:43","' + code + '","N/A"\r\n' };
      if (args.includes('LIST')) return { ok: true, out: 'Hostname: BUERO-PC\r\nAufgabenname: \\Kosmos\\board\r\nStatus: Wird ausgeführt\r\n' };
      return { ok: false, out: 'FEHLER: Zugriff verweigert' };
    });
    try {
      const w = world({ occupant: OLDER, taskRunning: true });
      const board = { ...w.board, status: () => realBoard.status() };
      const r = await handOffToTask(w.opts({ board }));
      assert.equal(r.serve, false, code + ': ' + r.because);
      assert.deepEqual(w.taskOps(), ['end', 'run'], code);
    } finally {
      realBoard.setRunner(null);
    }
  }
});

// ── #2973 review round 1: the answering board says whether its task started it ──

/* The fake world's probe, plus what the answering board says about its task. */
function sayingStartedByTask(w, startedByTask) {
  const inner = w.probe;
  return async (port) => {
    const p = await inner(port);
    return p.answering ? { ...p, startedByTask } : { ...p, startedByTask: null };
  };
}

test('#2973 a board that SAYS its task started it is replaced without asking Task Scheduler, whatever schtasks would say', async () => {
  for (const scheduler of [{ running: null }, { known: false, registered: false, because: 'x' }, { known: true, registered: true, enabled: true, running: null }]) {
    const w = world({ occupant: OLDER, taskRunning: true });
    let asked = 0;
    w.board.status = () => { asked += 1; return scheduler; };
    const r = await handOffToTask(w.opts({ probe: sayingStartedByTask(w, true) }));
    assert.equal(r.serve, false, r.because);
    assert.deepEqual(w.taskOps(), ['end', 'run']);
    assert.equal(asked, 0, 'the board\'s own word needs no schtasks and no locale');
  }
});

test('#2973 a board that SAYS its task did not start it is never ended, even when Task Scheduler reads running', async () => {
  const w = world({ occupant: OLDER, taskRunning: true });
  let asked = 0;
  w.board.status = () => { asked += 1; return { known: true, registered: true, enabled: true, running: true }; };
  const r = await handOffToTask(w.opts({ probe: sayingStartedByTask(w, false) }));
  assert.equal(r.serve, true);
  assert.match(r.because, /something the logon task did not start is already using port 16180/);
  assert.deepEqual(w.taskOps(), [], 'a hand-started board in another window is somebody else\'s');
  assert.equal(asked, 0);
});

test('#2973 a board that predates the header falls back to Task Scheduler', async () => {
  const w = world({ occupant: OLDER, taskRunning: true });
  let asked = 0;
  w.board.status = () => { asked += 1; return { known: true, registered: true, enabled: true, running: true }; };
  const r = await handOffToTask(w.opts({ probe: sayingStartedByTask(w, null) }));
  assert.equal(r.serve, false, r.because);
  assert.equal(asked, 1);
  assert.deepEqual(w.taskOps(), ['end', 'run']);
});

test('#2973 the real probe reads the started-by-task header: 1, 0, absent', async () => {
  for (const [sent, expected] of [['1', true], ['0', false], [undefined, null], ['yes', null]]) {
    const headers = { [BOARD_IDENTITY_HEADER]: OLDER };
    if (sent !== undefined) headers[BOARD_STARTED_BY_TASK_HEADER] = sent;
    await serveOnce((q, s) => { s.writeHead(200, headers); s.end('<html></html>'); }, async (port) => {
      const p = await probeBoard(port);
      assert.equal(p.answering, true);
      assert.equal(p.startedByTask, expected, 'header ' + String(sent));
    });
  }
});

test('#2973 the header value is the board\'s own marker, one writer for the reader above', () => {
  const board = require('./win32board');
  assert.equal(boardStartedByTaskHeaderValue({ [board.MARKER_ENV]: board.TASK_NAME }), '1');
  assert.equal(boardStartedByTaskHeaderValue({}), '0');
  assert.equal(boardStartedByTaskHeaderValue({ [board.MARKER_ENV]: 'Kosmos\\agent-fred' }), '0');
});

test('🛑 the SAME version from a different commit is an update, not "already running"', async () => {
  /* Windows zips are cut from main between version bumps, so two 0.6.55 zips can
     carry different code. The build identity includes the commit. */
  const w = world({ occupant: '0.6.55+2f841189aaaa', taskRunning: true });
  const r = await handOffToTask(w.opts({ identity: '0.6.55+6182640d6a1f' }));
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

test('a task board still booting at logon answers AFTER /Run with its older identity: the second round replaces it', async () => {
  /* The first probe finds nothing (it is still booting), /Run is ignored because
     the task already runs, then the old build answers. */
  const w = world({ taskRunning: true });
  w.pending = { at: 800, identity: OLDER };
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
  const r = await handOffToTask(w.opts({ startedAt: -(BUDGET - 1000) }));
  assert.equal(r.serve, true);
  assert.ok(w.t <= 1000 + RELEASE_FLOOR + 300, 'the hand-off overran its budget: ' + w.t + 'ms with 1s left');
});

test('the whole update path fits the budget, grace and all', async () => {
  const w = world({ occupant: OLDER, taskRunning: true, starts: null, releaseAfter: 1000 });
  const r = await handOffToTask(w.opts());
  assert.equal(r.serve, true);
  assert.ok(w.t <= BUDGET + RELEASE_FLOOR + 300, 'the fallback came too late for the opener: ' + w.t + 'ms');
});

test('🛑 a board slow to let go of the port is waited for even when the budget is spent, so this one does not bind into it', async () => {
  /* The budget is gone when the old board is ended, and it frees the port 1.8s
     later, as a real one does. Waiting only what is left of the budget (nothing)
     would call it stuck, or serve here straight into EADDRINUSE. */
  const w = world({ occupant: OLDER, taskRunning: true, releaseAfter: 1800 });
  const r = await handOffToTask(w.opts({ startedAt: -(BUDGET - 100) }));
  assert.equal(r.serve, true, 'no budget left to run the task, so serve here');
  assert.doesNotMatch(r.because, /did not stop/, 'the release floor was not honoured');
  assert.match(r.because, /no time left to start/, 'the sentence must say what happened: nothing was started');
  assert.ok(w.t >= 1900 && w.t <= 100 + RELEASE_FLOOR + 300, 'it waited ' + w.t + 'ms; the port freed 1800ms after the end at 100ms');
});

test('the release floor is also a ceiling: a board that holds the port past it is reported, not waited on forever', async () => {
  const w = world({ occupant: OLDER, taskRunning: true, releaseAfter: 5000 });
  const r = await handOffToTask(w.opts({ startedAt: -(BUDGET - 100) }));
  assert.equal(r.serve, true);
  assert.match(r.because, /did not stop/);
  assert.ok(w.t <= 100 + RELEASE_FLOOR + 300, 'waited ' + w.t + 'ms past a spent budget');
});

test('with the budget already spent, a working older board is KEPT, never ended for a window', async () => {
  const w = world({ occupant: OLDER, taskRunning: true });
  const r = await handOffToTask(w.opts({ startedAt: -BUDGET }));
  assert.equal(r.serve, true);
  assert.match(r.because, /no time left to replace/);
  assert.deepEqual(w.taskOps(), [], 'nothing to replace it with, so it stays');
});

test('🛑 slow probes (a board that accepts and hangs) keep the no-board path inside the stated 18s worst case', async () => {
  /* Every probe costs the full PROBE_TIMEOUT_MS. The module's header promises
     12s budget + 2s last probe + 2s release floor + 2s its last probe. */
  const w = world({ starts: null, probeCost: 2000 });
  const r = await handOffToTask(w.opts());
  assert.equal(r.serve, true);
  assert.ok(w.t <= 18000, 'the fallback began ' + w.t + 'ms after process start; the promise is 18000');
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
  await serveOnce((q, s) => { s.writeHead(200, { [BOARD_IDENTITY_HEADER]: MINE }); s.end('<html></html>'); }, async (port) => {
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
    const opts = w.opts({ port, identity: '0.6.55' });
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
  const r = await handOffToTask(w.opts({ identity: null }));
  assert.notEqual(r.say, 'Kosmos is already running. Your browser is opening it.');
});

// ── worlds: the identity names the world, and a hand-off forgets its boot attempt ──

test('boardIdentity: the same build serving ANOTHER world is not this board', async () => {
  const { boardIdentity } = require('./win32handoff');
  assert.notEqual(boardIdentity('0.6.55+abc', 'side-1'), boardIdentity('0.6.55+abc', 'default'));
  assert.equal(boardIdentity(null, 'default'), null, 'no build is no identity');
  const w = world({ occupant: boardIdentity(MINE, 'side-1'), taskRunning: true, starts: boardIdentity(MINE, 'default') });
  const r = await handOffToTask(w.opts({ identity: boardIdentity(MINE, 'default') }));
  assert.equal(r.serve, false);
  assert.match(r.say, /background/, 'the other world\'s board is replaced, never reported as "already running"');
  assert.deepEqual(w.taskOps(), ['end', 'run']);
});

/* A sandboxed named-world registry that has NEVER served: one recorded failed
   boot is enough for its next boot to abandon it (#2528). Both roots point into
   the sandbox, so a shell that carries AGENT_WORKFORCE_DATA is never written to. */
function neverServedWorld() {
  const worlds = require('./worlds');
  const worldenv = require('./worldenv');
  const guard = require('./worldbootguard');
  const home = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-handoff-world-570-'));
  const env = { AGENT_WORKFORCE_HOME: home, AGENT_WORKFORCE_DATA: home };
  const base = worlds.baseRoot(env);
  const side = worlds.createWorld(base, 'Side Project');
  worlds.setActiveWorld(base, side.id);
  worldenv.bootstrapWorldEnv(env);   // THIS launch's boot: records one attempt
  const attempts = () => { try { return JSON.parse(fs.readFileSync(nodePath.join(base, guard.FILE), 'utf8'))[side.id] || 0; } catch { return 0; } };
  /* worldenv keeps what it booted in module state and has no reset, so leaving
     this sandbox would leave every later default-seamed test retracting against a
     deleted folder. done() boots a live DEFAULT-world sandbox instead (which
     records nothing), removed when the file ends. */
  const done = () => {
    const after = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-handoff-world-570-after-'));
    worldenv.bootstrapWorldEnv({ AGENT_WORKFORCE_HOME: after, AGENT_WORKFORCE_DATA: after });
    test.after(() => fs.rmSync(after, { recursive: true, force: true }));
    fs.rmSync(home, { recursive: true, force: true });
  };
  return { base, side, guard, attempts, done };
}

test('🛑 the task\'s board, started by the hand-off, does NOT abandon a never-served world because of this launch\'s attempt', async () => {
  /* Review round 5 measured it: with this launch's attempt still on disk, the
     task board's bootstrap found shouldAbandon(world) === true for a world that
     had never served, and booted the default world instead. */
  const s = neverServedWorld();
  try {
    assert.equal(s.attempts(), 1, 'control: this launch recorded its attempt');
    const w = world();
    let taskWouldAbandon = null;
    const run = w.board.runNow;
    w.board.runNow = () => { taskWouldAbandon = s.guard.shouldAbandon(s.base, s.side.id); return run(); };
    const r = await handOffToTask(w.opts());
    assert.equal(r.serve, false);
    assert.equal(taskWouldAbandon, false, 'the task board would have abandoned the world over an attempt it never made');
    assert.equal(s.attempts(), 0, 'a successful hand-off leaves no attempt of its own behind');
  } finally { s.done(); }
});

test('"already running" takes this launch\'s attempt back and does not put it back: the running board keeps its own books', async () => {
  const s = neverServedWorld();
  try {
    const w = world({ occupant: MINE, taskRunning: true });
    const r = await handOffToTask(w.opts());
    assert.match(r.say, /already running/);
    assert.equal(s.attempts(), 0, 'a launch that served nothing left a failed boot on the world');
  } finally { s.done(); }
});

test('a hand-off that falls back to the window PUTS ITS ATTEMPT BACK, so a window board that then crashes still counts', async () => {
  const s = neverServedWorld();
  try {
    const w = world({ runOk: false });
    const r = await handOffToTask(w.opts());
    assert.equal(r.serve, true);
    assert.equal(s.attempts(), 1, 'the fallback serves here; its boot attempt must be on record again');
  } finally { s.done(); }
});

test('retractAttempt takes back exactly one, never earlier boots\' failures, and says whether it took one', () => {
  const guard = require('./worldbootguard');
  const base = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-retract-570-'));
  try {
    guard.recordAttempt(base, 'w1'); guard.recordAttempt(base, 'w1');
    assert.equal(guard.retractAttempt(base, 'w1'), true);
    assert.equal(JSON.parse(fs.readFileSync(nodePath.join(base, guard.FILE), 'utf8')).w1, 1, 'an earlier boot\'s failure was erased');
    assert.equal(guard.retractAttempt(base, 'w1'), true);
    assert.equal(fs.existsSync(nodePath.join(base, guard.FILE)), false, 'the empty file lingers');
    assert.equal(guard.retractAttempt(base, 'w1'), false, 'nothing to take back');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('a default-world boot records no attempt, so a hand-off neither takes nor puts one back', async () => {
  /* Recorded, not thrown: the guard calls are fail-open by design, so a throw
     would be swallowed and prove nothing. */
  let recorded = 0;
  const guard = { retractAttempt: () => false, recordAttempt: () => { recorded++; } };
  const w = world({ runOk: false });
  const r = await handOffToTask(w.opts({ worlds: { guard, worldenv: { bootedBaseDir: () => '/x', bootedWorld: () => 'default' } } }));
  assert.equal(r.serve, true);
  assert.equal(recorded, 0, 'the fallback recorded an attempt the bootstrap never made');
});
