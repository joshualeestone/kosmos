'use strict';
/**
 * #5432: an agent's startup job, written the way THIS platform keeps it, for tests that seed one.
 *
 * On macOS the job is a launchd plist (create.plistPath / create.plistFor); on Linux it is a systemd user unit
 * (linuxjob.unitPath / linuxjob.unitFor), and the job reader (create.readJob) reads only the platform's own. A test that
 * wrote a plist on a Linux runner seeded nothing, so its agent read as having no job. The two writers take their
 * arguments in the same order (name, runner binary, tmux binary, model, account folder, runner name), so a test calls
 * jobPath / jobFor where it called plistPath / plistFor, and macOS is unchanged (Windows: see kosmos#8378 below).
 *
 * The Linux unit folder is the sandbox's own (AGENT_WORKFORCE_SYSTEMD_DIR, which the test sets beside
 * AGENT_WORKFORCE_LAUNCH); without it the unit would be written under AGENT_WORKFORCE_LAUNCH/systemd/user.
 *
 * kosmos#8378: on Windows the job is a Scheduled Task, which create.readJob reads through win32job.cachedTaskSpec (a
 * `schtasks /Query /XML`), and a test process never reaches the real Task Scheduler. So on Windows the job is a task
 * definition file in the sandbox (AGENT_WORKFORCE_LAUNCH/win32-tasks/Kosmos/agent-<key>, where win32job.taskFilePath looks in a sandbox; the text win32job.taskXml
 * writes), and jobPath installs a stand-in Task Scheduler through win32job's own command seam (setRunner) that
 * answers from those files: a test that writes or deletes the file registers or removes the task, exactly as writing
 * or deleting the plist does on a Mac. macOS and Linux are unchanged.
 *
 * ASK FOR THE PATH EACH TIME YOU WRITE OR DELETE THE FILE on Windows: win32job remembers a task it has read until
 * its own install or remove (the #2717 cache), and jobPath is what forgets it. A path kept in a variable and written
 * again later is read back stale there. Once installed, the stand-in stays until the next win32job.setRunner call: a test
 * that puts the runner back with setRunner(null) leaves later tests reading "could not look" until one asks for a path
 * again (loud, never a false pass). The stand-in lives in this process only: a board a test spawns does not see it
 * (jobPathIn still writes a plist there). It also stands in for the start: /Run writes the ownership row the agent's
 * supervisor would (win32sessions, in the sandboxed store).
 *
 * kosmos#8456: three more, for the Windows arms of tests whose Mac arm stops, restarts or watches an agent through a
 * runner stub. watchScheduler lets a test see every schtasks call at the stand-in (and answer one itself: an /End that
 * fails); win32Step answers the schtasks and taskkill calls a Windows act yields to engine/remove.js's runner, from the
 * same stand-ins; win32Processes is a stand-in process table for engine/win32stop.js, so an agent can be running, be
 * ended with taskkill, and be looked at again. Each says below what it does not stand in for.
 */
const fs = require('node:fs');
const path = require('node:path');

const linux = () => process.platform === 'linux';
const win32 = () => process.platform === 'win32';

/* kosmos#8378: the stand-in Task Scheduler for a Windows host. Its tasks are the `Kosmos/agent-*` files in one sandbox
   folder, named by the task's name under the Kosmos folder; it answers the schtasks calls engine/win32job.js makes
   through its own runner (setRunner: /Query /XML, /Query /FO LIST, the two /FO CSV lists, /Create, /Delete, /Change,
   /Run, /End) from those files. NOT the step forms (installSteps, startSteps, endSteps, taskEnabledSteps): those hand
   `schtasks.exe` to engine/remove.js's runner, which a test stubs on its own, so a put-back or restore through them
   registers nothing here, whatever that stub answers, unless the stub passes them on with win32Step (kosmos#8456). It answers /Query /XML in UTF-8, so win32job's UTF-16 decode of
   a real answer (taskXmlFromQuery) is not exercised here; that has its own tests. */
const NOT_FOUND = 'ERROR: The system cannot find the file specified.';

function win32TaskDir() {
  if (!process.env.AGENT_WORKFORCE_LAUNCH) {
    throw new Error('jobfixture.jobPath: no sandbox (set AGENT_WORKFORCE_LAUNCH); on Windows the job is a task file kept there');
  }
  const dir = path.join(process.env.AGENT_WORKFORCE_LAUNCH, 'win32-tasks');
  // kosmos#8454: the Kosmos folder the task files sit in, as Task Scheduler stores them (it makes the sandbox folder too).
  fs.mkdirSync(path.join(dir, require('../engine/win32job').TASK_PREFIX.split('\\')[0]), { recursive: true });
  return dir;
}

/* `Kosmos\agent-ava` -> <dir>/Kosmos/agent-ava, laid out as Task Scheduler stores it (kosmos#8454: the board reads a
   job's change time from that file, win32job.taskFilePath, which in a sandbox is this folder); null for a name outside
   the Kosmos folder. */
function taskFile(dir, tn) {
  const win32job = require('../engine/win32job');
  const folder = win32job.TASK_PREFIX.split('\\')[0] + '\\';
  const at = String(tn || '').replace(/^\\+/, '');
  if (!at.toLowerCase().startsWith(folder.toLowerCase())) return null;
  const leaf = at.slice(folder.length);
  if (!leaf || /[\\/]/.test(leaf)) return null;
  return path.join(dir, folder.slice(0, -1), leaf);
}

/* The task's own switch, read where Task Scheduler keeps it (<Settings><Enabled>), as win32job.taskEnabled reads it. */
function switchedOff(text) {
  const settings = /<Settings>([\s\S]*?)<\/Settings>/.exec(String(text));
  return !!settings && /<Enabled>\s*(false|0)\s*<\/Enabled>/.test(settings[1]);
}

let runs = 0;   // the /Run count, so each started task gets its own ownership-row id
let currentScheduler = null;   // kosmos#8456: the stand-in last installed, for win32Step
let processTable = null;   // kosmos#8456: the running agents, while win32Processes has a table installed
/* kosmos#8456 review 2: the tasks running now, by task file, so /Run and /End answer as Task Scheduler does: a task
   runs from its /Run until its /End (or its /Delete), and a /Run while it runs starts nothing under the task's
   MultipleInstancesPolicy, which is IgnoreNew for every task Kosmos registers (win32job.taskXml) and Task Scheduler's
   own default. A file that is gone is not running, so a test that deletes and rewrites a task file starts afresh. */
const runningTasks = new Set();
function ignoresNew(text) {
  const policy = /<MultipleInstancesPolicy>\s*(\w+)\s*<\/MultipleInstancesPolicy>/.exec(String(text));
  return !policy || policy[1] === 'IgnoreNew';
}

/* The agent facts on a task's argument line (name, folder, model, account, runner, runner binary), read the way
   win32job.taskSpec reads them; null when the definition has no argument line. */
function taskLine(text) {
  const m = /<Arguments>([\s\S]*?)<\/Arguments>/.exec(String(text));
  if (!m) return null;
  const tokens = [...require('../engine/win32job').xmlUnescape(m[1]).matchAll(/"([^"]*)"/g)].map((t) => t[1]);
  return require('../engine/win32argv').specFromArgv(tokens.slice(2));
}

function taskRows(dir) {
  const win32job = require('../engine/win32job');
  const folder = win32job.TASK_PREFIX.split('\\')[0];
  let names = [];
  try { names = fs.readdirSync(path.join(dir, folder)).filter((n) => /^agent-.+$/.test(n)); } catch { names = []; }
  return names.map((n) => {
    let text = '';
    try { text = fs.readFileSync(path.join(dir, folder, n), 'utf8'); } catch { text = ''; }
    return `"\\${folder}\\${n}","N/A","${switchedOff(text) ? 'Disabled' : 'Ready'}"`;
  });
}

/* A task file the stand-in cannot read (a folder where the file should be, say) is a look that failed, the way
   schtasks failing to answer is: never thrown at the caller, and never "no such task". */
const STAND_IN = Symbol('jobfixture stand-in Task Scheduler');

/* kosmos#8456: the watchers watchScheduler installs. Kept at module level, not on one installed runner, because jobPath
   installs a fresh stand-in on every call: a watcher a test set must keep seeing the calls made after its next jobPath. */
const watchers = new Set();

function stubScheduler(dir) {
  const answer = stubAnswer(dir);
  const run = (args) => {
    const a = Array.isArray(args) ? args.map(String) : [];
    /* A watcher sees each call before the stand-in answers it, and may answer it itself (a refusal the test needs,
       such as an /End that fails); one that returns nothing leaves the call to the stand-in. */
    for (const w of [...watchers]) {
      const said = w(a.slice());
      if (said && typeof said === 'object') return { ok: Boolean(said.ok), out: String(said.out || '') };
    }
    try { return answer(a); } catch (e) { return { ok: false, out: `ERROR: ${(e && e.message) || 'the stand-in Task Scheduler could not read the task'}` }; }
  };
  run[STAND_IN] = true;
  return run;
}

/* A runner a test installed of its own (a refusing one, say) must never be swapped for the stand-in behind its back:
   setRunner also clears the liveness and clock seams, so the test would go green against the stand-in instead. From
   the moment this file loads, win32job.setRunner is watched, and jobPath refuses rather than replace such a runner.
   A runner installed BEFORE this file was required cannot be seen; engine/create.test.js and engine/status.test.js
   install theirs that way and say so where they ask for a path. */
let foreignRunner = false;
if (win32()) {
  const win32job = require('../engine/win32job');
  const setRunner = win32job.setRunner;
  win32job.setRunner = (fn) => {
    foreignRunner = typeof fn === 'function' && !fn[STAND_IN];
    return setRunner(fn);
  };
}

function stubAnswer(dir) {
  return (args) => {
    const a = Array.isArray(args) ? args.map(String) : [];
    const verb = a[0];
    const tnAt = a.indexOf('/TN');
    const tn = tnAt >= 0 ? a[tnAt + 1] : null;
    const file = tn ? taskFile(dir, tn) : null;
    const exists = () => !!file && fs.existsSync(file);
    if (file && !fs.existsSync(file)) runningTasks.delete(file);
    if (verb === '/Query') {
      if (a.includes('/XML')) return exists() ? { ok: true, out: fs.readFileSync(file, 'utf8') } : { ok: false, out: NOT_FOUND };
      if (a.includes('/FO') && a[a.indexOf('/FO') + 1] === 'CSV') {
        const rows = taskRows(dir);
        if (tn) return rows.length ? { ok: true, out: rows.join('\r\n') + '\r\n' } : { ok: false, out: NOT_FOUND };
        // The whole machine's list: never empty on a real computer, so one task outside the Kosmos folder rides along.
        return { ok: true, out: ['"\\Microsoft\\Windows\\Fixture\\Task","N/A","Ready"'].concat(rows).join('\r\n') + '\r\n' };
      }
      if (!exists()) return { ok: false, out: NOT_FOUND };
      const off = switchedOff(fs.readFileSync(file, 'utf8'));
      return { ok: true, out: `TaskName: \\${String(tn).replace(/^\\+/, '')}\r\nStatus: ${off ? 'Disabled' : 'Ready'}\r\n` };
    }
    if (verb === '/Create') {
      if (!file) return { ok: false, out: 'ERROR: The task name is not one this stand-in keeps.' };
      const xmlAt = a[a.indexOf('/XML') + 1];
      let xml;
      try { xml = fs.readFileSync(xmlAt).toString('utf16le').replace(/^\uFEFF/, ''); } catch (e) { return { ok: false, out: `ERROR: ${e.message}` }; }
      fs.writeFileSync(file, xml, 'utf8');
      return { ok: true, out: `SUCCESS: The scheduled task "${tn}" has successfully been created.` };
    }
    if (verb === '/Delete') {
      if (!exists()) return { ok: false, out: NOT_FOUND };
      fs.rmSync(file, { force: true });
      runningTasks.delete(file);
      return { ok: true, out: `SUCCESS: The scheduled task "${tn}" was successfully deleted.` };
    }
    if (verb === '/Change') {
      if (!exists()) return { ok: false, out: NOT_FOUND };
      const on = a.includes('/ENABLE');
      const before = fs.readFileSync(file, 'utf8');
      const settings = /<Settings>([\s\S]*?)<\/Settings>/.exec(before);
      /* Task Scheduler keeps a <Settings> with the switch in every task it stores, so the switch is written whether or
         not the definition had one: into its <Settings>, or into a new one (a test's placeholder definition, say). */
      const flag = `<Enabled>${on ? 'true' : 'false'}</Enabled>`;
      let text;
      if (!settings) text = `${before}<Settings>${flag}</Settings>`;
      else {
        const inner = /<Enabled>[\s\S]*?<\/Enabled>/.test(settings[1])
          ? settings[1].replace(/<Enabled>[\s\S]*?<\/Enabled>/, flag)
          : `${settings[1]}${flag}`;
        text = before.replace(settings[0], () => `<Settings>${inner}</Settings>`);   // a function: no $ patterns read in it
      }
      fs.writeFileSync(file, text, 'utf8');
      return { ok: true, out: `SUCCESS: The parameters of scheduled task "${tn}" have been changed.` };
    }
    if (verb === '/Run') {
      if (!exists()) return { ok: false, out: NOT_FOUND };
      // A switched-off task does not start: Task Scheduler refuses /Run on it, so a test never reads a start that was not.
      if (switchedOff(fs.readFileSync(file, 'utf8'))) return { ok: false, out: 'ERROR: The task is disabled.' };
      /* A started task runs the agent's supervisor, whose first act is the ownership row win32create.awaitSession
         waits for (win32create.prepareSession). The stand-in writes that row, under the name and runner on the task's
         line, into the sandboxed store, as engine/create.test.js's own Windows runner does. */
      const text = fs.readFileSync(file, 'utf8');
      /* kosmos#8456 review 2: a task already running is not started again (IgnoreNew): schtasks still answers
         SUCCESS, and nothing new comes up, which is what a restart that skipped its /End would meet. */
      if (runningTasks.has(file) && ignoresNew(text)) return { ok: true, out: `SUCCESS: Attempted to run the scheduled task "${tn}".` };
      runningTasks.add(file);
      const spec = taskLine(text);
      // kosmos#8456 review 2: an agent marked neverComesUp has a task that runs and a supervisor that never starts.
      if (spec && spec.name && !(processTable && processTable.staysDown(spec.name))) {
        const id = `fixture-run-${process.pid}-${++runs}`;
        require('../engine/win32sessions').record(id, { name: spec.name, runner: spec.runner || 'claude' });
        // kosmos#8456: and with a process table installed, the agent the supervisor starts is running (see win32Processes).
        if (processTable) processTable.started(spec.name, id, spec.runner || 'claude');
      }
      return { ok: true, out: `SUCCESS: Attempted to run the scheduled task "${tn}".` };
    }
    if (verb === '/End') {
      if (!exists()) return { ok: false, out: NOT_FOUND };
      /* It ends the task's instance (its supervisor). The agent's own process is ended by taskkill, the act a Mac's
         kill-session pairs with, so the process table is left to that. Not running answers as schtasks does, which
         win32job.end reads as the end state it wanted. */
      if (!runningTasks.delete(file)) return { ok: false, out: `ERROR: The scheduled task "${tn}" is not running.` };
      return { ok: true, out: `SUCCESS: The scheduled task "${tn}" was terminated successfully.` };
    }
    return { ok: false, out: 'ERROR: the stand-in Task Scheduler does not know this call.' };
  };
}

/* Installs the stand-in (on every call) and forgets what win32job remembered of any task: a test that writes
   or deletes a task file asks for its path first, and win32job keeps a read task until its own install or remove
   (the #2717 cache), which a file written behind its back is not. setRunner is the call that clears that memory. */
function useWin32Scheduler() {
  const dir = win32TaskDir();
  const win32job = require('../engine/win32job');
  if (foreignRunner) {
    throw new Error('jobfixture: a test installed its own win32job runner, and asking for a job path would replace it with '
      + 'the stand-in Task Scheduler; put it back (win32job.setRunner(null)) or keep the path from before installing it');
  }
  /* Registering a task copies node beside the task first (win32anchor); here that is a path, never a copy. Installed on
     every call, as the runner is, so a test that put the real anchorer back (setAnchorer(null)) never copies node. */
  win32job.setAnchorer(() => ({ ok: true, node: process.execPath, boot: path.join(dir, 'supervisor-boot.js') }));
  currentScheduler = stubScheduler(dir);
  win32job.setRunner(currentScheduler);
  return dir;
}

/** kosmos#8456 review 5: whether a command's arguments are the act a test looks for, in any order: `first` is the verb
    in front (`/Change`, `/End`; leave it out for taskkill), `values` the switches that carry a value and that value
    (`{ '/TN': tn }`, `{ '/PID': pid }`), and `flags` the bare switches that must be there (`['/DISABLE']`, `['/T', '/F']`).
    Values are compared as strings. An exact command string would fail on a reordering that changes nothing. */
function argsMatch(args, want) {
  const a = Array.isArray(args) ? args.map(String) : [];
  const w = want || {};
  if (w.first !== undefined && a[0] !== w.first) return false;
  for (const [key, value] of Object.entries(w.values || {})) {
    const at = a.indexOf(key);
    if (at < 0 || a[at + 1] !== String(value)) return false;
  }
  return (w.flags || []).every((f) => a.includes(f));
}

/** kosmos#8456 review 4: no task running at the stand-in Task Scheduler, for a test that ran a task through it and
    is done (create and adopt start theirs with /Run and nothing ends them), so the next test starts afresh. */
function resetScheduler() {
  runningTasks.clear();
}

/** kosmos#8456 review 3: the agent's task as the stand-in Task Scheduler holds it, read without installing anything:
    { exists, enabled, running }. `enabled` is the task's own switch (<Settings><Enabled>); `running` is true from an
    answered /Run (or win32Processes' start) until its /End or /Delete. Windows only. */
function win32Task(name, worldId) {
  if (!win32()) throw new Error('jobfixture.win32Task: the stand-in Task Scheduler is Windows only');
  const file = taskFile(win32TaskDir(), require('../engine/win32job').taskName(name, worldId));
  const exists = !!file && fs.existsSync(file);
  return { exists, enabled: exists && !switchedOff(fs.readFileSync(file, 'utf8')), running: exists && runningTasks.has(file) };
}

/** kosmos#8456: watch the stand-in Task Scheduler. `fn(args)` sees every schtasks call (its arguments, `/Run`, `/TN`,
    the task name...) before the stand-in answers it, whether win32job made it through its own runner or a test passed it
    on with win32Step. Returning `{ ok, out }` answers the call instead of the stand-in (`{ ok: false, out: 'ERROR: Access
    is denied.' }` for an /End that fails, say); returning nothing leaves it to the stand-in. Reading a file from inside
    `fn` reads it at the moment of the call, which is how a test proves something was written BEFORE an agent was started.
    Returns the function that stops watching: call it in the test's finally, since watchers outlive a fresh jobPath. */
function watchScheduler(fn) {
  if (typeof fn !== 'function') throw new TypeError('jobfixture.watchScheduler needs a function');
  watchers.add(fn);
  return () => { watchers.delete(fn); };
}

/** kosmos#8456: an answer for the commands a Windows act YIELDS to engine/remove.js's runner instead of running itself
    (win32job's step forms, win32stop.endSteps): `schtasks.exe` goes to the stand-in Task Scheduler (so a restart's /End
    and /Run, or a put-back's /Create, reach the same task files the sync forms do) and `taskkill.exe` to the process
    table when win32Processes installed one. Answers in remove.js's runner shape ({ ok, stdout } / { ok: false, code,
    stderr }); null for any other program, or on a platform with no stand-in, so the test's own stub answers those. */
function win32Step(file, args) {
  if (!win32()) return null;
  const base = path.win32.basename(String(file || '')).toLowerCase().replace(/\.exe$/, '');
  const a = Array.isArray(args) ? args.map(String) : [];
  let r = null;
  if (base === 'schtasks') r = (currentScheduler || (useWin32Scheduler(), currentScheduler))(a);
  else if (base === 'taskkill' && processTable) r = processTable.taskkill(a);
  if (!r) return null;
  return r.ok ? { ok: true, stdout: r.out } : { ok: false, code: r.code == null ? 1 : r.code, stdout: '', stderr: r.out };
}

/* kosmos#8456: the pids the process table hands out. Above any pid this machine gives a real process (Windows numbers
   them in the low millions), so a taskkill that ever escaped its seam would name nothing real. */
const TABLE_PID_BASE = 2000000000;

/** kosmos#8456: the running agents, for a Windows test that stops or restarts one. On a Mac a running agent is a tmux
    pane, ended with kill-session and looked at again with has-session; on Windows it is a process, which engine/win32stop.js
    finds through the live list (win32live: `claude agents --json` joined to the ownership record), ends with
    `taskkill /PID <pid> /T /F`, and looks at again by asking whether the pid is still there. This installs a stand-in for
    each of those three seams of win32stop (setLive, setRunner, setAlive), answering from one table:

      start(name, runner)  an agent running now: its ownership row (win32sessions, in the sandboxed store), a live entry
                           with its own pid, and the state file its supervisor writes (win32streamstate), which is what
                           a restart reads to see the new supervisor came up. Its task, when it has one, is marked
                           running too, as it is when the agent came up from its /Run. Returns { sessionId, pid }.
      a stand-in /Run      the same, for the task's agent, while the table is installed: starting the task starts it.
      taskkill             ends the entry with that pid (gone from the live list, its supervisor's state file cleared),
                           answering as taskkill does; a pid it does not hold answers "not found" (exit 128).
      pidOf(name)          the pid that agent is running under now, or null when it is not running.
      survive(name)        the next kills of that agent answer SUCCESS and leave it running, so a test can show the
                           look-again catches a kill that did not take. Returns the undo; clearSurvivors() undoes
                           them all.
      neverComesUp(name, { stale })  that agent's task runs at its next /Run but its supervisor never starts: no
                           ownership row, no live entry, no new state file, so a restart's "did it come up" check must
                           answer no. With stale: true its kill also leaves the OLD state file in place (a dying
                           supervisor's leftover), which only the restart's pre-restart identity tells from a new
                           one. Returns the undo.
      calls                each act and look, in order: 'taskkill.exe /PID <pid> /T /F' and 'alive <pid>' (and each is
                           handed to opts.onCall too, for a test that keeps one log of every platform's acts).
      agentsJson(), codexRows()  the live list's two halves, for a roster built with win32roster.make.
      rowsOf(name)         the ownership rows still filed under that name (a stop must forget the one it ended).
      reset()              no agent running and no task running: drops the live entries, their state files, the
                           ownership rows this table wrote, the
                           survivors and the never-comes-up marks (kosmos#8456 review 3: a test file that sets up a
                           fresh fleet per arm calls it, so one arm never reads another's agents).
      stop()               puts win32stop's seams back and does what reset() does.

    The live list is answered in the two parts the engine joins (win32live.byName): a claude agent from the
    `claude agents --json` stand-in, and a per-turn agent (codex, gemini, grok, antigravity: win32codexlive.PER_TURN)
    from the codex live list, in the rows win32codexlive.liveSessions returns, never from the claude list, which a real
    `claude agents --json` never puts them on. So a byName that dropped the codex list would lose a running codex agent
    here too.

    ⚠️ What it does not stand in for, said so a reader does not assume it: how win32codexlive decides a per-turn agent
    is live (its presence and state-file read) is not exercised here; it has its own tests. The state file names THIS test process as the agent's pid, because a restart's "did it come up" check asks the
    real process table (win32orphan.pidAlive has no seam on that path) and the test process is one that is certainly
    alive; nothing ever kills it, since every kill goes to the table, which only holds its own pids. Windows only. */
function win32Processes(opts) {
  if (!win32()) throw new Error('jobfixture.win32Processes: the process table stands in for Windows only');
  const win32stop = require('../engine/win32stop');
  const win32live = require('../engine/win32live');
  const win32sessions = require('../engine/win32sessions');
  const streamstate = require('../engine/win32streamstate');
  const store = require('../engine/store');
  const live = new Map();   // sessionId -> { sessionId, pid, name, runner }
  const perTurn = (runner) => require('../engine/win32codexlive').PER_TURN.has(runner);
  const survivors = new Set();
  const down = new Map();   // name -> { stale }
  const written = new Set();
  const ownedIds = new Set();   // the ownership rows this table wrote, so reset() can take back any a stop left
  const calls = [];
  const onCall = opts && typeof opts.onCall === 'function' ? opts.onCall : null;
  const note = (line) => { calls.push(line); if (onCall) onCall(line); };
  let pids = 0;
  const statePath = (name) => path.join(store.ROOT, 'win32-state', store.safeKey(name) + '.json');

  const table = {
    calls,
    started(name, sessionId, runner) {
      ownedIds.add(sessionId);
      const pid = TABLE_PID_BASE + 4 * ++pids;
      live.set(sessionId, { sessionId, pid, name, runner: runner || 'claude' });
      const at = statePath(name);
      fs.mkdirSync(path.dirname(at), { recursive: true });
      fs.writeFileSync(at, JSON.stringify({ v: streamstate.STATE_FILE_VERSION, pid: process.pid, sessionId }));
      written.add(at);
      return { sessionId, pid };
    },
    start(name, runner) {
      const id = `fixture-proc-${process.pid}-${++runs}`;
      win32sessions.record(id, { name, runner: runner || 'claude' });
      const task = taskFile(win32TaskDir(), require('../engine/win32job').taskName(name));
      if (task && fs.existsSync(task)) runningTasks.add(task);
      return table.started(name, id, runner);
    },
    /* The live list as its two sources give it: `claude agents --json` (claude agents) and the codex live list (per-turn
       agents), for a test that builds the Windows board's roster from the table (win32roster.make({ run, codexLive })).
       Built from the processes, never from the ownership record: the real list names running processes, so a row
       left in the record after its process ended does not appear in it, here or on a real machine. */
    agentsJson() {
      return [...live.values()].filter((p) => !perTurn(p.runner))
        .map((p) => ({ sessionId: p.sessionId, pid: p.pid, name: p.name, status: 'running' }));
    },
    codexRows() {
      return [...live.values()].filter((p) => perTurn(p.runner))
        .map((p) => ({ sessionId: p.sessionId, pid: p.pid, name: p.name, kind: 'interactive', runner: p.runner }));
    },
    /* kosmos#8456 review 4: the ownership rows (win32sessions) still filed under this name. A stop that ended the
       process must also forget its row (win32stop.finishKill); since the live list cannot show a stale row, a test
       asks for it here. */
    rowsOf(name) {
      const owned = win32sessions.read() || {};
      return Object.keys(owned).filter((id) => owned[id] && owned[id].name === name).sort();
    },
    reset() {
      for (const id of ownedIds) win32sessions.forget(id);
      ownedIds.clear();
      live.clear();
      survivors.clear();
      down.clear();
      runningTasks.clear();
      for (const at of written) fs.rmSync(at, { force: true });
      written.clear();
    },
    taskkill(args) {
      note(['taskkill.exe', ...args].join(' '));
      const pid = Number(args[args.indexOf('/PID') + 1]);
      const hit = [...live.values()].find((p) => p.pid === pid);
      if (!hit) return { ok: false, code: 128, out: `ERROR: The process "${pid}" not found.` };
      if (!survivors.has(hit.name)) {
        live.delete(hit.sessionId);
        /* The supervisor clears the state file naming the child that exited (only its own: a newer one is left).
           review 5: unless the agent is marked neverComesUp(name, { stale: true }): a dying supervisor that leaves
           its old state file behind, which is what a restart's pre-restart identity (`before`) guards against. */
        const at = statePath(hit.name);
        const left = down.get(hit.name);
        if (!(left && left.stale)) try { if (JSON.parse(fs.readFileSync(at, 'utf8')).sessionId === hit.sessionId) fs.rmSync(at, { force: true }); } catch { /* none */ }
      }
      return { ok: true, out: `SUCCESS: The process with PID ${pid} has been terminated.` };
    },
    alive(pid) {
      note(`alive ${pid}`);
      return [...live.values()].some((p) => p.pid === pid);
    },
    pidOf(name) {
      const hit = [...live.values()].find((p) => p.name === name);
      return hit ? hit.pid : null;
    },
    survive(name) {
      survivors.add(name);
      return () => { survivors.delete(name); };
    },
    clearSurvivors() { survivors.clear(); },
    neverComesUp(name, how) {
      down.set(name, { stale: Boolean(how && how.stale) });
      return () => { down.delete(name); };
    },
    staysDown(name) { return down.has(name); },
    stop() {
      if (processTable === table) processTable = null;
      win32stop.setRunner(null);
      win32stop.setAlive(null);
      win32stop.setLive(null);
      table.reset();
    },
  };
  win32stop.setRunner((args) => table.taskkill((Array.isArray(args) ? args : []).map(String)));
  win32stop.setAlive((pid) => table.alive(pid));
  win32stop.setLive((opts) => win32live.byName({
    ...(opts || {}),
    run: () => table.agentsJson(),
    codexLive: () => table.codexRows(),
  }));
  processTable = table;
  return table;
}

/** kosmos#8378: for a test that lets create write a real job and reads it back without seeding one first. On Windows
    this installs the stand-in Task Scheduler (as jobPath does) and returns true; elsewhere the job is a file in the
    sandbox already and nothing is needed (false). */
function useJobStore() {
  if (!win32()) return false;
  useWin32Scheduler();
  return true;
}

/** Where this platform keeps the agent's job file. On Linux its folder is made too: the tests made the LaunchAgents
    folder for the plist and write to this path themselves, and the unit folder does not exist until something makes it. */
function jobPath(name, worldId) {
  if (win32()) {
    const dir = useWin32Scheduler();
    return taskFile(dir, require('../engine/win32job').taskName(name, worldId));
  }
  if (linux()) {
    /* Never the person's real unit folder: with no sandbox set, unitPath is ~/.config/systemd/user, and this helper
       makes the folder and the tests write into it. A test that keeps its sandbox only in a child's env uses jobPathIn. */
    if (!process.env.AGENT_WORKFORCE_SYSTEMD_DIR && !process.env.AGENT_WORKFORCE_LAUNCH) {
      throw new Error('jobfixture.jobPath: no sandbox (set AGENT_WORKFORCE_LAUNCH or AGENT_WORKFORCE_SYSTEMD_DIR, or use jobPathIn)');
    }
    const p = require('../engine/linuxjob').unitPath(name, worldId);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    return p;
  }
  return require('../engine/create').plistPath(name, worldId);
}

/** Where a board whose sandbox is `launchDir` (its AGENT_WORKFORCE_LAUNCH, with no AGENT_WORKFORCE_SYSTEMD_DIR) keeps the
    agent's job: the plist in launchDir on macOS, the unit in launchDir/systemd/user on Linux (linuxjob.defaultSystemdDir).
    For tests that hand the sandbox only to a child board. The folder is made. The name comes from THIS process's
    world (KOSMOS_WORLD, unless worldId is given), so the child board must inherit that variable to look for the same file. */
function jobPathIn(launchDir, name, worldId) {
  if (linux()) {
    const dir = path.join(launchDir, 'systemd', 'user');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, require('../engine/linuxjob').unitName(name, worldId));
  }
  return path.join(launchDir, require('../engine/create').serviceLabel(name, worldId) + '.plist');
}

/** The job file's text, as this platform writes it (same arguments as create.plistFor). */
function jobFor(name, runnerBin, tmuxBin, model, configDir, runnerName) {
  if (win32()) {
    /* kosmos#8378: the task definition win32job.install registers, with the facts create.readJob reads back from its
       argument line (runner binary, model, account folder, runner). A Windows task has no tmux. */
    const workers = process.env.AGENT_WORKFORCE_WORKERS || process.env.AGENT_WORKFORCE_LAUNCH || '';
    return require('../engine/win32job').taskXml({
      name, cwd: path.join(workers, name), model: model || null, configDir: configDir || null,
      runner: runnerName || 'claude', claudeBin: runnerBin || null,
      // A path on the line, never run; no sandbox needed, so a test that writes the text for a child board can ask too.
      node: process.execPath, supervisor: path.join(workers || require('node:os').tmpdir(), 'supervisor-boot.js'),
    });
  }
  if (linux()) return require('../engine/linuxjob').unitFor(name, runnerBin, tmuxBin, model, configDir, runnerName);
  return require('../engine/create').plistFor(name, runnerBin, tmuxBin, model, configDir, runnerName);
}

/** #5500: a stand-in for `systemctl --user` and `loginctl`, for a test's runner stub that answered launchctl only.
    It keeps the units it has started and enabled, so it answers as systemd does: is-active "active" for a started unit
    and "inactive" (exit 3) otherwise; is-enabled "enabled" or "disabled" (exit 1); list-units and list-unit-files from
    the same two sets; linger on. Any other systemctl verb (daemon-reload, restart, ...) succeeds with no output. Any
    other PROGRAM answers null, so the test's own fake answers it (on a Mac every call does). `.active` and `.enabled` are the two sets, for a test that seeds a unit as running or switched on. */
function systemdStub() {
  const active = new Set();
  const enabled = new Set();
  const answer = (file, args) => {
    const cmd = String(file).split('/').pop();
    if ((cmd !== 'systemctl' && cmd !== 'loginctl') || !Array.isArray(args)) return null;
    if (cmd === 'loginctl') return { ok: true, stdout: args[0] === 'show-user' ? 'Linger=yes\n' : '' };
    const [, verb, unit] = args;   // args[0] is --user
    if (verb === 'start') active.add(unit);
    else if (verb === 'stop') active.delete(unit);
    else if (verb === 'enable') enabled.add(unit);
    else if (verb === 'disable') enabled.delete(unit);
    else if (verb === 'is-active') return active.has(unit) ? { ok: true, stdout: 'active\n' } : { ok: false, code: 3, stdout: 'inactive\n' };
    else if (verb === 'is-enabled') return enabled.has(unit) ? { ok: true, stdout: 'enabled\n' } : { ok: false, code: 1, stdout: 'disabled\n' };
    else if (verb === 'list-units') return { ok: true, stdout: [...active].map((u) => `${u} loaded active running x\n`).join('') };
    else if (verb === 'list-unit-files') {
      const units = new Set([...enabled, ...active]);
      return { ok: true, stdout: [...units].map((u) => `${u} ${enabled.has(u) ? 'enabled' : 'disabled'} enabled\n`).join('') };
    }
    return { ok: true, stdout: '' };
  };
  answer.active = active;
  answer.enabled = enabled;
  return answer;
}

module.exports = { jobPath, jobPathIn, jobFor, systemdStub, useJobStore, watchScheduler, win32Step, win32Processes, win32Task, resetScheduler, argsMatch };
