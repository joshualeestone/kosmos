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
    /* ⚠️ stderr PIPED, NOT INHERITED, and that is not tidiness. execFileSync's
       default sends the child's stderr straight to OUR stderr, so every ordinary
       miss printed `ERROR: The system cannot find the file specified.` into the
       board's log. Harmless with a handful of calls; `presence` below is asked
       once per agent by a screen that polls every five seconds, which would turn
       one honest answer into a stream of alarming lines about nothing. */
    const out = cp.execFileSync('schtasks.exe', args, {
      encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, out: String(out || '') };
  } catch (e) {
    /* stderr FIRST: schtasks says why on stderr ("cannot find", "access is
       denied"), and that sentence is both what `presence` reads to tell an
       absent job from an unreadable one and what every `because` shows a
       person. `e.message` carries it too, behind "Command failed: schtasks.exe
       …", so it stays as the last resort rather than the first. */
    const said = (e && (e.stderr || e.stdout)) || '';
    return { ok: false, out: String(said || (e && e.message) || ''), code: (e && e.status) };
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
     '-' rather than omitted, so position never shifts.

     🔑 `claudeBin` IS THE SIXTH AND IT WAS ADDED WITH 7c-2. Once the task became
     the only launcher, everything the agent needs has to survive on this line --
     and the runner's RESOLVED path did not, so a task-started agent fell back to
     a bare `claude` and quietly depended on the logon PATH. `win32launch.binFor`
     treats it as a hint rather than a contract, so a path that goes stale between
     now and some logon months from now falls back instead of stranding the agent. */
  const argv = [s.name, s.cwd, s.model || '-', s.configDir || '-', s.runner || 'claude', s.claudeBin || '-'];
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
 * Wrap a task's command so it runs with NO WINDOW.
 *
 * 🛑 MEASURED 2026-09-10: a task that starts `node.exe` directly opens a visible
 * Windows Terminal window, and closing it kills the agent or board with
 * 0xC000013A, which is exactly what a person does with a stray black window. The
 * same command under `conhost.exe --headless` opens nothing. ONE wrapper for the
 * agent and the board, so the two task definitions cannot drift apart.
 *
 * ⚠️ `/End` then kills only the conhost. The node under it leaves on its own
 * through engine/win32orphan.js, so every Kosmos stop still stops.
 *
 * `SystemRoot` comes from the env passed in (then the real one), so a Mac can
 * assert the Windows shape.
 */
function headlessExec(exec, env) {
  const e = env || {};
  const root = e.SystemRoot || e.SYSTEMROOT || process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows';
  return {
    command: path.win32.join(root, 'System32', 'conhost.exe'),
    args: '--headless "' + exec.command + '" ' + exec.args,
    workingDir: exec.workingDir,
  };
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
  const exec = headlessExec(taskExec(spec), env);
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

/* schtasks' way of saying "there is no such task". It is the ONE token that
   separates a proven absence from a look that failed (access denied, the
   Task Scheduler service stopped, schtasks itself missing) -- `presence` below
   turns on it, and `remove` uses it to stay idempotent. One spelling, two
   readers.
   ⚠️ ENGLISH ONLY, and that is the SAFE direction rather than an oversight: this
   text is localized, so on a non-English Windows an absent job reads as "we
   could not look". `presence` answers UNKNOWN there, and every caller treats
   unknown as "do not claim" -- a screen says nothing instead of saying no. The
   inverse (matching loosely and calling a failed look an absence) is the bug
   this whole change is about. Measured on en-US: ERROR: The system cannot find
   the file specified. */
const NO_SUCH_TASK = /cannot find|does not exist/i;

/** Remove the job entirely (the agent is being deleted, not stopped). */
function remove(name) {
  const r = run(['/Delete', '/F', '/TN', taskName(name)]);
  /* A job that was never registered is already gone -- the same posture
     win32sessions.forget takes, so a delete is idempotent. */
  if (!r.ok && !NO_SUCH_TASK.test(r.out || '')) {
    return { ok: false, because: 'we could not remove the startup job (' + (r.out || '').trim().split('\n')[0] + ')' };
  }
  return { ok: true };
}

/**
 * Is there a job for this agent -- and did we manage to look?
 *
 * 🛑 THE THREE-STATE ANSWER, AND WHY IT EXISTS (#570, roadmap §3b). Several
 * modules answered "does this agent have a startup job?" by stat-ing a `.plist`.
 * On the Mac the plist IS the job, so a missing file is a real no. On Windows no
 * plist is ever written, so those readers did not refuse -- they answered NO,
 * confidently and wrongly, about agents whose Scheduled Task was registered and
 * would bring them back at the next logon (MEASURED on this box: three
 * registered tasks, three `job: false` rows).
 *
 * 🔑 "COULD NOT LOOK" IS NOT "NO", and a boolean cannot say so. `status` below
 * folds both into `registered: false` because its callers act on the job either
 * way (a stop that finds nothing has nothing to stop). The callers HERE make a
 * CLAIM to a person -- "this will not come back", "nothing of it is left" -- and
 * a claim manufactured from a failed look is the exact defect this fixes.
 * `create.js`'s `disabledJobs()`/`runningJobs()` already take this posture on
 * the Mac; this is the same rule on the substrate that needed it.
 *
 * Returns { known, registered, enabled }. `known: false` means the look failed
 * and NOTHING may be concluded -- `registered` is false there only so a caller
 * that ignores `known` errs toward doing nothing rather than acting.
 */
function presence(name) {
  const r = run(['/Query', '/TN', taskName(name), '/FO', 'LIST']);
  if (r.ok) {
    /* schtasks prints a localized "Scheduled Task State" / "Status" line. Read
       the DISABLED token rather than a positive spelling: the disabled word is
       stable across the shapes seen, and defaulting to enabled-when-unsure would
       claim a job is running when we could not tell. Fail toward the honest
       answer. */
    return { known: true, registered: true, enabled: !/disabled/i.test(r.out || '') };
  }
  if (NO_SUCH_TASK.test(r.out || '')) return { known: true, registered: false };
  return { known: false, registered: false, because: (r.out || '').trim().split('\n')[0] || 'schtasks would not answer' };
}

/**
 * Every agent job registered on this machine, in ONE probe.
 *
 * 🔑 THE SHAPE `create.js` ALREADY USES for the same question on the Mac
 * (`disabledJobs`, `runningJobs`): one call for the whole fleet rather than one
 * per agent, because the screen that asks polls every five seconds. Our tasks
 * all live under one folder, which is what `TASK_PREFIX` is for, so the folder
 * query IS the fleet query.
 *
 * ⚠️ CSV, NOT LIST, and the reason is localization: `/FO LIST` labels each row
 * with a translated field name ("TaskName:"), so parsing it would find nothing
 * on a non-English Windows and report an empty fleet. CSV emits the VALUES with
 * no labels, so column one is the task path in every locale.
 *
 * Returns { known, names:Set } -- an empty folder is a real empty fleet
 * (schtasks says "cannot find"), anything else it will not answer is unknown.
 */
function list() {
  const r = run(['/Query', '/TN', TASK_PREFIX.split('\\')[0] + '\\', '/FO', 'CSV', '/NH']);
  if (!r.ok) {
    if (NO_SUCH_TASK.test(r.out || '')) return { known: true, names: new Set() };
    return { known: false, names: new Set() };
  }
  const names = new Set();
  for (const line of String(r.out || '').split('\n')) {
    const m = /^"([^"]*)"/.exec(line.trim());
    if (!m) continue;
    // Task paths come back rooted ("\Kosmos\agent-ava"); our prefix is not.
    const at = m[1].replace(/^\\+/, '');
    if (at.startsWith(TASK_PREFIX)) names.add(at.slice(TASK_PREFIX.length));
  }
  return { known: true, names };
}

/**
 * Is a job registered for this agent, and is it enabled?
 * Returns { registered, enabled } or { registered:false } -- never throws.
 *
 * 📌 KEPT AS A BOOLEAN ON PURPOSE. `remove.js` asks this to decide what to DO,
 * and there both "no job" and "we could not see one" lead to the same act. Use
 * `presence` wherever the answer becomes a sentence somebody reads.
 */
function status(name) {
  const p = presence(name);
  return p.registered ? { registered: true, enabled: p.enabled } : { registered: false };
}

/* The reverse of xmlEscape. `&amp;` is undone LAST: xmlEscape escapes `&` FIRST,
   so a literal `&lt;` in a path was written `&amp;lt;`, and undoing `&amp;` before
   `&lt;` would wrongly collapse it to `<`. Undo the named entities first, the
   ampersand last, and the round-trip is exact. */
function xmlUnescape(v) {
  return String(v)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, '\'')
    .replace(/&amp;/g, '&');
}

/**
 * The account directory a registered agent's task carries (#2614) -- the win32
 * analogue of the launchd plist's CLAUDE_CONFIG_DIR that `create.readJob` reads
 * on a Mac. A win32 agent has no plist; its configDir rides the Scheduled Task
 * argv (position 4, `taskExec`), so restore-refuse (#2609/remove.js) had nothing
 * to read on Windows and skipped the check, leaving a win32 agent restorable into
 * the #1659 blank-agent state.
 *
 * Read it back from the task's own definition: `/Query /XML` returns the XML
 * `taskXml` wrote, so unescape the `<Arguments>` element and split its quoted
 * tokens (every token is quoted, and a Windows path cannot contain `"`). Those
 * tokens ARE node's `process.argv`: `taskXml` wraps the command as a headless
 * conhost, so the argument line is `--headless "<node>" "<supervisor>"
 * "<name>" "<cwd>" ...`, and `tokens.slice(2)` reconstructs exactly the
 * `process.argv.slice(2)` that `win32supervisor.main` itself consumes. Hand that
 * to the ONE canonical parser (`win32supervisor.specFromArgv`) rather than
 * re-deriving the positions here -- a second derivation of the same fact is the
 * defect this lane is warned against, and slicing at 2 stays correct as the argv
 * grows append-only (a new trailing field cannot move `configDir` off index 3).
 * `specFromArgv` maps `'-'`/empty to undefined (a default-account agent), which we
 * surface as null: no configDir to check, exactly as the Mac side leaves
 * `configDir: null` untouched.
 *
 * ⚠️ SELF-CHECK ON THE NAME. The 2-token wrapper prefix (node + supervisor) is an
 * assumption about the current headless shape, not an invariant like the argv's
 * append-only order. If a future wrapper prepends a different number of tokens,
 * `slice(2)` would land mid-argv and hand back some other field as the configDir
 * -- a silent wrong directory that would falsely block or falsely allow a restore.
 * So we require the reconstructed `spec.name` to equal the name we queried by
 * (`taskExec` writes it at argv[0]); a mismatch means the line is not the shape we
 * understand, and admitting `known: false` is far safer than guessing a configDir
 * from a misparsed line. A pre-headless task (one wrapper token) fails this check
 * and simply does not get the guard, which is no worse than before this change.
 *
 * Shape mirrors `presence`: `{ known: false }` when schtasks would not answer, or
 * the line is not the shape we understand (an unreadable task must never read as
 * "no account dir set" and silently drop the guard); `{ known: true, configDir }`
 * otherwise, with configDir null when the task carries none. `specFromArgv` is
 * required lazily so win32job does not pull the supervisor's whole module tree at
 * load time.
 */
function configDirFor(name) {
  const r = run(['/Query', '/TN', taskName(name), '/XML']);
  if (!r.ok) {
    if (NO_SUCH_TASK.test(r.out || '')) return { known: true, configDir: null };
    return { known: false, because: (r.out || '').trim().split('\n')[0] || 'schtasks would not answer' };
  }
  const m = /<Arguments>([\s\S]*?)<\/Arguments>/.exec(r.out || '');
  if (!m) return { known: true, configDir: null };
  const argStr = xmlUnescape(m[1]);
  const tokens = [];
  const re = /"([^"]*)"/g;
  let t;
  while ((t = re.exec(argStr)) !== null) tokens.push(t[1]);
  const { specFromArgv } = require('./win32supervisor');
  const spec = specFromArgv(tokens.slice(2));
  if (spec.name !== name) {
    return { known: false, because: 'the task argument line is not the shape we can read a configDir from' };
  }
  return { known: true, configDir: spec.configDir || null };
}

module.exports = {
  TASK_PREFIX, taskName, taskExec, taskXml, taskUser, xmlEscape, xmlUnescape, headlessExec,
  install, disable, enable, end, start, remove, status, presence, list, configDirFor,
  setRunner, setAnchorer,
};
