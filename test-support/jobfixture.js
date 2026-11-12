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
 * definition file in the sandbox (AGENT_WORKFORCE_LAUNCH/win32-tasks/agent-<key>.xml, the text win32job.taskXml
 * writes), and jobPath installs a stand-in Task Scheduler through win32job's own command seam (setRunner) that
 * answers from those files: a test that writes or deletes the file registers or removes the task, exactly as writing
 * or deleting the plist does on a Mac. macOS and Linux are unchanged.
 *
 * ASK FOR THE PATH EACH TIME YOU WRITE OR DELETE THE FILE on Windows: win32job remembers a task it has read until
 * its own install or remove (the #2717 cache), and jobPath is what forgets it. A path kept in a variable and written
 * again later is read back stale there. The stand-in lives in this process only: a board a test spawns does not see it
 * (jobPathIn still writes a plist there). It also stands in for the start: /Run writes the ownership row the agent's
 * supervisor would (win32sessions, in the sandboxed store).
 */
const fs = require('node:fs');
const path = require('node:path');

const linux = () => process.platform === 'linux';
const win32 = () => process.platform === 'win32';

/* kosmos#8378: the stand-in Task Scheduler for a Windows host. Its tasks are the `agent-*.xml` files in one sandbox
   folder, named by the task's name under the Kosmos folder; it answers the schtasks calls engine/win32job.js makes
   through its own runner (setRunner: /Query /XML, /Query /FO LIST, the two /FO CSV lists, /Create, /Delete, /Change,
   /Run, /End) from those files. NOT the step forms (installSteps, startSteps, endSteps, taskEnabledSteps): those hand
   `schtasks.exe` to engine/remove.js's runner, which a test stubs on its own, so a put-back or restore through them
   registers nothing here, whatever that stub answers. It answers /Query /XML in UTF-8, so win32job's UTF-16 decode of
   a real answer (taskXmlFromQuery) is not exercised here; that has its own tests. */
const NOT_FOUND = 'ERROR: The system cannot find the file specified.';

function win32TaskDir() {
  if (!process.env.AGENT_WORKFORCE_LAUNCH) {
    throw new Error('jobfixture.jobPath: no sandbox (set AGENT_WORKFORCE_LAUNCH); on Windows the job is a task file kept there');
  }
  const dir = path.join(process.env.AGENT_WORKFORCE_LAUNCH, 'win32-tasks');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/* `Kosmos\agent-ava` -> <dir>/agent-ava.xml; null for a name outside the Kosmos folder. */
function taskFile(dir, tn) {
  const win32job = require('../engine/win32job');
  const folder = win32job.TASK_PREFIX.split('\\')[0] + '\\';
  const at = String(tn || '').replace(/^\\+/, '');
  if (!at.toLowerCase().startsWith(folder.toLowerCase())) return null;
  const leaf = at.slice(folder.length);
  if (!leaf || /[\\/]/.test(leaf)) return null;
  return path.join(dir, leaf + '.xml');
}

/* The task's own switch, read where Task Scheduler keeps it (<Settings><Enabled>), as win32job.taskEnabled reads it. */
function switchedOff(text) {
  const settings = /<Settings>([\s\S]*?)<\/Settings>/.exec(String(text));
  return !!settings && /<Enabled>\s*(false|0)\s*<\/Enabled>/.test(settings[1]);
}

let runs = 0;   // the /Run count, so each started task gets its own ownership-row id

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
  try { names = fs.readdirSync(dir).filter((n) => /^agent-.+\.xml$/.test(n)); } catch { names = []; }
  return names.map((n) => {
    let text = '';
    try { text = fs.readFileSync(path.join(dir, n), 'utf8'); } catch { text = ''; }
    return `"\\${folder}\\${n.slice(0, -4)}","N/A","${switchedOff(text) ? 'Disabled' : 'Ready'}"`;
  });
}

/* A task file the stand-in cannot read (a folder where the file should be, say) is a look that failed, the way
   schtasks failing to answer is: never thrown at the caller, and never "no such task". */
const STAND_IN = Symbol('jobfixture stand-in Task Scheduler');
function stubScheduler(dir) {
  const answer = stubAnswer(dir);
  const run = (args) => {
    try { return answer(args); } catch (e) { return { ok: false, out: `ERROR: ${(e && e.message) || 'the stand-in Task Scheduler could not read the task'}` }; }
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
      const spec = taskLine(fs.readFileSync(file, 'utf8'));
      if (spec && spec.name) {
        require('../engine/win32sessions').record(`fixture-run-${process.pid}-${++runs}`, { name: spec.name, runner: spec.runner || 'claude' });
      }
      return { ok: true, out: `SUCCESS: Attempted to run the scheduled task "${tn}".` };
    }
    if (verb === '/End') return exists() ? { ok: true, out: 'SUCCESS' } : { ok: false, out: NOT_FOUND };
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
  win32job.setRunner(stubScheduler(dir));
  return dir;
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

module.exports = { jobPath, jobPathIn, jobFor, systemdStub, useJobStore };
