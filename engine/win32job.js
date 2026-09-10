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
const fs = require('node:fs');
const os = require('node:os');
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

/* The anchor seam, alongside the command seam above and for the same reason.
   Tests replace it so a suite never copies a 92 MB interpreter, and never asks a
   Mac to write a Windows path -- both of which happen the moment `installJob` is
   driven with `platform: 'win32'` from the fleet's Macs, which is exactly how
   this branch is asserted. Production anchors for real. */
let anchorFn = null;
function setAnchorer(fn) { anchorFn = typeof fn === 'function' ? fn : null; }
function anchorFor(spec) {
  return anchorFn ? anchorFn(spec) : win32anchor.ensureAnchored(spec);
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
function taskExec(spec) {
  const s = spec || {};
  const node = s.node || process.execPath;
  const supervisor = s.supervisor || path.resolve(__dirname, 'win32supervisor.js');
  /* Positional and append-only; see specFromArgv. A missing middle argument is
     '-' rather than omitted, so position never shifts. */
  const argv = [s.name, s.cwd, s.model || '-', s.configDir || '-', s.runner || 'claude'];
  return {
    command: node,
    args: ['"' + supervisor + '"'].concat(argv.map((a) => '"' + String(a) + '"')).join(' '),
  };
}

/* XML, not a command line, so the five characters that end an element or an
   attribute cannot come from a path. `C:\a & b\node.exe` is an ordinary folder. */
function xmlEscape(v) {
  return String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * Whose logon starts this. `DOMAIN\user`, injectable so a Mac can assert it.
 *
 * ⚠️ FIELD-BY-FIELD FALLBACK TO THE REAL ENVIRONMENT, and it is load-bearing
 * rather than defensive. `install` passes the caller's `env` -- which exists so a
 * test can redirect the ANCHOR to a sandbox, and such an env carries no
 * USERNAME. Reading it wholesale produced `<UserId></UserId>`: a definition
 * schtasks rejects, from a function whose unit test passed. Caught by the test
 * asserting the trigger names a user, which is exactly the assertion that looked
 * like belt-and-braces when it was written.
 */
function taskUser(env) {
  const e = env || {};
  const p = process.env;
  const domain = e.USERDOMAIN || e.COMPUTERNAME || p.USERDOMAIN || p.COMPUTERNAME || '';
  /* 🔑 `os.userInfo()` IS THE LAST FALLBACK, AND IT IS WHAT LETS A MAC ASSERT THIS
     ARM. `USERNAME` is a Windows spelling; POSIX sets `USER`. So on the fleet's
     CI -- which is a Mac, and which drives this module with `platform: 'win32'`
     exactly as the branch's discipline requires -- `taskUser` found nothing and
     `install` refused with "we could not tell which user this computer signs in
     as". Five win32 tests were red there for that one reason, on a branch whose
     whole method is that a Mac can exercise the Windows arm.

     ⚠️ AND IT IS NOT A TEST ACCOMMODATION. `os.userInfo().username` is the account
     this process actually runs as, which is precisely what the task's principal
     and logon trigger have to name; on Windows it agrees with `USERNAME`. An env
     that carries the field still wins, so the sandbox seam (#570 defect 4, where
     an injected env with no USERNAME produced an empty `<UserId>`) is unchanged --
     this only replaces "give up" with "ask the operating system". */
  let user = e.USERNAME || p.USERNAME || '';
  if (!user) {
    try { user = (os.userInfo() || {}).username || ''; } catch { user = ''; }
  }
  if (!user) return '';
  return domain ? domain + '\\' + user : user;
}

/**
 * The task definition, as XML.
 *
 * 🛑 THIS IS NOT A STYLE CHOICE -- `/SC ONLOGON` CANNOT BE USED. Measured on a
 * real box, 2026-09-08, unelevated: `schtasks /Create /SC ONLOGON` fails with
 * "ERROR: Access is denied.", while `/SC ONCE` and `/SC MINUTE` succeed from the
 * same shell. Task creation is not the problem; that trigger is. `/SC ONLOGON`
 * builds a LogonTrigger with NO UserId, which means "at any user's logon" -- a
 * machine-wide act, so Windows requires administrator. Adding `/RU`, `/IT` or
 * dropping `/RL` does not help; all four spellings were tried and all four were
 * denied.
 *
 * 🔑 A LOGON TRIGGER SCOPED TO ONE USER NEEDS NO ELEVATION, which is also the
 * honest shape: this is launchd's RunAtLoad analog, and RunAtLoad is a per-USER
 * agent. So the trigger and the principal both name the current user, and the
 * task is created from XML. Verified unelevated end to end -- create, query,
 * disable, enable, run, end, delete.
 *
 * ⚠️ REQUIRING ADMIN WOULD HAVE BEEN A PRODUCT DEFECT, NOT AN INCONVENIENCE.
 * Kosmos is a desktop app a person runs as themselves; a fleet that could only be
 * made durable from an elevated prompt would have shipped a keep-alive that
 * silently failed for every ordinary user -- and failed at REGISTRATION, hours
 * before the logon where anyone would notice.
 *
 * `ExecutionTimeLimit PT0S` is "no limit": the supervisor is meant to run for as
 * long as the box is up, and the default three days would kill the fleet mid-week.
 * `IgnoreNew` is the multiple-instances policy that matches adopt-not-replace --
 * a second logon must not start a second supervisor for the same agent.
 */
function taskXml(spec, env) {
  const exec = taskExec(spec);
  const user = xmlEscape(taskUser(env));
  return '<?xml version="1.0" encoding="UTF-16"?>\n'
    + '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">\n'
    + '  <RegistrationInfo><Description>Kosmos agent ' + xmlEscape(spec && spec.name) + '</Description></RegistrationInfo>\n'
    + '  <Triggers><LogonTrigger><Enabled>true</Enabled><UserId>' + user + '</UserId></LogonTrigger></Triggers>\n'
    + '  <Principals><Principal id="Author"><UserId>' + user + '</UserId>'
    + '<LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>\n'
    + '  <Settings>'
    + '<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>'
    + '<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>'
    + '<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>'
    + '<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>'
    + '<Enabled>true</Enabled>'
    + '</Settings>\n'
    + '  <Actions Context="Author"><Exec>'
    + '<Command>' + xmlEscape(exec.command) + '</Command>'
    + '<Arguments>' + xmlEscape(exec.args) + '</Arguments>'
    + '</Exec></Actions>\n'
    + '</Task>\n';
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
  const anchor = anchorFor({
    platform: s.platform, home: s.home, env: s.env,
    node: s.node, engineDir: s.engineDir,
  });
  if (!anchor.ok) return { ok: false, because: anchor.because };

  /* 🛑 A LOGON TRIGGER NEEDS A USER, and an empty one registers a task that can
     never fire. Refuse with a sentence rather than write a definition schtasks
     will reject with its own opaque one. */
  if (!taskUser(s.env)) {
    return { ok: false, because: 'we could not tell which user this computer signs in as, so a startup job would never run' };
  }

  /* ⚠️ UTF-16 WITH A BOM, because schtasks refuses anything else for /XML -- and
     the file is transient by design: it is consumed by the next line and deleted
     in the `finally`. Nothing durable points at it, so it carries none of the
     ephemeral-path hazard the anchor exists to solve. */
  const xmlAt = path.join(os.tmpdir(), 'kosmos-task-' + process.pid + '-' + Date.now() + '.xml');
  let r;
  try {
    try {
      fs.writeFileSync(xmlAt, Buffer.from('﻿' + taskXml({ ...s, node: anchor.node, supervisor: anchor.boot }, s.env), 'utf16le'));
    } catch (e) {
      return { ok: false, because: 'we could not write the startup job definition (' + ((e && e.message) || 'no detail') + ')' };
    }
    r = run(['/Create', '/F', '/TN', taskName(s.name), '/XML', xmlAt]);
  } finally {
    try { fs.unlinkSync(xmlAt); } catch { /* best effort; it is in the temp root */ }
  }
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

/**
 * End the RUNNING instance -- launchd's `bootout`, and the other half of a stop.
 *
 * 🛑 DISABLING IS NOT STOPPING, and on this platform the gap is wider than on the
 * Mac. `disable` only decides what happens at the NEXT logon; the supervisor
 * started at the last one is still looping, and it will faithfully restart the
 * agent it is watching. A "stop" that only disabled would leave the agent running
 * and tell the person it had stopped -- so both acts are required, in the order
 * `remove.js` already documents for the Mac (disable first, so a login in the
 * window between the two cannot bring it back).
 */
function end(name) {
  const r = run(['/End', '/TN', taskName(name)]);
  /* A task that is not running is the end state we wanted -- the same posture the
     Mac takes toward launchd's exit 3 ("no such service"). */
  if (!r.ok && !/not running|cannot find|does not exist/i.test(r.out || '')) {
    return { ok: false, because: 'we could not stop it now (' + (r.out || '').trim().split('\n')[0] + ')' };
  }
  return { ok: true };
}

/**
 * Run it NOW without waiting for a logon -- launchd's `bootstrap`, and the other
 * half of a restore. `enable` alone would leave the agent off until the person
 * next signed in, which is not what "start it again" says.
 */
function start(name) {
  const r = run(['/Run', '/TN', taskName(name)]);
  if (!r.ok) return { ok: false, because: 'we could not start it again now (' + (r.out || '').trim().split('\n')[0] + ')' };
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
  TASK_PREFIX, taskName, taskExec, taskXml, taskUser, xmlEscape,
  install, disable, enable, end, start, remove, status,
  setRunner, setAnchorer,
};
