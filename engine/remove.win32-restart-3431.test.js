'use strict';
/**
 * #3431 + #6183: the win32 restart path VERIFIES the supervisor came up, and (as of #6183) runs
 * its commands as ASYNC STEPS so an account-move restart does not block the board thread.
 *
 * 🛑 WHY THIS FILE EXISTS. `remove.js`'s restart confirms, after /End+/Run, that the agent is really
 * back. On the Mac that is a `launchctl print` "loaded" probe (#3418, Nora). On Windows the
 * confirmation used to be `win32job.status().registered`, which proves only that the TASK EXISTS -- a
 * /Run that returned ok but whose supervisor never started would still register as loaded, the win32
 * shape of Nora. The restart reads a genuine liveness signal (win32streamstate.liveIdentity) instead,
 * polled with a timeout and discriminated against a pre-restart baseline.
 *
 * 🔑 #6183: the restart acts are now STEPS. `jobOps('win32').steps` (endSteps/startSteps/runningSteps)
 * and `sessionOps('win32').endSteps` yield each schtasks/taskkill call to remove.js's run()/runAsync,
 * so the async driver runs the restart off the board's thread. The schtasks /End, /Run and the taskkill
 * therefore route through remove.js's runner (recorded via remove.setRunner / remove.setAsyncRunner),
 * NOT through win32job's/win32stop's own seams. win32job.run() still serves /Query (win32job.status),
 * so a job runner answers that; the liveness signal stays on win32job.setLiveness. The runningSteps poll
 * yields { sleep } between in-generator state-file reads, so the sync sleep seam no longer advances the
 * clock -- the fake clock below advances `now` itself.
 *
 *   node --test engine/remove.win32-restart-3431.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

// ⚠️ SANDBOX BEFORE REQUIRING, every root this path writes to. remove.js STOPS
// agents and win32streamstate + disruption keep files under AGENT_WORKFORCE_DATA;
// an unsandboxed run would touch the live fleet's state on this box.
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'remove-win32-restart-3431-'));
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'LaunchAgents');
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'support');
process.on('exit', () => {
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

const remove = require('./remove');
const job = require('./win32job');
const stop = require('./win32stop');
const streamstate = require('./win32streamstate');
const status = require('./status');
const disruption = require('./disruption');
const fleet = require('../test-support/fleet');

/* #6183: the restart's commands (schtasks /End, /Run; taskkill) now route through remove.js's run() --
   the win32 steps yield { exec }, answered by remove's runner -- so record them THERE. win32job.run()
   still serves /Query (win32job.status), so keep a job runner that answers it. remove's runner returns
   the { ok, stdout } shape; the win32 steps normalize it to { ok, out } via win32StepResult. Returns the
   remove-runner call log (each as "file arg arg ..."). */
function recordRemote() {
  const calls = [];
  remove.setRunner((file, args) => { calls.push([file].concat(args).join(' ')); return { ok: true, stdout: '' }; });
  job.setRunner((args) => (args.includes('/Query') ? { ok: true, out: 'TaskName: Kosmos\\agent-x\nStatus: Ready' } : { ok: true, out: '' }));
  return calls;
}

/** The board sees a live, ours-tied session under this name. */
function boardShowsLive(name) {
  status.setPaneSource(() => fleet.line({ session: name, claim: name, title: '✳ Claude Code' }));
}

/* The session close READS: resolve finds a live session; the look-again says it is gone. The taskkill
   itself now goes through remove's runner (recorded above), not stop.setRunner. */
function killReads(name) {
  stop.setLive(() => new Map([[name, { sessionId: 'gone', pid: 4242, status: 'busy' }]]));
  stop.setAlive(() => false);
}

/** Write a REAL pre-restart baseline state file, the way the supervisor would. */
function writeBaseline(name, pid, sessionId) {
  streamstate.publisher(name).started(pid, sessionId);
  const id = streamstate.liveIdentity(name);
  assert.deepEqual(id, { pid, sessionId }, 'control: the baseline state file was not written');
}

/* #6183: runningSteps yields { sleep } between polls (answered by the driver), so the sync sleep seam no
   longer advances the clock. Make `now` jump a full deadline on its SECOND read, so a never-live poll
   gives up at once with no real sleep, while an already-live poll still returns on its first read (which
   happens before the deadline is ever consulted). */
function fastDeadlineClock() {
  let t = 0;
  job.setRunningClock(() => { const v = t; t += 20000; return v; }, () => {});
}

/* A bounded synchronous block, standing in for execFileSync's blocking time, for the sync-control test. */
function blockMs(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(0, ms | 0)); } catch { /* no SAB */ }
}

/* Drive a win32 step generator synchronously, collecting the exec specs it yields and feeding each the
   given answer; a { sleep } yield (the board-freeing wait) is counted and continued. Returns the
   generator's return value, the exec specs sent, and how many sleeps it yielded. */
function driveWin32(gen, answerExec) {
  const sent = [];
  let sleeps = 0;
  let res = gen.next();
  while (!res.done) {
    if (res.value && res.value.sleep !== undefined) { sleeps += 1; res = gen.next(); continue; }
    assert.ok(res.value && Array.isArray(res.value.exec), 'a win32 step yielded neither exec nor sleep: ' + JSON.stringify(res.value));
    sent.push(res.value.exec);
    res = gen.next(answerExec(res.value.exec));
  }
  return { ret: res.value, sent, sleeps };
}

function reset(name) {
  job.setRunner(null);            // also clears the liveness + clock seams
  remove.setRunner(null); remove.setAsyncRunner(null); remove.setDryRun(true);
  stop.setLive(null); stop.setRunner(null); stop.setAlive(null);
  status.setPaneSource(null);
  if (name) disruption.clear(name);
}

test.after(() => reset(null));

test('#3431 (a) happy live restart: RESTARTED, /End before /Run through the async-capable runner, and a real liveness check', () => {
  const name = 'winlive';
  const calls = recordRemote();
  boardShowsLive(name);
  killReads(name);
  writeBaseline(name, 100, 'old');                 // beforeRestart reads this real file
  const seen = [];
  job.setLiveness((n) => { seen.push(n); return { pid: process.pid, sessionId: 'new' }; }); // alive, new session
  fastDeadlineClock();
  remove.setDryRun(false);
  try {
    const out = remove.restart(name, 'restart', { platform: 'win32', startIfDead: true });
    assert.equal(out.outcome, remove.OUTCOME.RESTARTED, out.because);

    const endAt = calls.findIndex((c) => /schtasks.*\/End\b/.test(c));
    const runAt = calls.findIndex((c) => /schtasks.*\/Run\b/.test(c));
    assert.ok(endAt >= 0 && runAt >= 0, 'both /End and /Run ran through remove.js run(): ' + JSON.stringify(calls));
    assert.ok(endAt < runAt, '/End must precede /Run: ' + JSON.stringify(calls));

    assert.ok(seen.includes(name), 'the loaded step never consulted the liveness signal');
    assert.doesNotMatch(out.because, /is running|is back\b/,
      'the verdict claims the agent is up when only its window is coming back');
  } finally {
    reset(name);
  }
});

test('#3431 (b) the win32 Nora: /Run ok but the supervisor never comes up -> PARTIAL, not a false RESTARTED', () => {
  const name = 'winnora';
  recordRemote();
  boardShowsLive(name);
  killReads(name);
  writeBaseline(name, 100, 'old');
  job.setLiveness(() => null);                     // the supervisor never writes a live identity
  fastDeadlineClock();
  remove.setDryRun(false);
  try {
    /* THE OLD SIGNAL WOULD HAVE PASSED: the task stays registered throughout. */
    assert.equal(job.status(name).registered, true,
      'control: the pre-#3431 signal (task registration) reads as loaded here');

    const out = remove.restart(name, 'restart', { platform: 'win32', startIfDead: true });
    assert.equal(out.outcome, remove.OUTCOME.PARTIAL, out.because);
    assert.match(out.because, /supervisor never came up/,
      'it must say the supervisor never came up, not borrow the Mac launchd wording');
    assert.doesNotMatch(out.because, /starting|is back\b/,
      'it claims the agent is coming back when its supervisor never started');
    /* #2019 seam: a down agent must not be left marked restarting. */
    assert.ok(!disruption.active(name),
      'a failed restart left the agent marked restarting');
  } finally {
    reset(name);
  }
});

test('#3431 (c) fromDead happy: no baseline, a live identity appears after /Run -> RESTARTED, "starting" not "again"', () => {
  const name = 'windead';
  const calls = recordRemote();
  status.setPaneSource(() => '');                  // FOUND.NONE: a task, but nothing running
  // No baseline file: beforeRestart reads null, the fully-dead start.
  assert.equal(streamstate.liveIdentity(name), null, 'control: there must be no baseline for a dead agent');
  job.setLiveness(() => ({ pid: process.pid, sessionId: 'fresh' }));
  fastDeadlineClock();
  remove.setDryRun(false);
  try {
    const out = remove.restart(name, 'restart', { platform: 'win32', startIfDead: true });
    assert.equal(out.outcome, remove.OUTCOME.RESTARTED, out.because);
    assert.match(out.because, /starting/, 'a started dead agent should read as starting');
    assert.doesNotMatch(out.because, /starting again|again\b/,
      'a never-run agent must not be told it is starting AGAIN');
    // Nothing to close on a dead agent: no /End was needed before /Run.
    assert.ok(calls.some((c) => /schtasks.*\/Run\b/.test(c)), 'it never ran the task');
  } finally {
    reset(name);
  }
});

test('#3431 (d) stale-file guard: the dying supervisor\'s leftover identity is NOT accepted -> PARTIAL', () => {
  const name = 'winstale';
  recordRemote();
  boardShowsLive(name);
  killReads(name);
  writeBaseline(name, 100, 'old');
  // The fake keeps returning the SAME identity the baseline held: a leftover file,
  // not evidence a new supervisor came up.
  job.setLiveness(() => ({ pid: 100, sessionId: 'old' }));
  fastDeadlineClock();
  remove.setDryRun(false);
  try {
    const out = remove.restart(name, 'restart', { platform: 'win32', startIfDead: true });
    assert.equal(out.outcome, remove.OUTCOME.PARTIAL, out.because);
    assert.match(out.because, /supervisor never came up/,
      'a leftover state file matching the pre-restart baseline must not read as a live restart');
    assert.ok(!disruption.active(name), 'a failed restart left the agent marked restarting');
  } finally {
    reset(name);
  }
});

test('#6183: an async win32 restart sends every schtasks/taskkill through the async runner, never the synchronous one', async () => {
  const name = 'winasync';
  const syncCalls = [], asyncCalls = [];
  remove.setRunner((file, args) => { syncCalls.push([file].concat(args).join(' ')); return { ok: false, code: 99 }; }); // the blocking runner: must never be asked
  remove.setAsyncRunner(async (file, args) => { asyncCalls.push([file].concat(args).join(' ')); return { ok: true, stdout: '' }; });
  job.setRunner((args) => (args.includes('/Query') ? { ok: true, out: 'Status: Ready' } : { ok: true, out: '' }));
  boardShowsLive(name);
  killReads(name);
  writeBaseline(name, 100, 'old');
  job.setLiveness(() => ({ pid: process.pid, sessionId: 'new' }));
  fastDeadlineClock();
  remove.setDryRun(false);
  try {
    const out = await remove.restartAsync(name, 'restart', { platform: 'win32', startIfDead: true });
    assert.equal(out.outcome, remove.OUTCOME.RESTARTED, out.because);
    // The proof the board does not freeze is ROUTING: a restart command holds the board only by going
    // through the synchronous runner, so an empty syncCalls is a deterministic proof none ran inline.
    assert.deepEqual(syncCalls, [], 'a restart command went through the blocking runner: ' + JSON.stringify(syncCalls));
    assert.ok(asyncCalls.some((c) => /taskkill/.test(c)), 'the session close did not go through the async runner: ' + JSON.stringify(asyncCalls));
    const endAt = asyncCalls.findIndex((c) => /schtasks.*\/End\b/.test(c));
    const runAt = asyncCalls.findIndex((c) => /schtasks.*\/Run\b/.test(c));
    assert.ok(endAt >= 0 && runAt >= 0 && endAt < runAt, 'the restart acts did not all run async, /End before /Run: ' + JSON.stringify(asyncCalls));
  } finally {
    reset(name);
  }
});

test('#6183: during an async win32 restart the board keeps turning while the liveness poll waits (a {sleep} is answered by a timer)', async () => {
  const name = 'winwait';
  const syncCalls = [];
  remove.setRunner((file, args) => { syncCalls.push([file].concat(args).join(' ')); return { ok: false, code: 99 }; }); // must never be asked
  remove.setAsyncRunner(async () => ({ ok: true, stdout: '' }));
  job.setRunner((args) => (args.includes('/Query') ? { ok: true, out: 'Status: Ready' } : { ok: true, out: '' }));
  boardShowsLive(name);
  killReads(name);
  writeBaseline(name, 100, 'old');
  // The supervisor comes up only on the SECOND liveness read, so runningSteps yields one { sleep } (the 250 ms
  // default). NO fake clock here: real time passes, and under the async driver that wait is a setTimeout, so the
  // board thread is free during it. A 5 ms interval must therefore fire while the restart is in flight.
  let polls = 0;
  job.setLiveness(() => (++polls >= 2 ? { pid: process.pid, sessionId: 'new' } : null));
  remove.setDryRun(false);
  let fired = 0;
  const iv = setInterval(() => { fired++; }, 5);
  try {
    const out = await remove.restartAsync(name, 'restart', { platform: 'win32', startIfDead: true });
    clearInterval(iv);
    assert.equal(out.outcome, remove.OUTCOME.RESTARTED, out.because);
    assert.deepEqual(syncCalls, [], 'a command went through the blocking runner: ' + JSON.stringify(syncCalls));
    assert.ok(polls >= 2, 'the liveness poll must have waited at least one interval (polls=' + polls + ')');
    assert.ok(fired > 0, 'the board thread did not turn during the async restart: a { sleep } was not answered by a timer');
  } finally {
    clearInterval(iv);
    reset(name);
  }
});

test('#6183 control: a synchronous win32 restart holds the board for the whole of its commands', () => {
  const name = 'winsync';
  remove.setRunner((file, args) => { blockMs(25); return { ok: true, stdout: '' }; }); // execFileSync's blocking time, injected
  job.setRunner((args) => (args.includes('/Query') ? { ok: true, out: 'Status: Ready' } : { ok: true, out: '' }));
  boardShowsLive(name);
  killReads(name);
  writeBaseline(name, 100, 'old');
  job.setLiveness(() => ({ pid: process.pid, sessionId: 'new' }));
  fastDeadlineClock();
  remove.setDryRun(false);
  let fired = 0;
  const iv = setInterval(() => { fired++; }, 5);
  const started = Date.now();
  try {
    const out = remove.restart(name, 'restart', { platform: 'win32', startIfDead: true });
    const took = Date.now() - started;
    clearInterval(iv);
    assert.equal(out.outcome, remove.OUTCOME.RESTARTED, out.because);
    assert.equal(fired, 0, 'a timer fired during a synchronous restart: the board was not actually held');
    assert.ok(took >= 50, 'the sync restart took ' + took + ' ms, too little to show the board was held'); // >= 2 of the 3 x 25 ms commands
  } finally {
    clearInterval(iv);
    reset(name);
  }
});

test('#6183 runningSteps: an already-live pid returns loaded before any sleep (and yields no exec)', () => {
  const r = driveWin32(
    job.runningSteps('a', undefined, { liveIdentity: () => ({ pid: 7, sessionId: 'new' }), isAlive: () => true, now: () => 0 }),
    () => ({}));
  assert.equal(r.ret.ok, true);
  assert.equal(r.sleeps, 0, 'an already-live pid must not yield a sleep');
  assert.equal(r.sent.length, 0, 'the liveness poll is a state-file read, not a command, so it yields no exec');
});

test('#6183 runningSteps: a pid that comes up on the second poll yields exactly one sleep', () => {
  let polls = 0;
  const r = driveWin32(
    job.runningSteps('a', undefined, {
      liveIdentity: () => (++polls >= 2 ? { pid: 7, sessionId: 'new' } : null),
      isAlive: () => true,
      now: () => polls * 1000, // advances, stays under the 12000 ms deadline
    }),
    () => ({}));
  assert.equal(r.ret.ok, true);
  assert.equal(r.sleeps, 1, 'a pid live on the second poll must yield exactly one sleep');
});

test('#6183 runningSteps: a supervisor that never comes up waits, then reports not loaded', () => {
  let t = 0;
  const r = driveWin32(
    job.runningSteps('a', undefined, { liveIdentity: () => null, isAlive: () => false, now: () => { const v = t; t += 5000; return v; }, deadlineMs: 12000 }),
    () => ({}));
  assert.equal(r.ret.ok, false);
  assert.match(r.ret.because, /supervisor did not come up/);
  assert.ok(r.sleeps >= 1, 'it must have waited at least once before giving up');
});

test('#6183 endSteps/startSteps: yield the schtasks command and read a remove-runner result (stdout->out normalized)', () => {
  const uname = job.taskName('a', undefined);
  // A /End whose result is a FAILURE carrying "not running" on stderr is still the end state we wanted.
  const e = driveWin32(job.endSteps('a', undefined), () => ({ ok: false, stderr: 'ERROR: The system cannot ... the task is not running.' }));
  assert.equal(e.ret.ok, true, 'a not-running /End must read as ended (normalized from stderr)');
  assert.deepEqual(e.sent.map((x) => x[0] + ' ' + x[1].join(' ')), ['schtasks.exe /End /TN ' + uname]);
  // A /Run that truly fails is not ok.
  const s = driveWin32(job.startSteps('a', undefined), () => ({ ok: false, stderr: 'ERROR: cannot start' }));
  assert.equal(s.ret.ok, false, 'a failed /Run must not read as started');
  assert.deepEqual(s.sent.map((x) => x[0] + ' ' + x[1].join(' ')), ['schtasks.exe /Run /TN ' + uname]);
});

test('#6183 win32stop.endSteps: resolves the pid (a read), yields ONE taskkill, and finishes via finishKill', () => {
  stop.setLive(() => new Map([['a', { sessionId: 's1', pid: 555 }]]));
  stop.setAlive(() => false);
  try {
    const r = driveWin32(stop.endSteps('a'), (exec) => { assert.equal(exec[0], 'taskkill.exe'); return { ok: true, stdout: '' }; });
    assert.equal(r.ret.ok, true);
    assert.equal(r.sent.length, 1, 'exactly one taskkill is yielded');
    assert.deepEqual(r.sent[0][1], ['/PID', '555', '/T', '/F'], 'the taskkill targets the resolved pid, by pid');
  } finally {
    stop.setLive(null); stop.setAlive(null);
  }
});

test('#6183 win32stop.endSteps: nothing running under the name is the end state, with no taskkill yielded', () => {
  stop.setLive(() => new Map());
  try {
    const r = driveWin32(stop.endSteps('a'), () => { throw new Error('no taskkill should be yielded when nothing is running'); });
    assert.equal(r.ret.ok, true);
    assert.equal(r.ret.already, true);
    assert.equal(r.sent.length, 0);
  } finally {
    stop.setLive(null);
  }
});
