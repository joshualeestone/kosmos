'use strict';
/**
 * Keeping a Windows agent alive: what launchd gives the Mac for free.
 *
 * 🛑 THE MAC'S SHAPE, WHICH THIS MIRRORS RATHER THAN REINVENTS (Splinter, the
 * 2026-09-07 lifecycle write-up). A Mac agent is a launchd job with
 * `RunAtLoad=true` (start at login), `KeepAlive=true` (respawn on ANY exit) and
 * `ThrottleInterval=30` (a crash-loop limps at 30s instead of spinning). Its
 * ProgramArguments run `bin/agent-supervisor.sh`, which does NOT exit while the
 * agent lives -- it parks in `while tmux has-session; do sleep; done`. The chain
 * is: agent dies -> session vanishes -> loop exits -> supervisor exits ->
 * KeepAlive respawns the supervisor -> it starts a new agent.
 *
 * 🔑 ONE SUPERVISOR FOR EVERY AGENT, NEVER A COPY PER AGENT. That is the Mac's
 * hardest-won rule on this file: the per-agent-copy version "shipped every bug N
 * times". This module is that one implementation; the per-agent facts arrive as
 * arguments.
 *
 * ⚠️ WHERE THIS DELIBERATELY DIVERGES, AND WHY. On the Mac the RESPAWN belongs to
 * launchd and the supervisor only watches. Windows has no launchd: the analog is
 * a Scheduled Task, and a task's restart-on-failure keys on a NON-ZERO exit, so a
 * supervisor that exited cleanly when its agent died would not be restarted at
 * all. Rather than encode the respawn in a task setting whose semantics differ
 * from KeepAlive's, the loop lives HERE -- respawn and throttle in code, where
 * both are testable from any platform. The task keeps only the half Windows does
 * well: start at logon, and restart the supervisor itself if IT dies.
 *
 *      launchd                          this module
 *      RunAtLoad ......................  Scheduled Task, at-logon trigger
 *      KeepAlive ......................  the respawn loop below
 *      ThrottleInterval 30 ............  THROTTLE_MS below
 *      supervisor parks on has-session   watch() polls the recorded session id
 *
 * ⚠️ AND A REBOOT NEEDS A LOGIN, on both platforms. launchd's RunAtLoad is a
 * per-user agent: it fires at the next USER LOGIN, not at headless boot. An
 * at-logon Scheduled Task has exactly the same property, so this does not paper
 * over the difference -- a box that reboots to a locked login screen brings no
 * fleet back on either OS until somebody signs in.
 */

const cp = require('node:child_process');

const win32launch = require('./win32launch');
const win32sessions = require('./win32sessions');

/* The Mac's ThrottleInterval, in the same units the Mac states it. A crash-loop
   must limp, not spin: without this a agent that dies instantly would be
   respawned as fast as the loop runs, which is a fork bomb with extra steps. */
const THROTTLE_MS = 30 * 1000;

/* How often the watch loop asks whether the agent is still there. The Mac's
   `tmux has-session` poll is the same idea; this is cheap (one `claude agents
   --json`) and 5s is far below any human-visible restart delay. */
const POLL_MS = 5 * 1000;

/* The liveness seam. Tests replace it; production asks the runner. Returns the
   array `claude agents --json` produces, or null when we could not ask -- and
   NULL IS NOT DEATH, which is the distinction the whole loop turns on. */
let liveFn = null;
function setLiveReader(fn) { liveFn = typeof fn === 'function' ? fn : null; }
function liveSessions() {
  if (liveFn) return liveFn();
  try {
    const out = cp.execFileSync('claude', ['agents', '--json'], { encoding: 'utf8', timeout: 15000 });
    const v = JSON.parse(out);
    return Array.isArray(v) ? v : null;
  } catch { return null; }
}

/**
 * Is this session still running?
 *
 * 🛑 THREE ANSWERS, NOT TWO, and collapsing them is how a fleet eats itself.
 * `true` it is alive; `false` it is provably gone; `null` WE COULD NOT ASK.
 * Treating null as death would respawn a healthy agent every time the runner was
 * briefly unreadable -- and then adopt-not-replace would be the only thing
 * standing between that and two agents under one name.
 */
function isAlive(sessionId, live) {
  const list = live === undefined ? liveSessions() : live;
  if (list === null) return null;
  return list.some((a) => a && a.sessionId === sessionId);
}

/**
 * Is somebody ELSE already running under this name?
 *
 * ⚠️ ADOPT, NEVER REPLACE -- and on a foreign session, WAIT. The Mac's supervisor
 * adopts an existing healthy session and only creates one when none exists; a
 * same-named session it does not own makes it wait rather than kill. Killing
 * would let a stale supervisor take out a live agent, so the conservative answer
 * is the safe one in both directions.
 */
function ourLiveSession(name, live) {
  const list = live === undefined ? liveSessions() : live;
  if (list === null) return null;
  /* The ownership record is the only thing that ties a live session to a Kosmos
     name -- `claude agents --json` reports a cwd-derived name, not ours (measured:
     a session recorded as `winagent-1` reports itself as `real-launch-8c`). Read
     once per cycle rather than per session; the record is a single small file. */
  let recorded;
  try { recorded = win32sessions.read(); } catch { return null; }
  if (!recorded) return null;
  for (const a of list) {
    if (!a || !a.sessionId) continue;
    const rec = recorded[a.sessionId];
    if (rec && rec.name === name) return a.sessionId;
  }
  return null;
}

/**
 * One supervision cycle: make sure an agent for `spec` is running, and return
 * what happened. Pure-ish -- it does no waiting, so a test can drive the whole
 * state machine without a clock.
 *
 * Returns { action, sessionId?, because? } where action is one of:
 *   'adopted'   an agent for this name was already live; we did not start one
 *   'started'   none was live, so we launched
 *   'waiting'   we could not ask the runner -- do NOTHING, ask again later
 *   'refused'   the launch itself was refused (trust, a bad folder, a dead spawn)
 */
function ensureRunning(spec) {
  const s = spec || {};
  const live = liveSessions();
  if (live === null) {
    /* ⚠️ THE MOST IMPORTANT BRANCH IN THE FILE. An unreadable runner is not an
       absent agent. Starting one here is how a transient failure becomes two
       agents under one name -- the exact collision adopt-not-replace exists to
       prevent, arriving through the back door. */
    return { action: 'waiting', because: 'we could not ask which agents are running, so we changed nothing' };
  }

  const mine = ourLiveSession(s.name, live);
  if (mine) return { action: 'adopted', sessionId: mine };

  const r = win32launch.launch({
    name: s.name, runner: s.runner, cwd: s.cwd,
    claudeBin: s.claudeBin, configDir: s.configDir, model: s.model,
    platform: s.platform || 'win32',
  });
  if (!r.ok) return { action: 'refused', because: r.because };
  return { action: 'started', sessionId: r.sessionId };
}

/**
 * The supervision loop. Runs until `stop()` is called on the returned handle --
 * it does NOT exit when the agent dies, because on this platform there is no
 * KeepAlive above it to notice.
 *
 * `sleep` is injected so a test can drive years of supervision in milliseconds.
 */
function supervise(spec, opts) {
  const o = opts || {};
  const sleep = o.sleep || ((ms) => new Promise((res) => setTimeout(res, ms)));
  const throttleMs = o.throttleMs === undefined ? THROTTLE_MS : o.throttleMs;
  const pollMs = o.pollMs === undefined ? POLL_MS : o.pollMs;
  const onEvent = typeof o.onEvent === 'function' ? o.onEvent : () => {};

  let running = true;
  const handle = { stop() { running = false; } };

  handle.done = (async () => {
    let lastStart = 0;
    while (running) {
      const now = o.now ? o.now() : Date.now();
      /* THE THROTTLE, and it gates the START rather than the loop: a healthy
         adopted agent must not be made to wait 30s to be noticed, but a crashing
         one must not be restarted faster than that. */
      const sinceStart = now - lastStart;
      if (lastStart && sinceStart < throttleMs) {
        const alive = isAlive(handle.sessionId, undefined);
        if (alive === true) { await sleep(pollMs); continue; }
        onEvent({ action: 'throttled', waitMs: throttleMs - sinceStart });
        await sleep(Math.min(pollMs, throttleMs - sinceStart));
        continue;
      }

      const r = ensureRunning(spec);
      onEvent(r);
      if (r.action === 'started') { lastStart = now; handle.sessionId = r.sessionId; }
      else if (r.action === 'adopted') { handle.sessionId = r.sessionId; }
      await sleep(pollMs);
    }
  })();

  return handle;
}

/**
 * The argument vector the Scheduled Task runs.
 *
 * 🔑 POSITIONAL, APPEND-ONLY, EVERY NEW ONE OPTIONAL AND DEFAULTED -- the Mac's
 * contract for `agent-supervisor.sh`, adopted deliberately. There is ONE
 * supervisor for every agent (the per-agent-copy version "shipped every bug N
 * times"), so the per-agent facts have to arrive as arguments, and a task
 * registered last week must keep working when a new argument is added. NEVER
 * REORDER THESE; add to the end.
 *
 *   argv:  <name> <cwd> [model] [configDir] [runner]
 */
function specFromArgv(argv) {
  const a = Array.isArray(argv) ? argv : [];
  const at = (i) => (typeof a[i] === 'string' && a[i] !== '' && a[i] !== '-' ? a[i] : undefined);
  return {
    name: at(0),
    cwd: at(1),
    model: at(2),
    configDir: at(3),
    runner: at(4) || 'claude',
  };
}

/**
 * The process entry point.
 *
 * 🔑 EXPORTED, BECAUSE THE TASK NO LONGER RUNS THIS FILE DIRECTLY. A Scheduled
 * Task is durable and this file is not: it lives under the extract root, which
 * moves with every update (see engine/win32anchor.js). The task runs the anchored
 * shim instead, and the shim resolves the current engine and calls THIS. Keeping
 * the `require.main` guard as well means the file still runs standalone, which is
 * how it gets driven by hand on the box.
 */
function main(argv) {
  const spec = specFromArgv(argv);
  if (!spec.name || !spec.cwd) {
    process.stderr.write('kosmos win32 supervisor: needs <name> <cwd>\n');
    process.exit(2);
  }
  const handle = supervise(spec, {
    onEvent: (e) => {
      /* One line per transition, on stderr so a task log captures it. Bounded by
         being one short line per POLL_MS, and only on a CHANGE would be better --
         noted rather than done, because a supervisor that hides a restart storm
         is worse than one that is chatty about it. */
      if (e.action === 'adopted') return;   // the steady state; do not narrate it
      process.stderr.write(new Date().toISOString() + ' ' + spec.name + ' ' + e.action
        + (e.because ? ' -- ' + e.because : '') + '\n');
    },
  });
  const bye = () => { handle.stop(); };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
  return handle;
}

/* istanbul ignore next -- the process wrapper; the state machine above is what
   the tests drive. */
if (require.main === module) main(process.argv.slice(2));

module.exports = {
  THROTTLE_MS, POLL_MS,
  isAlive, ourLiveSession, ensureRunning, supervise, specFromArgv,
  setLiveReader, liveSessions, main,
};
