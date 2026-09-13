'use strict';
/**
 * The BOARD's at-logon job on Windows -- launchd's `com.kosmos.board.plist`,
 * which `install/setup.sh` writes with `RunAtLoad` and Windows had nothing for.
 *
 * 🛑 THE DEFECT THIS EXISTS FOR, and why it was a blocker rather than a gap.
 * `engine/win32job.js` brings the AGENTS back at logon (measured, R8). The board
 * is a SEPARATE PROCESS and nothing brought it back: no Startup entry, no
 * Registry Run key, no Scheduled Task. So after a reboot the fleet was running
 * and the thing a person looks at it through was gone, with nothing on screen
 * saying so. A silent absence, which is what made it worse than a broken button.
 *
 * 🔑 A BOARD TASK IS NOT AN AGENT TASK, and the namespace says so. `win32job`
 * owns `Kosmos\agent-<name>`; this owns `Kosmos\board`. Same folder, so one place
 * in Task Scheduler shows a person everything Kosmos registered -- different
 * prefix, so anything that enumerates agents by the `agent-` prefix cannot pick
 * the board up and mistake it for a nineteenth agent.
 *
 * 🔑 THE TRIGGER SHAPE IS win32job's, DELIBERATELY REUSED RATHER THAN REDERIVED.
 * `/SC ONLOGON` needs administrator; an XML LogonTrigger scoped to one user does
 * not. That is measured and written up in engine/win32job.js's `taskXml` header,
 * and this file uses that module's `taskUser`/`xmlEscape` so there is ONE copy of
 * the fact rather than two that can drift apart.
 *
 * ⚠️ AN AT-LOGON TASK NEEDS A LOGIN, exactly as launchd's RunAtLoad does. A box
 * that reboots to a locked login screen brings back no board on either platform
 * until somebody signs in. Stated because "the board survives a reboot" is what
 * people will read into this file.
 *
 * 📌 IT DOES NOT OPEN A BROWSER. `Kosmos.exe` starts `open-board.js` because a
 * person just double-clicked it and is waiting to see something; a logon is not
 * that moment, and a tab appearing on every sign-in would be a new nuisance
 * shipped alongside a fix. The board serves; the person opens it when they want.
 *
 * ─── HOW TO REMOVE IT ────────────────────────────────────────────────────────
 * Task Scheduler > Task Scheduler Library > Kosmos > board, or:
 *
 *     schtasks /Delete /F /TN "Kosmos\board"
 *
 * `REMOVE_HINT` below is that line, exported so every screen that mentions the
 * task can print the same words. A durable task nobody can find is worse than no
 * task at all, which is why this paragraph is here and not only in a PR.
 */

const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const win32anchor = require('./win32anchor');
const win32job = require('./win32job'); // taskUser + xmlEscape: the measured, shared half
const win32swap = require('./win32swap'); // writeFileAtomic: a torn shim must never reach a logon

/* One namespace with win32job's, one prefix apart. See the header. */
const TASK_NAME = 'Kosmos\\board';
const REMOVE_HINT = 'schtasks /Delete /F /TN "' + TASK_NAME + '"';

/**
 * 🔑 THE PROOF THAT THIS BOARD IS THE TASK'S BOARD, and the reason a restart can
 * be honest. `boardrestart.js` on the Mac asks launchd whether the running pid IS
 * the `com.kosmos.board` job, because stopping a board nothing supervises would
 * brick it. Windows has no such query -- `schtasks /Query` reports Running but
 * names no pid -- so the shim below STAMPS this variable into the environment of
 * the board it starts. Present means "the task started me, so ending the task
 * ends me and running it starts a fresh one". Absent means a hand-started board
 * (`Kosmos.exe`, `node server.js`), which must never be stopped by this path.
 */
const MARKER_ENV = 'KOSMOS_WIN32_BOARD_TASK';

/* The durable shim, beside the anchor's supervisor shim and for the same reason:
   a Scheduled Task is forever and `<extract-root>` is not. */
const BOOT_NAME = 'board-boot.js';

/**
 * 📌 REGISTERED ONCE, NOT RE-CREATED FOREVER. This file records that Kosmos has
 * already put its logon task on this machine, so a task the PERSON deleted stays
 * deleted. `boardAutostartCheck` then reports the absence plainly instead of the
 * board quietly re-registering itself at the next boot -- the same posture
 * engine/machine.js takes toward a disabled login item: surface it, never fight
 * it. `remove()` deletes this too, so a removal driven by the product is a clean
 * slate rather than a machine that can never register again.
 */
const CLAIM_NAME = 'board-task-claimed';

const HELPER_FLAG = '--kosmos-board-restart';

/* The command seam, in the shape win32job's is, for the reason rule 2 of this
   branch states: a test stubs this and never shells a real schtasks. Returns
   { ok, out } and never throws, so every caller reports rather than unwinds. */
let runFn = null;
function setRunner(fn) { runFn = typeof fn === 'function' ? fn : null; }

/* How long one schtasks call may take before it is abandoned. Every call is a
   synchronous spawn, so this also bounds how long the hand-off can be stuck in one:
   engine/win32handoff.js derives the launcher's unreadable-table fallback from it. */
const SCHTASKS_TIMEOUT_MS = 20000;
function run(args) {
  if (runFn) return runFn(args);
  try {
    const out = cp.execFileSync('schtasks.exe', args, { encoding: 'utf8', timeout: SCHTASKS_TIMEOUT_MS });
    return { ok: true, out: String(out || '') };
  } catch (e) {
    return { ok: false, out: String((e && (e.stdout || e.message)) || ''), code: (e && e.status) };
  }
}

/* The anchor seam, for win32anchor's own stated reason: a suite must never copy a
   92 MB interpreter, and a Mac must be able to drive this arm without writing a
   Windows path. */
let anchorFn = null;
function setAnchorer(fn) { anchorFn = typeof fn === 'function' ? fn : null; }
function anchorFor(spec) {
  return anchorFn ? anchorFn(spec) : win32anchor.ensureAnchored(spec);
}

/* The spawn seam, in boardrestart.js's shape: a test must never launch a real
   detached restart helper. */
let spawner = (cmd, args, opts) => cp.spawn(cmd, args, opts);
function setSpawner(fn) { spawner = fn; }

/**
 * The board's durable entry point.
 *
 * 🔑 IT RESOLVES THE APP AT RUN TIME AND RUNS server.js AS `main`, IN ONE
 * PROCESS. The pointer indirection is win32anchor's design, unchanged: the task
 * command is fixed forever and the shared `engine-path` file decides which app it
 * runs, so ONE refresh moves the board and every agent onto a new install.
 *
 * 🛑 IT MUST NOT BE A WRAPPER THAT SPAWNS server.js AS A CHILD, which was the
 * obvious shape and is the wrong one. `schtasks /End` terminates the task's
 * process; a board running as that process's CHILD can outlive the End, keep the
 * port bound, and leave the freshly-`/Run` board dying on EADDRINUSE -- no board
 * at all, from the operation whose whole job is to bring one back. Loading
 * server.js as `main` makes the board itself the task's process, so End stops the
 * board and nothing else. Measured working on this box 2026-09-09: `process.argv[1]`
 * rewritten, `module.runMain()` called, and the target sees `require.main === module`,
 * its own `__filename`, and the argv tail -- which is exactly what server.js:10650
 * tests to decide whether to boot.
 *
 * ⚠️ IT EXITS NON-ZERO WITH A SENTENCE when the pointer is stale, for
 * win32anchor's reason: a shim that exited 0 on a missing app looks to Task
 * Scheduler like a board that ran and finished, which is the one reading that
 * hides a dead board.
 */
const BOOT_JS = [
  "'use strict';",
  '/* Written by engine/win32board.js. Do not edit: it is rewritten every time the',
  "   board's logon task is registered. It reads the pointer beside it and runs THAT",
  '   app\'s server.js, so an app that moved does not strand a registered task. */',
  "const fs = require('node:fs');",
  "const path = require('node:path');",
  'const pointer = path.join(__dirname, ' + JSON.stringify(win32anchor.POINTER_NAME) + ');',
  "let engine = '';",
  "try { engine = String(fs.readFileSync(pointer, 'utf8')).trim(); } catch {}",
  'if (!engine) {',
  "  process.stderr.write('kosmos: no engine pointer beside ' + __dirname + '\\n');",
  '  process.exit(3);',
  '}',
  '/* The pointer names the ENGINE directory; the board is its sibling. True of both',
  '   layouts this ships in: <extract>/app/engine -> <extract>/app/server.js, and a',
  '   source checkout <repo>/engine -> <repo>/server.js. */',
  "const entry = path.join(engine, '..', 'server.js');",
  'if (!fs.existsSync(entry)) {',
  "  process.stderr.write('kosmos: the app this board was registered against is gone (' + entry + ')\\n');",
  '  process.exit(3);',
  '}',
  '/* The stamp boardrestart reads to know a stop would be undone by a start. */',
  'process.env[' + JSON.stringify(MARKER_ENV) + '] = ' + JSON.stringify(TASK_NAME) + ';',
  'process.argv = [process.argv[0], entry].concat(process.argv.slice(2));',
  "require('node:module').runMain();",
  '',
].join('\n');

/** Was THIS board started by its logon task? See MARKER_ENV. */
function startedByTask(env) {
  const e = env || process.env;
  return String(e[MARKER_ENV] || '') === TASK_NAME;
}

/**
 * The command line the task runs.
 *
 * 🛑 BOTH PATHS MUST BE ANCHORED ONES -- win32job's rule, for win32job's reason:
 * `process.execPath` and `__dirname` both resolve under the extract root, which a
 * version update replaces. The defaults here are the EPHEMERAL answer and exist
 * so the function stays callable on its own; `install()` passes the durable pair.
 *
 * ⚠️ EVERY PATH QUOTED, because `C:\Program Files\...` is an ordinary install
 * location and an unquoted argument silently truncates at the space.
 */
function taskExec(spec) {
  const s = spec || {};
  return {
    command: s.node || process.execPath,
    args: '"' + String(s.boot || path.resolve(__dirname, '..', 'server.js')) + '"',
    workingDir: s.workingDir || '',
  };
}

/**
 * The task definition, as XML.
 *
 * 🛑 `MultipleInstancesPolicy` IS `IgnoreNew`, AND `StopExisting` WAS MEASURED TO
 * BE A BRICK. `StopExisting` reads like the perfect restart primitive -- one
 * atomic `schtasks /Run` that replaces the running board -- and on this box,
 * 2026-09-09, it left NO BOARD AT ALL: Task Scheduler started the new instance
 * while the old one still held the port, the new board died on EADDRINUSE, and
 * the old one was then stopped. Two boards was the hazard everyone expects;
 * ZERO boards is what the tempting policy actually produced. `IgnoreNew`
 * measured correct in the same session: `/Run` against a running task starts
 * nothing at all, so a second logon cannot start a second board.
 *
 * ⚠️ AND `schtasks /Run` REPORTS SUCCESS WHEN IgnoreNew SUPPRESSED THE START --
 * measured in the same run. Nothing may read that exit code as proof a board
 * started; `restartHelperMain` below confirms by re-querying the task instead.
 *
 * `ExecutionTimeLimit PT0S` is "no limit": the board is meant to run for as long
 * as the box is up, and the default three days would stop it mid-week.
 *
 * `WorkingDirectory` matches what `tools/windows/KosmosLauncher.cs` already sets
 * (`s.WorkingDirectory = here`). A task action otherwise starts in system32, and
 * the shipped launcher is the shape the board has been measured running in.
 */
function taskXml(spec, env) {
  /* No window, the same wrapper the agents' tasks use. See win32job.headlessExec. */
  const exec = win32job.headlessExec(taskExec(spec), env);
  const esc = win32job.xmlEscape;
  const user = esc(win32job.taskUser(env));
  return '<?xml version="1.0" encoding="UTF-16"?>\n'
    + '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">\n'
    + '  <RegistrationInfo><Description>Kosmos board (the screen you look at your agents through). '
    + 'Remove with: ' + esc(REMOVE_HINT) + '</Description></RegistrationInfo>\n'
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
    + '<Command>' + esc(exec.command) + '</Command>'
    + '<Arguments>' + esc(exec.args) + '</Arguments>'
    + (exec.workingDir ? '<WorkingDirectory>' + esc(exec.workingDir) + '</WorkingDirectory>' : '')
    + '</Exec></Actions>\n'
    + '</Task>\n';
}

/**
 * Is the shipped Windows bundle what is running here, and where is its root?
 *
 * 🛑 DELIBERATELY NOT `update.installedRoot()`, AND THAT IS NOT A DUPLICATION
 * OVERSIGHT. WINDOWS-ROADMAP §3a states the ordering constraint in bold: teaching
 * `installedRoot()` the Windows layout is the ONE line that turns the in-app
 * Install button on, live execution IS armed on win32, and the updater has no
 * swap yet -- so the spawn behind that button would be real. This asks the same
 * SHAPE of question for a different purpose (should the board register a logon
 * task) and must not arm the updater as a side effect of answering it.
 *
 * The layout is `tools/build-kosmos-windows.sh`'s and `KosmosLauncher.cs` checks
 * the same two files before it starts anything:
 *     <root>/runtime/node.exe     <root>/app/server.js
 * A source checkout has neither, so it returns null and nothing is registered --
 * matching the Mac, where a from-source board legitimately has no login job
 * (engine/machine.js boardAutostartCheck says so in as many words).
 *
 * `root` and `exists` are injectable so a Mac can assert the win32 answer without
 * a Windows filesystem; the joiner follows the platform ASKED ABOUT, which is
 * store.js's #1510 lesson and win32anchor's convention.
 */
function bundleRoot(opts) {
  const o = opts || {};
  const platform = o.platform || process.platform;
  if (platform !== 'win32') return null;
  const p = platform === 'win32' ? path.win32 : path.posix;
  /* `__dirname` is <root>/app/engine in the bundle, so the root is two up. */
  const root = o.root || path.resolve(__dirname, '..', '..');
  const exists = o.exists || ((f) => fs.existsSync(f));
  if (exists(p.join(root, 'runtime', 'node.exe')) && exists(p.join(root, 'app', 'server.js'))) return root;
  return null;
}

/* 🛑 #2628: THE BOARD'S MACHINE PATHS COME FROM THE ENVIRONMENT IT WAS LAUNCHED
   WITH. A board serving a named world has that world's AGENT_WORKFORCE_DATA in
   process.env (worldenv), and win32anchor.anchorDir honours it. Without this, a
   named-world boot would re-register the logon task against a runtime copied under
   the world, read its claim file from the world (so a task the person removed would
   be re-created), and write a restart's log into a folder that does not exist.
   worldenv captures the launch env before it applies any world. Before a boot (a
   unit test) there is none, and process.env is the launch env, exactly as before.
   ⚠️ The detached restart helper is NOT such a case: it is spawned by the board and
   inherits the board's POST-world process.env, with no launch env of its own. It is
   safe only because it derives no machine path (it ends and runs the task, and
   `restart` hands it the log path). Anything added to it that needs one must be
   passed the launch env explicitly (review round 2). */
function machineEnv(o) {
  if (o && o.env) return o.env;
  let launch = null;
  try { launch = require('./worldenv').launchEnv(); } catch { launch = null; }
  return launch || process.env;
}

/** Where the anchor keeps the board's shim, log and claim file. Never throws. */
function anchorDirFor(opts) {
  const o = opts || {};
  try {
    return win32anchor.anchorDir(o.platform || process.platform, o.home || os.homedir(), machineEnv(o));
  } catch { return null; }
}

/**
 * Register (or re-register) the board's at-logon task.
 *
 * `/F` overwrites, which is what makes this idempotent: re-registering after an
 * update is how the task learns the new install. Anchor first, then register --
 * win32job's ordering, for win32job's reason: a task built from this app's paths
 * outlives the app, and a failed anchor must refuse the job rather than register
 * one that would silently never start at some logon months from now.
 */
function install(spec) {
  const s = spec || {};
  const env = machineEnv(s);   // #2628: the launch env, never a named world's
  const anchor = anchorFor({
    platform: s.platform, home: s.home, env,
    node: s.node, engineDir: s.engineDir,
  });
  if (!anchor.ok) return { ok: false, because: anchor.because };

  /* 🛑 A LOGON TRIGGER NEEDS A USER, and an empty one registers a task that can
     never fire. Refuse with a sentence rather than write a definition schtasks
     rejects with its own opaque one. (win32job paid for this: an injected test
     env with no USERNAME produced `<UserId></UserId>` and a unit test that
     passed.) */
  if (!win32job.taskUser(env)) {
    return { ok: false, because: 'we could not tell which user this computer signs in as, so a startup job would never run' };
  }

  const bootAt = path.join(anchor.dir, BOOT_NAME);
  try {
    /* Atomic, for the pointer's reason: the task runs this at every logon, and a
       torn shim is a syntax error there, so no board comes back. */
    win32swap.writeFileAtomic(bootAt, BOOT_JS);
  } catch (e) {
    return { ok: false, because: 'we could not write the file that starts the board at logon (' + ((e && e.message) || 'no detail') + ')' };
  }

  /* ⚠️ UTF-16 WITH A BOM, because schtasks refuses anything else for /XML. The
     file is transient by design -- consumed by the next line, deleted in the
     `finally` -- so nothing durable points at it. */
  const xmlAt = path.join(os.tmpdir(), 'kosmos-board-task-' + process.pid + '-' + Date.now() + '.xml');
  let r;
  try {
    try {
      fs.writeFileSync(xmlAt, Buffer.from('\ufeff' + taskXml({
        node: anchor.node, boot: bootAt, workingDir: s.workingDir,
      }, env), 'utf16le'));
    } catch (e) {
      return { ok: false, because: 'we could not write the startup job definition (' + ((e && e.message) || 'no detail') + ')' };
    }
    r = run(['/Create', '/F', '/TN', TASK_NAME, '/XML', xmlAt]);
  } finally {
    try { fs.unlinkSync(xmlAt); } catch { /* best effort; it is in the temp root */ }
  }
  if (!r.ok) return { ok: false, because: 'we could not register the job that starts the board at logon (' + (r.out || 'no detail').trim().split('\n')[0] + ')' };
  return { ok: true, task: TASK_NAME, boot: bootAt, removeHint: REMOVE_HINT };
}

/**
 * Is the board's job registered, is it enabled, is it running right now?
 * Never throws. `{ registered:false }` when we could not see one.
 */
function status() {
  const r = run(['/Query', '/TN', TASK_NAME, '/FO', 'LIST']);
  if (!r.ok) return { registered: false };
  const out = r.out || '';
  /* schtasks prints one `Status:` line whose value is Running / Ready / Disabled
     (measured on this box). Read the negative token rather than a positive
     spelling, as win32job does: defaulting to enabled-when-unsure would claim the
     board comes back when we could not tell. */
  return { registered: true, enabled: !/disabled/i.test(out), running: /\brunning\b/i.test(out) };
}

function disable() {
  const r = run(['/Change', '/TN', TASK_NAME, '/DISABLE']);
  if (!r.ok) return { ok: false, because: 'we could not stop the board starting at logon (' + (r.out || '').trim().split('\n')[0] + ')' };
  return { ok: true };
}

function enable() {
  const r = run(['/Change', '/TN', TASK_NAME, '/ENABLE']);
  if (!r.ok) return { ok: false, because: 'we could not set the board to start at logon again (' + (r.out || '').trim().split('\n')[0] + ')' };
  return { ok: true };
}

/** End the running board. This KILLS THE CALLER when the caller is that board. */
function end() {
  const r = run(['/End', '/TN', TASK_NAME]);
  if (!r.ok && !/not running|cannot find|does not exist/i.test(r.out || '')) {
    return { ok: false, because: 'we could not stop the board (' + (r.out || '').trim().split('\n')[0] + ')' };
  }
  return { ok: true };
}

/** Start the board now, without waiting for a logon. See taskXml on why the exit
    code of this is NOT proof that a board started. */
function runNow() {
  const r = run(['/Run', '/TN', TASK_NAME]);
  if (!r.ok) return { ok: false, because: 'we could not start the board (' + (r.out || '').trim().split('\n')[0] + ')' };
  return { ok: true };
}

/** Remove the job entirely, and the claim with it, so a later install can
    register again from a clean slate. */
function remove(opts) {
  const dir = anchorDirFor(opts);
  if (dir) { try { fs.unlinkSync(path.join(dir, CLAIM_NAME)); } catch { /* never claimed is ordinary */ } }
  const r = run(['/Delete', '/F', '/TN', TASK_NAME]);
  if (!r.ok && !/cannot find|does not exist/i.test(r.out || '')) {
    return { ok: false, because: 'we could not remove the board startup job (' + (r.out || '').trim().split('\n')[0] + ')' };
  }
  return { ok: true };
}

function claimed(opts) {
  const dir = anchorDirFor(opts);
  if (!dir) return false;
  try { return fs.existsSync(path.join(dir, CLAIM_NAME)); } catch { return false; }
}
function claim(opts) {
  const dir = anchorDirFor(opts);
  if (!dir) return;
  try { fs.writeFileSync(path.join(dir, CLAIM_NAME), new Date().toISOString() + '\n', 'utf8'); } catch { /* the task is registered either way */ }
}

/**
 * What the board should do about its own logon job at boot. Called once, from
 * server.js's run-directly block, for the reason the supervisor refresh beside it
 * gives: THE BOARD RESTARTING IS THE UPDATE, so this is the one moment that
 * happens exactly when a new install arrives and never in between.
 *
 * 🔑 IT REFRESHES, IT DOES NOT RE-IMPOSE. Five states, and only two of them
 * write:
 *   not win32 / not the bundle -> skipped; a source checkout has no login job on
 *                                 the Mac either and must not grow one here
 *   registered + enabled       -> re-register, so an install that MOVED is followed
 *   registered + disabled      -> LEFT ALONE. A person turned it off; forcing it
 *                                 back on every boot is user-hostile, which is the
 *                                 exact posture machine.js's boardAutostartCheck
 *                                 takes toward a disabled login item
 *   absent + never claimed     -> register, and record the claim
 *   absent + claimed before    -> LEFT ALONE. Kosmos put it there and it is gone,
 *                                 so somebody removed it. Report, never re-create
 * @returns {{ok:boolean, action:string, because?:string, task?:string, removeHint?:string}}
 */
function ensureInstalled(opts) {
  const o = opts || {};
  const platform = o.platform || process.platform;
  if (platform !== 'win32') {
    return { ok: true, action: 'skipped', because: 'the board only registers a Windows startup job on Windows' };
  }
  if (!bundleRoot(o)) {
    return { ok: true, action: 'skipped', because: 'this board runs from a source checkout, so nothing registers it to start at logon' };
  }
  const st = status();
  if (st.registered && st.enabled === false) {
    return { ok: true, action: 'left-disabled', task: TASK_NAME, removeHint: REMOVE_HINT,
      because: 'the job that starts the board at logon is switched off, so Kosmos will not come back on its own after a restart' };
  }
  if (!st.registered && claimed(o)) {
    return { ok: false, action: 'left-removed', task: TASK_NAME,
      because: 'the job that started the board at logon was removed, so Kosmos will not come back on its own after a restart' };
  }
  const r = install({ ...o, workingDir: o.workingDir || bundleRoot(o) });
  if (!r.ok) return { ok: false, action: 'failed', because: r.because };
  if (!st.registered) claim(o);
  return { ok: true, action: st.registered ? 'refreshed' : 'registered', task: TASK_NAME, removeHint: REMOVE_HINT };
}

/**
 * Bounce the board: end it, wait for it to actually be gone, start it again.
 *
 * 🛑 THE SEQUENCE CANNOT RUN IN THE BOARD, because its first step kills the
 * board. So this spawns a DETACHED helper that outlives its own parent and drives
 * the three steps from outside -- the same shape `kosmosRestart` in
 * engine/boardrestart.js already uses on the Mac for #2454's installed board, and
 * for the identical reason.
 *
 * 🛑 AND THE ORDER IS END, THEN WAIT, THEN RUN, WITH THE WAIT LOAD-BEARING.
 * Measured 2026-09-09: after `/End` the board's listening port stayed bound for
 * roughly a second. `/Run` inside that second produces a board that dies on
 * EADDRINUSE -- server.js's own single-instance guard doing its job, and leaving
 * nothing behind. The wait is what turns two-boards-or-none into exactly one.
 *
 * ⚠️ REFUSES UNLESS THIS BOARD IS THE TASK'S BOARD. Ending a task that is not
 * running this process stops nothing, and `/Run` would then start a SECOND board
 * that immediately dies on the port -- a restart that reported success and did
 * nothing. `startedByTask` is the proof; every other case is somebody else's
 * board to restart by hand.
 */
function restart(opts) {
  const o = opts || {};
  /* #2628: the launch env. It carries the task marker (the boot shim sets it before
     server.js loads), and its anchor dir is the machine one a restart logs into. */
  const env = machineEnv(o);
  if (!startedByTask(env)) {
    return { ok: false, because: 'this board was not started by its Windows logon job, so stopping it would not bring it back' };
  }
  const st = status();
  if (!st.registered) {
    return { ok: false, because: 'there is no Windows logon job for the board, so stopping it would not bring it back' };
  }
  if (st.enabled === false) {
    return { ok: false, because: 'the board\'s Windows logon job is switched off, so stopping it would not bring it back' };
  }
  const dir = anchorDirFor({ ...o, env });
  const logAt = o.log || path.join(dir || os.tmpdir(), 'board-restart.log');
  let child;
  try {
    /* The anchored node, not `process.execPath`: during an update the extract
       tree is exactly what is being replaced, and this helper has to outlive it.
       The helper SCRIPT is this file, wherever it currently lives -- transient by
       nature (it finishes in seconds) and fully loaded into memory the moment it
       starts, so a tree replaced underneath it does not matter. */
    child = spawner(o.node || process.execPath, [o.helper || __filename, HELPER_FLAG, String(o.pid || process.pid), logAt],
      { detached: true, stdio: 'ignore', windowsHide: true });
  } catch (e) {
    return { ok: false, because: 'could not start the board restart: ' + String((e && e.message) || e) };
  }
  /* 🛑 spawn signals ENOENT / EACCES asynchronously, not by throwing, and with no
     listener that becomes an uncaught exception -- which would kill the very
     board this is trying to preserve. boardrestart.js's wireChild note states the
     whole case; this is the same hazard on the same kind of child. */
  if (child && typeof child.on === 'function') {
    child.on('error', (err) => {
      try { process.stderr.write('Kosmos board restart could not start: ' + String((err && err.message) || err) + '\n'); } catch { /* stderr gone with the dying process */ }
    });
  }
  if (child && typeof child.unref === 'function') child.unref();
  return { ok: true, log: logAt };
}

/** Is that pid still on this machine? `kill(pid, 0)` sends no signal; ESRCH is
    "gone", and anything else (EPERM on a process we may not touch) is "still
    there" -- fail toward waiting, never toward starting a second board. */
function pidGone(pid) {
  /* One reading of "is that pid still here", shared with the parent watch that
     lets the board leave when /End kills its headless host. */
  return !require('./win32orphan').pidAlive(pid);
}

/**
 * The detached half. Runs OUTSIDE the board, so it may take its time.
 *
 * It writes a transcript, because its stdio is `ignore` (a detached child of a
 * process that is about to die has nowhere else to speak) and "the board did not
 * come back" is precisely the question somebody will need answered afterwards.
 */
async function restartHelperMain(argv, deps) {
  const d = deps || {};
  const pid = Number(argv[0]);
  const logAt = argv[1];
  const sleep = d.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const gone = d.pidGone || pidGone;
  const now = d.now || (() => Date.now());
  const t0 = now();
  const lines = [];
  const say = (s) => {
    lines.push(String(now() - t0).padStart(6) + 'ms  ' + s);
    try { fs.writeFileSync(logAt, lines.join('\n') + '\n', 'utf8'); } catch { /* the restart matters more than its log */ }
  };

  say('restarting the board (task ' + TASK_NAME + ', board pid ' + pid + ')');
  const e = end();
  say('end: ' + (e.ok ? 'ok' : e.because));

  let waited = 0;
  while (!gone(pid) && waited < 30000) { await sleep(200); waited += 200; }
  if (!gone(pid)) {
    /* Start anyway. The board that is still there keeps serving, and the one this
       starts dies honestly on the port -- strictly better than deciding on our own
       that there should be no board. */
    say('the old board (pid ' + pid + ') was still running after 30s; starting one anyway');
  } else {
    say('the old board is gone after ' + waited + 'ms');
  }

  /* ⚠️ A SETTLE AFTER THE PROCESS EXITS, MEASURED RATHER THAN GUESSED. The port
     outlived `/End` by about a second on this box, and the process going is not
     the same instant as the socket closing. */
  await sleep(1000);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const r = runNow();
    say('run attempt ' + attempt + ': ' + (r.ok ? 'issued' : r.because));
    /* `/Run` reporting success is not proof (see taskXml): re-query until the
       task says Running. */
    let up = 0;
    while (up < 12000) {
      const st = status();
      if (st.registered && st.running) { say('the board is running again'); return { ok: true, attempts: attempt }; }
      await sleep(500); up += 500;
    }
    say('attempt ' + attempt + ' did not leave the board running');
  }
  say('THE BOARD DID NOT COME BACK. Start it from ' + TASK_NAME + ' in Task Scheduler, or run Kosmos again.');
  return { ok: false };
}

/**
 * What a screen should say about the board's logon job. Machine facts only, in
 * the shape engine/machine.js's checks consume; no user-facing copy here.
 */
function describe(opts) {
  const o = opts || {};
  const platform = o.platform || process.platform;
  if (platform !== 'win32') return null;
  const bundle = bundleRoot(o);
  const st = status();
  return {
    task: TASK_NAME,
    bundle: Boolean(bundle),
    registered: Boolean(st.registered),
    enabled: st.registered ? st.enabled !== false : false,
    running: Boolean(st.running),
    claimed: claimed(o),
    removeHint: REMOVE_HINT,
  };
}

module.exports = {
  TASK_NAME, MARKER_ENV, BOOT_NAME, BOOT_JS, CLAIM_NAME, REMOVE_HINT, HELPER_FLAG, SCHTASKS_TIMEOUT_MS,
  taskExec, taskXml, bundleRoot, install, ensureInstalled, status, describe,
  disable, enable, end, runNow, remove, restart, startedByTask,
  claimed, claim, restartHelperMain, pidGone,
  setRunner, setAnchorer, setSpawner,
};

/* The detached half, invoked as `node engine/win32board.js --kosmos-board-restart
   <pid> <log>`. Guarded on being the main module for the reason server.js states
   about its own boot block: requiring this file must never restart a board. */
if (require.main === module && process.argv[2] === HELPER_FLAG) {
  restartHelperMain(process.argv.slice(3)).then((r) => process.exit(r && r.ok ? 0 : 1));
}
