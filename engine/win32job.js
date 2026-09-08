'use strict';
/**
 * The Windows analog of a launchd job: a Scheduled Task per agent.
 *
 * 🛑 WHAT launchd GAVE THE MAC FOR FREE, and what has to be earned here.
 * `create.js` writes a `.plist` with `RunAtLoad` (start at login), `KeepAlive`
 * (respawn on any exit) and `ThrottleInterval=30`. Windows has none of that, so
 * the two halves are split by where each belongs:
 *
 *      RunAtLoad ............ THIS module (an at-logon Scheduled Task)
 *      KeepAlive + Throttle .. engine/win32supervisor.js (the loop, in code)
 *
 * The task starts ONE supervisor per agent at logon; the supervisor keeps that
 * agent alive while the box is up. Neither half covers for the other, and the
 * seam is where the platforms genuinely differ rather than where it was
 * convenient.
 *
 * 🔑 STOP IS A JOB-LEVEL ACT, NOT A KILL -- the distinction Splinter's write-up
 * turns on, and the one that makes "stopped" mean anything. On the Mac a DEATH
 * leaves the job loaded so KeepAlive respawns it; a deliberate STOP is
 * `launchctl bootout` + `launchctl disable`, a persisted per-user override that
 * survives the next login. Here: killing the agent process is a death (the
 * supervisor restarts it, which is correct), and stopping means DISABLING THE
 * TASK. Anything that only killed processes would be undone at the next logon,
 * which is precisely the bug the Mac's ordering comment warns about.
 *
 * ⚠️ AN AT-LOGON TASK NEEDS A LOGIN, and so does launchd's RunAtLoad -- it is a
 * per-user agent, not a system daemon. A box that reboots to a locked login
 * screen brings back no fleet on either platform until somebody signs in. Stated
 * here because "survives a reboot" is exactly the claim people will read into
 * this file, and it is true only once a user logs in.
 */

const cp = require('node:child_process');
const path = require('node:path');

const win32anchor = require('./win32anchor');

/* One namespace so a person reading Task Scheduler can see what these are, and
   so `list()` can find ours without guessing. The Mac's serviceLabel plays the
   same role. */
const TASK_PREFIX = 'Kosmos\\agent-';

function taskName(agentName) { return TASK_PREFIX + String(agentName); }

/* The command seam. Tests replace it; production shells schtasks. Returns
   { ok, out } and never throws, so every caller can report rather than unwind. */
let runFn = null;
function setRunner(fn) { runFn = typeof fn === 'function' ? fn : null; }
function run(args) {
  if (runFn) return runFn(args);
  try {
    const out = cp.execFileSync('schtasks.exe', args, { encoding: 'utf8', timeout: 20000 });
    return { ok: true, out: String(out || '') };
  } catch (e) {
    return { ok: false, out: String((e && (e.stdout || e.message)) || ''), code: (e && e.status) };
  }
}

/**
 * The command line the task runs: a node, an entry script, and the per-agent
 * facts as positional arguments.
 *
 * 🛑 BOTH PATHS MUST BE ANCHORED ONES, NOT THIS APP'S. A task is durable and this
 * app is not -- `process.execPath` and `__dirname` both resolve under the extract
 * root, which a version update replaces (engine/win32anchor.js states the whole
 * defect). `install()` below anchors them first and passes the durable pair.
 * These defaults exist so the function stays callable and testable on its own;
 * they are the EPHEMERAL answer, which is why nothing in production uses them.
 *
 * ⚠️ EVERY PATH QUOTED, because `C:\Program Files\...` is an ordinary install
 * location and an unquoted argument silently truncates at the space -- the task
 * would register fine and run the wrong thing.
 */
function taskCommand(spec) {
  const s = spec || {};
  const node = s.node || process.execPath;
  const supervisor = s.supervisor || path.resolve(__dirname, 'win32supervisor.js');
  /* Positional and append-only; see specFromArgv. A missing middle argument is
     '-' rather than omitted, so position never shifts. */
  const argv = [s.name, s.cwd, s.model || '-', s.configDir || '-', s.runner || 'claude'];
  return '"' + node + '" "' + supervisor + '" ' + argv.map((a) => '"' + String(a) + '"').join(' ');
}

/**
 * Register (or re-register) the at-logon job for one agent.
 *
 * `/F` overwrites an existing task of the same name, which is what makes this
 * idempotent -- re-registering after a spec change is how an account flip or a
 * model change takes effect at the next logon.
 */
function install(spec) {
  const s = spec || {};
  if (!s.name || !s.cwd) return { ok: false, because: 'a job needs an agent name and a folder' };
  /* 🔑 ANCHOR FIRST, THEN REGISTER, and the order is the point: a task built from
     this app's paths outlives the app. `ensureAnchored` copies node out of the
     extract tree and refreshes the shared engine pointer, so the command written
     below names nothing that a version update can take away. A failure here
     refuses the job rather than registering a task that would never start --
     silently, at some logon months from now, which is the worst way to find out. */
  const anchor = win32anchor.ensureAnchored({
    platform: s.platform, home: s.home, env: s.env,
    node: s.node, engineDir: s.engineDir,
  });
  if (!anchor.ok) return { ok: false, because: anchor.because };
  const r = run(['/Create', '/F', '/TN', taskName(s.name), '/SC', 'ONLOGON', '/RL', 'LIMITED',
    '/TR', taskCommand({ ...s, node: anchor.node, supervisor: anchor.boot })]);
  if (!r.ok) return { ok: false, because: 'we could not register the startup job (' + (r.out || 'no detail').trim().split('\n')[0] + ')' };
  return { ok: true, task: taskName(s.name) };
}

/**
 * Stop this agent ACROSS LOGINS. Disabling rather than deleting mirrors
 * `launchctl disable`: the job stays on disk so a later `enable` restores it,
 * and `remove.js` on the Mac records prior state for exactly that reason.
 */
function disable(name) {
  const r = run(['/Change', '/TN', taskName(name), '/DISABLE']);
  if (!r.ok) return { ok: false, because: 'we could not stop it from starting again (' + (r.out || '').trim().split('\n')[0] + ')' };
  return { ok: true };
}

function enable(name) {
  const r = run(['/Change', '/TN', taskName(name), '/ENABLE']);
  if (!r.ok) return { ok: false, because: 'we could not set it to start again (' + (r.out || '').trim().split('\n')[0] + ')' };
  return { ok: true };
}

/** Remove the job entirely (the agent is being deleted, not stopped). */
function remove(name) {
  const r = run(['/Delete', '/F', '/TN', taskName(name)]);
  /* A job that was never registered is already gone -- the same posture
     win32sessions.forget takes, so a delete is idempotent. */
  if (!r.ok && !/cannot find|does not exist/i.test(r.out || '')) {
    return { ok: false, because: 'we could not remove the startup job (' + (r.out || '').trim().split('\n')[0] + ')' };
  }
  return { ok: true };
}

/**
 * Is a job registered for this agent, and is it enabled?
 * Returns { registered, enabled } or { registered:false } -- never throws.
 */
function status(name) {
  const r = run(['/Query', '/TN', taskName(name), '/FO', 'LIST']);
  if (!r.ok) return { registered: false };
  /* schtasks prints a localized "Scheduled Task State" / "Status" line. Read the
     DISABLED token rather than a positive spelling: the disabled word is stable
     across the shapes seen, and defaulting to enabled-when-unsure would claim a
     job is running when we could not tell. Fail toward the honest answer. */
  const disabled = /disabled/i.test(r.out || '');
  return { registered: true, enabled: !disabled };
}

module.exports = {
  TASK_PREFIX, taskName, taskCommand,
  install, disable, enable, remove, status,
  setRunner,
};
