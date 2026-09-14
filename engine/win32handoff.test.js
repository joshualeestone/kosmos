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
const net = require('node:net');

const { handOffToTask, buildIdentity, BOARD_IDENTITY_HEADER, BOARD_STARTED_BY_TASK_HEADER, probeBoard, boardStartedByTaskHeaderValue, boardMayBeOpen, PROBE_OUTCOMES, probeBoardOnEveryAddress, cannotTellIfOpenSentence, SERVE_HERE_SIGNAL_ENV, signalServingHere } = require('./win32handoff');

/* Round 7, finding 4: the fake world's port is 9 (discard), never a Kosmos board's. And nothing in this suite
   may connect to 16180, the live board's port: a test that tries goes red instead of reaching it. */
const LIVE_BOARD_PORT = 16180;
function refuseTheLiveBoardPort(connectArgs) {
  let options = connectArgs[0];
  if (Array.isArray(options)) options = options[0];
  const port = options && typeof options === 'object' ? options.port : options;
  if (Number(port) === LIVE_BOARD_PORT) throw new Error('this suite tried to connect to port 16180, the live board');
}
{
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function connectAnywhereButTheLiveBoard(...args) {
    refuseTheLiveBoardPort(args);
    return connect.apply(this, args);
  };
}

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
    port: 9, identity: MINE, startedAt: 0,
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
    assert.match(r.because, /could not tell whether the logon task started what is already using port 9\b/);
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
  assert.match(r.because, /something the logon task did not start is already using port 9\b/);
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

test('🛑 win32-installer-native round 3 finding 1: the real probe says WHY nothing answered, and only a refused connection is no board', async () => {
  const sockets = new Set();
  const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
  const hung = net.createServer((socket) => sockets.add(socket));
  const slow = http.createServer((q, s) => {
    const timer = setTimeout(() => { s.writeHead(200, { [BOARD_IDENTITY_HEADER]: MINE, [BOARD_STARTED_BY_TASK_HEADER]: '0' }); s.end('ok'); }, 2500);
    s.on('close', () => clearTimeout(timer));
  });
  slow.on('connection', (socket) => sockets.add(socket));
  const fast = http.createServer((q, s) => { s.writeHead(200, { [BOARD_IDENTITY_HEADER]: MINE, [BOARD_STARTED_BY_TASK_HEADER]: '0' }); s.end('ok'); });
  const closed = net.createServer();
  const refusedPort = await listen(closed);
  await new Promise((resolve) => closed.close(resolve));
  try {
    const nobody = (outcome) => ({ answering: false, outcome, identity: null, startedByTask: null });
    const startedAt = Date.now();
    assert.deepEqual(await probeBoard(await listen(hung)), nobody(PROBE_OUTCOMES.TIMED_OUT), 'a listener that never answers');
    assert.ok(Date.now() - startedAt >= 1900, 'the probe did not wait its timeout');
    assert.deepEqual(await probeBoard(await listen(slow)), nobody(PROBE_OUTCOMES.TIMED_OUT), 'a hand-started board that answers after 2.5s');
    assert.deepEqual(await probeBoard(await listen(fast)), { answering: true, outcome: PROBE_OUTCOMES.ANSWERED, identity: MINE, startedByTask: false });
    assert.deepEqual(await probeBoard(refusedPort), nobody(PROBE_OUTCOMES.REFUSED), 'a port nothing listens on');
  } finally {
    for (const socket of sockets) socket.destroy();
    await Promise.all([hung, slow, fast].map((server) => new Promise((resolve) => server.close(() => resolve()))));
  }
  assert.deepEqual({ ...PROBE_OUTCOMES }, { ANSWERED: 'answered', REFUSED: 'refused', TIMED_OUT: 'timed-out', CONNECT_TIMED_OUT: 'connect-timed-out', UNIDENTIFIED: 'unidentified', ERROR: 'error' });
  for (const [answer, mayBeOpen] of [
    [null, true], [undefined, true], [{ answering: true, outcome: 'answered' }, true], [{ answering: false, outcome: 'refused' }, false],
    [{ answering: false, outcome: 'timed-out' }, true], [{ answering: false, outcome: 'connect-timed-out' }, true], [{ answering: false, outcome: 'error' }, true], [{ answering: false }, true],
  ]) assert.equal(boardMayBeOpen(answer), mayBeOpen, JSON.stringify(answer));
});

test('🛑 win32-installer-native round 4 finding 1: the uninstall and the move look on every address a board of this user could be on, all at once, and the most open answer wins', async () => {
  const REFUSED_LOOK = { answering: false, outcome: 'refused', identity: null, startedByTask: null };
  const asked = [];
  let inFlight = 0;
  let mostAtOnce = 0;
  const recorder = async (port, host) => {
    asked.push(host);
    inFlight += 1;
    mostAtOnce = Math.max(mostAtOnce, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 20));
    inFlight -= 1;
    return REFUSED_LOOK;
  };
  const addressesFor = async (env) => { asked.length = 0; await probeBoardOnEveryAddress(9, env, recorder); return asked.slice().sort(); };
  const LOOPBACKS = ['127.0.0.1', '::1'].sort();

  assert.deepEqual(await addressesFor({}), LOOPBACKS);
  assert.equal(mostAtOnce, 2, 'the looks ran one after another, so the first look took their sum');
  for (const covered of ['127.0.0.1', '::1', 'localhost', '0.0.0.0', '::', '   ']) {
    assert.deepEqual(await addressesFor({ KOSMOS_BIND_HOST: covered }), LOOPBACKS, covered + ' is covered by the loopback looks');
  }
  assert.deepEqual(await addressesFor({ KOSMOS_BIND_HOST: '127.0.0.2' }), ['127.0.0.1', '127.0.0.2', '::1'].sort(), 'the bind host was not looked on');
  assert.deepEqual(await addressesFor({ KOSMOS_BIND_HOST: '192.0.2.10' }), LOOPBACKS, 'an address this machine does not have was probed across the network');

  const answersBy = (byHost) => async (port, host) => byHost[host] || REFUSED_LOOK;
  const kosmos = { answering: true, outcome: 'answered', identity: MINE, startedByTask: false };
  const webPage = { answering: true, outcome: 'answered', identity: null, startedByTask: null };
  const timedOut = { answering: false, outcome: 'timed-out', identity: null, startedByTask: null };
  const failed = { answering: false, outcome: 'error', identity: null, startedByTask: null };
  assert.equal((await probeBoardOnEveryAddress(1, {}, answersBy({ '::1': kosmos }))).identity, MINE, 'a board on ::1 was not seen');
  assert.equal((await probeBoardOnEveryAddress(1, {}, answersBy({ '::1': kosmos }))).host, '::1');
  assert.equal((await probeBoardOnEveryAddress(1, {}, answersBy({ '127.0.0.1': webPage, '::1': timedOut }))).outcome, 'timed-out', 'a web page on one address hid a board that did not answer in time on the other');
  assert.equal((await probeBoardOnEveryAddress(1, {}, answersBy({ '127.0.0.1': failed, '::1': timedOut }))).outcome, 'timed-out');
  assert.equal((await probeBoardOnEveryAddress(1, {}, answersBy({ '::1': failed }))).outcome, 'error');
  assert.equal((await probeBoardOnEveryAddress(1, {}, answersBy({}))).outcome, 'refused');
  assert.equal((await probeBoardOnEveryAddress(1, {}, async () => { throw new Error('boom'); })).outcome, 'error', 'a look that threw was taken as refused');
  assert.equal(cannotTellIfOpenSentence(16180, { known: true, registered: false, running: false }), 'Another program is using port 16180, so Kosmos cannot tell whether it is still open.');
  /* Round 5, finding 5: status() never says a registered task is not running, so these could still be a board. */
  for (const task of [{ known: true, registered: true, running: null }, { known: false, registered: false }, null]) {
    assert.equal(cannotTellIfOpenSentence(16180, task), 'Kosmos could not tell whether it is still open.', JSON.stringify(task));
  }
});

/* Measured on this box with net.connect: 255.255.255.255 fails with EADDRNOTAVAIL, and 0.0.0.1 with
   ENETUNREACH. (Not port 0: http.get takes port 0 as "no port" and asks port 80.) Round 5, finding 4:
   neither is proof that nothing listens, so both read as a failed look. */
test('🛑 win32-installer-native round 5 finding 4: only a refused connection is no board; EADDRNOTAVAIL and ENETUNREACH are failed looks (fail closed)', { skip: process.platform !== 'win32' && 'the connection errors for these addresses were measured on Windows' }, async () => {
  for (const [label, port, host] of [['255.255.255.255 (EADDRNOTAVAIL)', 9, '255.255.255.255'], ['0.0.0.1 (ENETUNREACH)', 9, '0.0.0.1']]) {
    const answer = await probeBoard(port, host);
    assert.equal(answer.outcome, PROBE_OUTCOMES.ERROR, label + ': a connection error that is not a refusal was taken as proof that no board is there: ' + JSON.stringify(answer));
    assert.equal(boardMayBeOpen(answer), true, label);
  }
});

test('win32-installer-native round 4 finding 1: the bind host is read in one place, engine/bindhost.js, by the board and by the probes', () => {
  const serverSource = fs.readFileSync(nodePath.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(serverSource, /const \{ bindHost \} = require\('\.\/engine\/bindhost'\);/, 'server.js does not bind through engine/bindhost.js');
  assert.doesNotMatch(serverSource, /\.KOSMOS_BIND_HOST|\[['"]KOSMOS_BIND_HOST['"]\]/, 'server.js reads the bind host itself again');
  assert.match(fs.readFileSync(nodePath.join(__dirname, 'win32handoff.js'), 'utf8'), /require\('\.\/bindhost'\)\.bindHost\(env\)/, 'the probes do not look where the board binds');
  const { bindHost } = require('./bindhost');
  assert.equal(bindHost({}), '127.0.0.1');
  assert.equal(bindHost({ KOSMOS_BIND_HOST: ' ::1 ' }), '::1');
  assert.equal(bindHost({ KOSMOS_BIND_HOST: '   ' }), '127.0.0.1');
});

test('🛑 win32-installer-native round 5 finding 2: a board no task command can stop outranks the task\'s own board on another address', async () => {
  const REFUSED_LOOK = { answering: false, outcome: 'refused', identity: null, startedByTask: null };
  const answersBy = (byHost) => async (port, host) => byHost[host] || REFUSED_LOOK;
  const taskBoard = { answering: true, outcome: 'answered', identity: MINE, startedByTask: true };
  const handBoard = { answering: true, outcome: 'answered', identity: MINE, startedByTask: false };
  const oldBoard = { answering: true, outcome: 'answered', identity: MINE, startedByTask: null };
  const timedOut = { answering: false, outcome: 'timed-out', identity: null, startedByTask: null };
  assert.equal((await probeBoardOnEveryAddress(1, {}, answersBy({ '127.0.0.1': taskBoard, '::1': handBoard }))).startedByTask, false, 'case C: the task\'s board hid a hand-started board');
  assert.equal((await probeBoardOnEveryAddress(1, {}, answersBy({ '127.0.0.1': handBoard, '::1': taskBoard }))).startedByTask, false, 'the order of the addresses decided');
  assert.equal((await probeBoardOnEveryAddress(1, {}, answersBy({ '127.0.0.1': taskBoard, '::1': oldBoard }))).startedByTask, null, 'a board too old to say was hidden by the task\'s board');
  assert.equal((await probeBoardOnEveryAddress(1, {}, answersBy({ '127.0.0.1': taskBoard, '::1': timedOut }))).startedByTask, true, 'the task\'s board is still what the removal ends and waits for');
});

test('🛑 win32-installer-native round 5 findings 1 and 3: the bind host is resolved, and only this machine\'s own addresses are looked on, with their zone', async (t) => {
  const REFUSED_LOOK = { answering: false, outcome: 'refused', identity: null, startedByTask: null };
  const asked = [];
  const recorder = async (port, host) => { asked.push(host); return REFUSED_LOOK; };
  const addressesFor = async (env, lookup) => { asked.length = 0; await probeBoardOnEveryAddress(9, env, recorder, lookup); return asked.slice().sort(); };
  const LOOPBACKS = ['127.0.0.1', '::1'].sort();
  const resolvesTo = (...addresses) => async () => addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  const fails = (code) => async () => { throw Object.assign(new Error(code), { code }); };

  assert.deepEqual(await addressesFor({ KOSMOS_BIND_HOST: 'board.example' }, resolvesTo('192.0.2.10')), LOOPBACKS, 'a name that resolves to another machine was probed across the network');
  assert.deepEqual(await addressesFor({ KOSMOS_BIND_HOST: 'board.example' }, resolvesTo('192.0.2.10', '127.0.0.2')), ['127.0.0.1', '127.0.0.2', '::1'].sort());
  assert.deepEqual(await addressesFor({ KOSMOS_BIND_HOST: 'board.example' }, resolvesTo('::1', '127.0.0.1')), LOOPBACKS, 'a name that resolves to loopback was looked on twice');
  assert.deepEqual(await addressesFor({ KOSMOS_BIND_HOST: 'kosmos-no-such-host.invalid' }, fails('ENOTFOUND')), LOOPBACKS);
  assert.deepEqual(await addressesFor({ KOSMOS_BIND_HOST: 'board.example' }, fails('EAI_AGAIN')), LOOPBACKS);
  assert.equal((await probeBoardOnEveryAddress(9, { KOSMOS_BIND_HOST: 'kosmos-no-such-host.invalid' }, recorder, fails('ENOTFOUND'))).outcome, 'refused',
    'case F: a name nothing can listen on blocked the removal');
  let looked = false;
  assert.deepEqual(await addressesFor({ KOSMOS_BIND_HOST: 'localhost' }, async () => { looked = true; return []; }), LOOPBACKS);
  assert.equal(looked, false, 'localhost was resolved instead of taken as loopback');

  const own = Object.entries(os.networkInterfaces()).flatMap(([name, list]) => (list || []).map((i) => ({ name, ...i })));
  const linkLocal = own.find((i) => i.family === 'IPv6' && /^fe80:/i.test(i.address) && !i.internal);
  if (!linkLocal) {
    t.diagnostic('ARMS NOT RUN: zones, this machine has no link-local IPv6 address');
  } else {
    const byScope = linkLocal.address + '%' + linkLocal.scopeid;
    const byName = linkLocal.address + '%' + linkLocal.name;
    const otherZone = linkLocal.address + '%' + (Number(linkLocal.scopeid) + 100000);
    assert.ok((await addressesFor({ KOSMOS_BIND_HOST: byScope })).includes(byScope), 'case E: a zoned link-local bind host of this machine was not looked on');
    assert.ok((await addressesFor({ KOSMOS_BIND_HOST: byName })).includes(byName), 'a link-local bind host zoned by interface name was not looked on');
    /* Round 6, finding 1: unzoned, it is looked on through its own interface. */
    assert.ok((await addressesFor({ KOSMOS_BIND_HOST: linkLocal.address })).includes(byScope), 'E2: the same address unzoned was not looked on through its interface');
    assert.deepEqual(await addressesFor({ KOSMOS_BIND_HOST: 'board.example' }, resolvesTo(linkLocal.address)), ['127.0.0.1', '::1', byScope].sort(),
      'a name that resolves to this PC\'s link-local address without a zone (as its own host name does) was not looked on through that interface');
    assert.deepEqual(await addressesFor({ KOSMOS_BIND_HOST: otherZone }), LOOPBACKS, 'a zone this machine does not have was looked on');
    assert.deepEqual(await addressesFor({ KOSMOS_BIND_HOST: 'board.example' }, resolvesTo(byScope)), ['127.0.0.1', '::1', byScope].sort(), 'a name that resolves to a zoned address of this machine was not looked on');
  }
});

/* ---- the round 6 review, fixed in round 7 ------------------------------------ */

test('🛑 win32-installer-native round 6 finding 1: with a connect limit, a connection not made in time is connect-timed-out, and it ranks with a timeout', async () => {
  const { Duplex } = require('node:stream');
  /* A socket that never connects, handed to the real probe in place of the network. */
  const neverConnects = () => {
    const socket = new Duplex({ read() {}, write(chunk, encoding, done) { done(); } });
    socket.connecting = true;
    for (const name of ['setTimeout', 'setNoDelay', 'setKeepAlive', 'ref', 'unref']) socket[name] = () => socket;
    return socket;
  };
  /* Port 9 (discard), never a Kosmos board's: even if the socket seam were ignored, no board is asked. */
  let socketsMade = 0;
  const startedAt = Date.now();
  const answer = await probeBoard(9, '127.0.0.1', { connectTimeoutMs: 200, createConnection: () => { socketsMade += 1; return neverConnects(); } });
  assert.equal(socketsMade, 1, 'the probe did not use the socket it was handed, so it opened a real connection');
  assert.equal(answer.outcome, PROBE_OUTCOMES.CONNECT_TIMED_OUT, JSON.stringify(answer));
  assert.ok(Date.now() - startedAt < 1500, 'the connect limit was not what ended the look');
  assert.equal(boardMayBeOpen(answer), true);

  const REFUSED_LOOK = { answering: false, outcome: 'refused', identity: null, startedByTask: null };
  const answersBy = (byHost) => async (port, host) => byHost[host] || REFUSED_LOOK;
  const connectTimedOut = { answering: false, outcome: 'connect-timed-out', identity: null, startedByTask: null };
  const failed = { answering: false, outcome: 'error', identity: null, startedByTask: null };
  assert.equal((await probeBoardOnEveryAddress(1, {}, answersBy({ '127.0.0.1': failed, '::1': connectTimedOut }))).outcome, 'connect-timed-out', 'a failed look hid a connection not made in time');

  const limits = [];
  await probeBoardOnEveryAddress(1, {}, async (port, host, options) => { limits.push(options && options.connectTimeoutMs); return REFUSED_LOOK; });
  assert.deepEqual(limits, [5000, 5000], 'the every-address look did not give each connection its own limit');
});

test('🛑 win32-installer-native round 6 finding 1: a look right after a board went away makes its own connection, so it is refused, not a failed look on the old kept-alive socket', async () => {
  const sockets = new Set();
  const board = http.createServer((q, s) => { s.writeHead(200, { [BOARD_IDENTITY_HEADER]: MINE }); s.end('ok'); });
  board.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise((resolve) => board.listen(0, '127.0.0.1', resolve));
  const port = board.address().port;
  assert.equal((await probeBoardOnEveryAddress(port, {})).outcome, PROBE_OUTCOMES.ANSWERED);
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => board.close(resolve));
  const after = await probeBoardOnEveryAddress(port, {});
  assert.equal(after.outcome, PROBE_OUTCOMES.REFUSED, 'the look after the board went away: ' + JSON.stringify(after));
});

test('🛑 win32-installer-native round 6 finding 1: the launcher\'s hand-off probe is unchanged: one 2 s limit for the connect and the answer (#2983)', async (t) => {
  const source = fs.readFileSync(nodePath.join(__dirname, 'win32handoff.js'), 'utf8');
  assert.match(source, /const probe = o\.probe \|\| probeBoard;/, 'the hand-off no longer probes with probeBoard and no options');

  /* A listener that accepts and never answers: the hand-off's worst case per look is still PROBE_TIMEOUT_MS. */
  const sockets = new Set();
  const hung = net.createServer((socket) => sockets.add(socket));
  await new Promise((resolve) => hung.listen(0, '127.0.0.1', resolve));
  try {
    const startedAt = Date.now();
    const answer = await probeBoard(hung.address().port);
    const tookMs = Date.now() - startedAt;
    assert.equal(answer.outcome, PROBE_OUTCOMES.TIMED_OUT);
    /* The LOWER bound is the contract: the hand-off waited its ~2 s PROBE_TIMEOUT_MS rather than short-
       circuiting. The UPPER bound is only a hang-guard -- it catches a look that never settles, not a slow
       CI runner -- so it is well clear of load (a loaded runner has been seen at ~3.5 s). */
    assert.ok(tookMs >= 1900 && tookMs < 8000, 'the hand-off look took ' + tookMs + ' ms, not its 2 s');
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => hung.close(resolve));
  }

  /* On this PC's own non-loopback address a closed port is refused only after about 2 s: the hand-off still
     reads that as timed-out at 2 s, exactly as before, while the every-address look waits for the refusal. */
  if (process.platform !== 'win32') { t.diagnostic('ARM NOT RUN: the slow refusal on a PC\'s own addresses was measured on Windows'); return; }
  const own = Object.values(os.networkInterfaces()).flat().filter((i) => i && !i.internal && i.family === 'IPv4').map((i) => i.address);
  for (const address of own) {
    const listener = net.createServer();
    const listening = await new Promise((resolve) => { listener.once('error', () => resolve(false)); listener.listen(0, address, () => resolve(true)); });
    if (!listening) continue;
    const port = listener.address().port;
    await new Promise((resolve) => listener.close(resolve));
    const limited = await probeBoardOnEveryAddress(port, { KOSMOS_BIND_HOST: address });
    const startedAt = Date.now();
    const handoffLook = await probeBoard(port, address);
    const tookMs = Date.now() - startedAt;
    if (handoffLook.outcome === PROBE_OUTCOMES.REFUSED && tookMs < 1000) { t.diagnostic(address + ' refuses at once here, so it cannot show the difference'); continue; }
    assert.equal(handoffLook.outcome, PROBE_OUTCOMES.TIMED_OUT, address + ': the hand-off look changed: ' + JSON.stringify(handoffLook) + ' in ' + tookMs + ' ms');
    assert.ok(tookMs < 2600, address + ': the hand-off look took ' + tookMs + ' ms');
    assert.equal(limited.outcome, PROBE_OUTCOMES.REFUSED, address + ': the every-address look did not wait for the slow refusal');
    return;
  }
  t.diagnostic('ARM NOT RUN: no IPv4 address of this PC refuses slowly');
});

/* ---- the round 7 review, fixed in round 8 ------------------------------------ */

test('🛑 win32-installer-native round 7 finding 1: on a bind host address any HTTP answer without a Kosmos identity may be a board (unidentified, ranked with a timeout); on the loopback probes it is still not Kosmos', async () => {
  const REFUSED_LOOK = { answering: false, outcome: 'refused', identity: null, startedByTask: null };
  const answersBy = (byHost) => async (port, host) => byHost[host] || REFUSED_LOOK;
  const bindHost = { KOSMOS_BIND_HOST: '127.0.0.2' };
  const refusedBeforeRouting = { answering: true, outcome: 'answered', identity: null, startedByTask: null };
  const kosmos = { answering: true, outcome: 'answered', identity: MINE, startedByTask: false };
  const failed = { answering: false, outcome: 'error', identity: null, startedByTask: null };

  const onBindHost = await probeBoardOnEveryAddress(9, bindHost, answersBy({ '127.0.0.2': refusedBeforeRouting }));
  assert.deepEqual(onBindHost, { answering: false, outcome: PROBE_OUTCOMES.UNIDENTIFIED, identity: null, startedByTask: null, host: '127.0.0.2' },
    'the real board\'s 400 or 403 on a bind host address was read as "not Kosmos"');
  assert.equal(boardMayBeOpen(onBindHost), true);
  assert.equal((await probeBoardOnEveryAddress(9, bindHost, answersBy({ '127.0.0.2': kosmos }))).identity, MINE, 'a board that names itself there is still that board');
  assert.equal((await probeBoardOnEveryAddress(9, bindHost, answersBy({ '127.0.0.1': failed, '127.0.0.2': refusedBeforeRouting }))).outcome, PROBE_OUTCOMES.UNIDENTIFIED,
    'a failed look outranked an unidentified answer');

  const onLoopback = await probeBoardOnEveryAddress(9, {}, answersBy({ '127.0.0.1': refusedBeforeRouting }));
  assert.equal(onLoopback.outcome, 'answered', 'a web page on the loopback probe is no longer read as "not Kosmos"');
  assert.equal(onLoopback.identity, null);
});

test('🛑 win32-installer-native round 7 finding 3: a look with a connect limit ends by connect + answer in all, even against a listener that keeps trickling bytes', async () => {
  const sockets = new Set();
  const TRICKLE_MS = 1500;
  const trickler = net.createServer((socket) => {
    sockets.add(socket);
    /* A body that never completes (a huge Content-Length, a byte every 1.5 s): without the total deadline the
       idle 2 s answer timeout never fires either, so the look would hang for ever. That is what makes this a
       hang-guard -- remove the deadline (round 8 finding 3's control) and the test hangs, then goes red. */
    socket.write('HTTP/1.1 200 OK\r\nContent-Length: 1000000\r\n\r\n');
    const timer = setInterval(() => socket.write('x'), TRICKLE_MS);
    socket.on('close', () => clearInterval(timer));
    socket.on('error', () => clearInterval(timer));
  });
  await new Promise((resolve) => trickler.listen(0, '127.0.0.1', resolve));
  try {
    const CONNECT_LIMIT_MS = 500;
    const startedAt = Date.now();
    const answer = await probeBoard(trickler.address().port, '127.0.0.1', { connectTimeoutMs: CONNECT_LIMIT_MS });
    const tookMs = Date.now() - startedAt;
    assert.equal(answer.outcome, PROBE_OUTCOMES.TIMED_OUT, JSON.stringify(answer) + ' in ' + tookMs + ' ms');
    /* The LOWER bound is the contract: the deadline let the answer window open (it did not cut off at the
       connect). The UPPER bound is only a hang-guard, well clear of CI load (a loaded runner has been seen at
       ~3.5 s), proving the deadline fired at all rather than the look hanging on the trickle. */
    assert.ok(tookMs >= CONNECT_LIMIT_MS + 2000 - 200 && tookMs < CONNECT_LIMIT_MS + 2000 + 6000, 'the look took ' + tookMs + ' ms, not its connect + answer cap');
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => trickler.close(resolve));
  }
});

test('🛑 win32-installer-native round 7 finding 5: link-local is all of fe80::/10, an unzoned link-local address is looked on through EVERY interface that has it, and a scope id of 0 is no zone', async () => {
  const REFUSED_LOOK = { answering: false, outcome: 'refused', identity: null, startedByTask: null };
  const asked = [];
  const recorder = async (port, host) => { asked.push(host); return REFUSED_LOOK; };
  const addressesFor = async (bindHost, interfaces) => {
    asked.length = 0;
    await probeBoardOnEveryAddress(9, { KOSMOS_BIND_HOST: bindHost }, recorder, undefined, interfaces);
    return asked.filter((h) => h !== '127.0.0.1' && h !== '::1').sort();
  };
  const v6 = (address, scopeid) => ({ address, family: 'IPv6', internal: false, scopeid, netmask: 'ffff:ffff:ffff:ffff::', mac: '00:00:00:00:00:00', cidr: address + '/64' });

  assert.deepEqual(await addressesFor('fe81::5', { Ethernet: [v6('fe81::5', 3)] }), ['fe81::5%3'], 'fe81:: is link-local too');
  assert.deepEqual(await addressesFor('febf::1', { Ethernet: [v6('febf::1', 3)] }), ['febf::1%3'], 'febf:: is the top of fe80::/10');
  assert.deepEqual(await addressesFor('fec0::1', { Ethernet: [v6('fec0::1', 3)] }), ['fec0::1'], 'fec0:: is past fe80::/10, so it takes no zone');
  assert.deepEqual(await addressesFor('fe80::7', { A: [v6('fe80::7', 4)], B: [v6('fe80::7', 9)] }), ['fe80::7%4', 'fe80::7%9'],
    'the same link-local address on a second adapter was not looked on');
  assert.deepEqual(await addressesFor('fe80::7%9', { A: [v6('fe80::7', 4)], B: [v6('fe80::7', 9)] }), ['fe80::7%9'], 'a zone given names one interface');
  assert.deepEqual(await addressesFor('fe80::8', { A: [v6('fe80::8', 0)] }), ['fe80::8'], 'a scope id of 0 was spelled as a zone');

  const kosmos = { answering: true, outcome: 'answered', identity: MINE, startedByTask: false };
  const onSecond = await probeBoardOnEveryAddress(9, { KOSMOS_BIND_HOST: 'fe80::7' }, async (port, host) => (host === 'fe80::7%9' ? kosmos : REFUSED_LOOK), undefined, { A: [v6('fe80::7', 4)], B: [v6('fe80::7', 9)] });
  assert.equal(onSecond.identity, MINE, 'a board on the second adapter was missed');
});

test('🛑 win32-installer-native round 7 finding 4: no test in this suite can connect to 16180, the live board\'s port', () => {
  /* The check itself, never a socket: even with the check removed, this test cannot send anything to 16180. */
  assert.throws(() => refuseTheLiveBoardPort([{ host: '127.0.0.1', port: LIVE_BOARD_PORT }]), /16180/);
  assert.throws(() => refuseTheLiveBoardPort([[{ host: '127.0.0.1', port: LIVE_BOARD_PORT }, null]]), /16180/);
  assert.throws(() => refuseTheLiveBoardPort([LIVE_BOARD_PORT, '127.0.0.1']), /16180/);
  assert.doesNotThrow(() => refuseTheLiveBoardPort([{ host: '127.0.0.1', port: 9 }]));
  assert.equal(net.Socket.prototype.connect.name, 'connectAnywhereButTheLiveBoard', 'the check is not on every connection');
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

// ── #2983: the serve-here signal the launcher waits on ─────────────────────

test('#2983 serve-here writes the launcher\'s signal (its pid); a successful hand-off does not', async () => {
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-serve-signal-2983-'));
  try {
    // A board that serves here (a source checkout skips the hand-off) writes the
    // file the launcher waits on, so the box appears on proof, not on a timer.
    const serveHerePath = nodePath.join(dir, 'serve-here.signal');
    const served = await handOffToTask(world().opts({ bundle: false, signalEnv: { [SERVE_HERE_SIGNAL_ENV]: serveHerePath } }));
    assert.equal(served.serve, true);
    assert.equal(fs.readFileSync(serveHerePath, 'utf8'), String(process.pid),
      'the board that serves here did not write the signal the launcher waits on, or wrote something other than its pid');

    // A board that hands off (its own build already answers) must NOT write it: a
    // signal there is exactly the false "running from here" box #2983 removes.
    const handOffPath = nodePath.join(dir, 'hand-off.signal');
    const handedOff = await handOffToTask(world({ occupant: MINE }).opts({ signalEnv: { [SERVE_HERE_SIGNAL_ENV]: handOffPath } }));
    assert.equal(handedOff.serve, false, handedOff.because);
    assert.equal(fs.existsSync(handOffPath), false, 'a board that handed off to its task still wrote the serve-here signal');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('#2983 the signal is silent when none was asked, and never throws when it cannot be written', async () => {
  // No variable set: nothing to write, and the serve decision is unchanged.
  const quiet = await handOffToTask(world().opts({ bundle: false, signalEnv: {} }));
  assert.equal(quiet.serve, true);
  // An unwritable path (a parent that does not exist) is swallowed: the board still
  // serves, and the launcher's listener proof stands.
  const bad = nodePath.join(os.tmpdir(), 'aw-2983-no-such-dir-' + process.pid, 'x', 'serve.signal');
  const served = await handOffToTask(world().opts({ bundle: false, signalEnv: { [SERVE_HERE_SIGNAL_ENV]: bad } }));
  assert.equal(served.serve, true, 'a failed signal write must not change the serve decision');
  assert.equal(fs.existsSync(bad), false);
});

test('#2983 signalServingHere reads the real process env by default, one spelling for the C# launcher', () => {
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-serve-signal-env-2983-'));
  const before = process.env[SERVE_HERE_SIGNAL_ENV];
  try {
    const at = nodePath.join(dir, 'via-process-env.signal');
    process.env[SERVE_HERE_SIGNAL_ENV] = at;
    signalServingHere(); // no env argument: the path the real board reads from process.env
    assert.equal(fs.readFileSync(at, 'utf8'), String(process.pid));
    assert.equal(SERVE_HERE_SIGNAL_ENV, 'KOSMOS_SERVE_HERE_SIGNAL',
      'the serve-here env var name drifted from the C# launcher\'s ServeHereSignalEnvVar copy');
  } finally {
    if (before === undefined) delete process.env[SERVE_HERE_SIGNAL_ENV]; else process.env[SERVE_HERE_SIGNAL_ENV] = before;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
