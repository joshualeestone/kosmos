'use strict';
/**
 * #3431: the win32 restart path VERIFIES the supervisor actually came up.
 *
 * 🛑 WHY THIS FILE EXISTS. `remove.js`'s restart confirms, after /End+/Run, that
 * the agent is really back. On the Mac that is a `launchctl print` "loaded" probe
 * (#3418, Nora). On Windows the confirmation used to be `win32job.status().registered`,
 * which proves only that the TASK EXISTS -- a /Run that returned ok but whose
 * supervisor never started would still register as loaded, the win32 shape of Nora.
 * This asserts the closed gap: the restart reads a genuine liveness signal
 * (win32streamstate.liveIdentity, the { pid, sessionId } the supervisor authors),
 * polled with a timeout and discriminated against a pre-restart baseline so a dying
 * supervisor's leftover state file is never accepted as the new one.
 *
 * 🔑 DRIVEN THROUGH `remove.restart` with `platform:'win32'`, from either kind of
 * box -- the same cross-platform-from-either posture as remove.win32-job-570.test.js.
 * The liveness marker is injected via win32job.setLiveness, and a fake clock via
 * win32job.setRunningClock so the timeout cases pass with NO real time.
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

/* A dummy Mac runner so we can leave dry-run: the win32 path never shells it (it
   uses the win32job / win32stop seams), but restartInner's disruption bookkeeping
   is gated on `!(DRY_RUN && !runner)`, and setDryRun(false) refuses with no runner. */
function armLive() {
  remove.setRunner(() => ({ ok: true }));
  remove.setDryRun(false);
}

/** Record schtasks arg vectors; answer /Query as a registered, enabled task. */
function recordingTasks() {
  const calls = [];
  job.setRunner((args) => {
    calls.push(args.join(' '));
    if (args.includes('/Query')) return { ok: true, out: 'TaskName: Kosmos\\agent-x\nStatus: Ready' };
    return { ok: true, out: '' };
  });
  return calls;
}

/** The board sees a live, ours-tied session under this name. */
function boardShowsLive(name) {
  status.setPaneSource(() => fleet.line({ session: name, claim: name, title: '✳ Claude Code' }));
}

/** The kill step (sessionOps('win32').end) can confirm the session is gone. */
function killSucceeds(name) {
  stop.setLive(() => new Map([[name, { sessionId: 'gone', pid: 4242, status: 'busy' }]]));
  stop.setRunner(() => ({ ok: true, out: '' }));
  stop.setAlive(() => false);
}

/** Write a REAL pre-restart baseline state file, the way the supervisor would. */
function writeBaseline(name, pid, sessionId) {
  streamstate.publisher(name).started(pid, sessionId);
  const id = streamstate.liveIdentity(name);
  assert.deepEqual(id, { pid, sessionId }, 'control: the baseline state file was not written');
}

/** A fake clock so the poll's deadline is reached with no real time passing. */
function fakeClock() {
  let t = 0;
  job.setRunningClock(() => t, (ms) => { t += ms; });
}

function reset(name) {
  job.setRunner(null);            // also clears the liveness + clock seams
  remove.setRunner(null);
  stop.setLive(null); stop.setRunner(null); stop.setAlive(null);
  status.setPaneSource(null);
  if (name) disruption.clear(name);
}

test.after(() => reset(null));

test('#3431 (a) happy live restart: RESTARTED, /End before /Run, and a real liveness check', () => {
  const name = 'winlive';
  const calls = recordingTasks();
  boardShowsLive(name);
  killSucceeds(name);
  writeBaseline(name, 100, 'old');                 // beforeRestart reads this real file
  const seen = [];
  job.setLiveness((n) => { seen.push(n); return { pid: process.pid, sessionId: 'new' }; }); // alive, new session
  fakeClock();
  armLive();
  try {
    const out = remove.restart(name, 'restart', { platform: 'win32', startIfDead: true });
    assert.equal(out.outcome, remove.OUTCOME.RESTARTED, out.because);

    const endAt = calls.findIndex((c) => /\/End/.test(c));
    const runAt = calls.findIndex((c) => /\/Run/.test(c));
    assert.ok(endAt >= 0 && runAt >= 0, 'both /End and /Run ran: ' + JSON.stringify(calls));
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
  recordingTasks();
  boardShowsLive(name);
  killSucceeds(name);
  writeBaseline(name, 100, 'old');
  job.setLiveness(() => null);                     // the supervisor never writes a live identity
  fakeClock();
  armLive();
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
  const calls = recordingTasks();
  status.setPaneSource(() => '');                  // FOUND.NONE: a task, but nothing running
  // No baseline file: beforeRestart reads null, the fully-dead start.
  assert.equal(streamstate.liveIdentity(name), null, 'control: there must be no baseline for a dead agent');
  job.setLiveness(() => ({ pid: process.pid, sessionId: 'fresh' }));
  fakeClock();
  armLive();
  try {
    const out = remove.restart(name, 'restart', { platform: 'win32', startIfDead: true });
    assert.equal(out.outcome, remove.OUTCOME.RESTARTED, out.because);
    assert.match(out.because, /starting/, 'a started dead agent should read as starting');
    assert.doesNotMatch(out.because, /starting again|again\b/,
      'a never-run agent must not be told it is starting AGAIN');
    // Nothing to close on a dead agent: no /End was needed before /Run.
    assert.ok(calls.some((c) => /\/Run/.test(c)), 'it never ran the task');
  } finally {
    reset(name);
  }
});

test('#3431 (d) stale-file guard: the dying supervisor\'s leftover identity is NOT accepted -> PARTIAL', () => {
  const name = 'winstale';
  recordingTasks();
  boardShowsLive(name);
  killSucceeds(name);
  writeBaseline(name, 100, 'old');
  // The fake keeps returning the SAME identity the baseline held: a leftover file,
  // not evidence a new supervisor came up.
  job.setLiveness(() => ({ pid: 100, sessionId: 'old' }));
  fakeClock();
  armLive();
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
