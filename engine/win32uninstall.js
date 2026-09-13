'use strict';
/**
 * `Kosmos.exe --uninstall`, the half that is already a fact in the engine
 * (win32-installer-native, installer audit W-27a).
 *
 * 🛑 WHY THIS IS NODE AND NOT THE LAUNCHER. Deleting the folder was the only "uninstall" a
 * Windows user had, and it left `Kosmos\board` and every `Kosmos\agent-*` task firing at each
 * sign-in, plus both data folders. Removing those needs the task names, the schtasks seam, the
 * not-found rule, the anchor's folder and the store's folder, and every one of them is already
 * derived once, in win32job, win32board, win32anchor and store. A C# copy in the launcher would
 * be a second derivation of each (convention 5). So the launcher asks the questions and shows
 * the answer, and this module does the removing.
 *
 * 🔑 IN ORDER, EACH STEP WITH ITS OWN RESULT, NOTHING SILENTLY SKIPPED:
 *   1. read Task Scheduler's Kosmos folder once (win32job.kosmosFolderTasks);
 *   2. every agent task, of every Kosmos: disable, end, remove (win32job, by the world its own
 *      path names);
 *   3. the board task last: end, remove (win32board);
 *   4. a task in the folder that is neither is LEFT, and named, never guessed at;
 *   5. %LOCALAPPDATA%\Kosmos (the anchor's folder), only once every task is gone: a task that
 *      is still registered still needs its runtime;
 *   6. %APPDATA%\Kosmos (the store), only when the person said yes, and under the same rule;
 *   7. the projects are never deleted: a folder that holds them is refused.
 * Every refusal and failure comes back as a sentence naming what was left behind.
 *
 * ⚠️ GATED TWICE (convention 3). `uninstall()` refuses without `liveExecutionAllowed`, and the
 * CLI below is a dry run unless `--yes`, which only the launcher passes, after the person
 * confirmed (engine/win32update.js's S2 CLI shape). Under both, win32job and win32board refuse
 * schtasks from any test process.
 *
 * The launcher's CLI:
 *     node app\engine\win32uninstall.js --uninstall [--delete-data] [--root <bundle>] [--report <file>] [--yes]
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const launchidentity = require('./launchidentity');
const liveExec = require('./live-execution');
const store = require('./store');
const win32anchor = require('./win32anchor');
const win32board = require('./win32board');
const win32job = require('./win32job');
const worlds = require('./worlds');

/* How a folder delete waits for the processes the task ends just ended to let go of their files.
   `/End` to node exiting measured about 2s (engine/win32orphan.js); an agent's own tree or a virus
   scanner can hold a handle a little longer. fs.rmSync retries EBUSY and EPERM itself: 20 tries
   500ms apart is 10s. */
const FOLDER_DELETE_TRIES = 20;
const FOLDER_DELETE_WAIT_MS = 500;

const REFUSED_WITHOUT_CONFIRM = 'Kosmos was not removed, because the removal was not confirmed';

const USAGE = 'usage: node engine/win32uninstall.js --uninstall [--delete-data] [--root <folder>] [--report <file>] [--yes]';

function firstLine(value) {
  return String((value && value.message) || value || 'no detail').trim().split(/\r?\n/)[0];
}

/** One line of a report can never become two. */
function oneLine(sentence) {
  return String(sentence).replace(/\s*\r?\n\s*/g, ' ');
}

/**
 * What one path in the Kosmos folder is. The board by its one name, an agent by win32job's
 * prefix with its key parsed by launchidentity (so another Kosmos's agent is reached in its own
 * world), and anything else is not ours to guess at.
 */
function classifyTask(taskPath) {
  const at = String(taskPath);
  if (at.toLowerCase() === win32board.TASK_NAME.toLowerCase()) return { kind: 'board', path: at };
  if (at.startsWith(win32job.TASK_PREFIX)) {
    const parsed = launchidentity.parseKey(at.slice(win32job.TASK_PREFIX.length));
    if (parsed.name) return { kind: 'agent', path: at, name: parsed.name, worldId: parsed.worldId };
  }
  return { kind: 'other', path: at };
}

function agentLabel(task) {
  const inWorld = launchidentity.isDefaultWorld(task.worldId) ? '' : ' in the Kosmos "' + task.worldId + '"';
  return 'the startup job for the agent "' + task.name + '"' + inWorld + ' (' + task.path + ')';
}

/** Case-insensitive on Windows, where paths are; exact elsewhere. */
function isSameOrInside(child, parent, platform) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const fold = (s) => (platform === 'win32' ? s.toLowerCase() : s);
  const c = fold(p.resolve(String(child))).replace(/[\\/]+$/, '');
  const r = fold(p.resolve(String(parent))).replace(/[\\/]+$/, '');
  if (!r) return false;
  return c === r || c.startsWith(r + p.sep);
}

/**
 * Why this folder must not be deleted, or null. The folder must be the one Kosmos derives
 * (`leaf`), and it must not hold the person's projects, their user folder, or the Kosmos folder
 * this removal is running from.
 */
function folderRefusal(dir, g) {
  const p = g.platform === 'win32' ? path.win32 : path.posix;
  if (!dir || !p.isAbsolute(dir)) return 'we could not work out where it is';
  if (p.basename(dir).toLowerCase() !== String(g.leaf).toLowerCase()) return 'it is not a folder named ' + g.leaf;
  if (g.projectsRoot && isSameOrInside(g.projectsRoot, dir, g.platform)) return 'your projects are inside it (' + g.projectsRoot + ')';
  if (g.home && isSameOrInside(g.home, dir, g.platform)) return 'your user folder is inside it';
  if (g.bundleRoot && isSameOrInside(g.bundleRoot, dir, g.platform)) return 'Kosmos is running from inside it (' + g.bundleRoot + ')';
  return null;
}

function removeFolderWithRetries(dir) {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: FOLDER_DELETE_TRIES, retryDelay: FOLDER_DELETE_WAIT_MS });
}

/** Delete one of Kosmos's folders, or say why it is still there. */
function deleteFolder(dir, label, g, rm) {
  const refusal = folderRefusal(dir, g);
  if (refusal) return { ok: false, said: label + ' (' + dir + '), kept because ' + refusal };
  if (!fs.existsSync(dir)) return { ok: true, said: label + ' (' + dir + ') was already gone' };
  try {
    rm(dir);
  } catch (e) {
    return { ok: false, said: label + ' (' + dir + '), which could not be deleted (' + firstLine(e) + '), so some of it may be left' };
  }
  if (fs.existsSync(dir)) return { ok: false, said: label + ' (' + dir + '), which was still there after deleting it' };
  return { ok: true, said: 'deleted ' + label + ' (' + dir + ')' };
}

/**
 * Remove Kosmos from this computer, except the folder it runs from and the person's projects.
 *
 * @param {object} opts
 *   deleteData            also delete the store (the person said yes to the second question)
 *   bundleRoot            the Kosmos folder running this, which is never deleted from here
 *   liveExecutionAllowed  () => boolean; without it this refuses and changes nothing
 *   platform, env, home, projectsRoot, removeFolder   seams, with real defaults
 * @returns {{ok: boolean, refused?: boolean, done: string[], left: string[], notes: string[]}}
 *   `left` names everything still on the computer that the removal was meant to take away.
 */
function uninstall(opts) {
  const o = opts || {};
  const allowed = typeof o.liveExecutionAllowed === 'function' ? o.liveExecutionAllowed() : liveExec.liveExecutionAllowed();
  if (!allowed) return { ok: false, refused: true, done: [], left: [REFUSED_WITHOUT_CONFIRM], notes: [] };
  const platform = o.platform || process.platform;
  if (platform !== 'win32') {
    return { ok: false, refused: true, done: [], left: ['Kosmos removes itself this way only on Windows'], notes: [] };
  }
  const env = worlds.preWorldEnv(o.env || process.env);
  const home = o.home || env.AGENT_WORKFORCE_HOME || os.homedir();
  const rm = typeof o.removeFolder === 'function' ? o.removeFolder : removeFolderWithRetries;
  const projectsRoot = o.projectsRoot || require('./projects').projectsRoot();
  const done = [];
  const left = [];
  const notes = [];

  /* 1-4: the tasks. */
  let everyTaskGone = false;
  const folder = win32job.kosmosFolderTasks();
  if (!folder.known) {
    left.push('the startup jobs in Task Scheduler\'s Kosmos folder, which we could not read (' + folder.because + ')');
  } else {
    everyTaskGone = true;
    const tasks = folder.paths.map(classifyTask);
    for (const task of tasks.filter((t) => t.kind === 'agent')) {
      const label = agentLabel(task);
      const switchedOff = win32job.disable(task.name, task.worldId);
      const ended = win32job.end(task.name, task.worldId);
      const removed = win32job.remove(task.name, task.worldId);
      if (!removed.ok) {
        everyTaskGone = false;
        left.push(label + ', which is still in Task Scheduler (' + removed.because + ')'
          + (switchedOff.ok ? '' : ', and still switched on (' + switchedOff.because + ')'));
      } else {
        done.push('removed ' + label);
      }
      if (!ended.ok) left.push('the agent "' + task.name + '", which may keep running until you sign out, because ending it failed (' + ended.because + ')');
    }
    for (const task of tasks.filter((t) => t.kind === 'other')) {
      everyTaskGone = false;
      left.push('a task named ' + task.path + ' in Task Scheduler\'s Kosmos folder, which Kosmos does not recognise, so it was left in place. '
        + 'Remove it in Task Scheduler (Task Scheduler Library, then Kosmos) and remove Kosmos again');
    }
    for (const task of tasks.filter((t) => t.kind === 'board')) {
      const ended = win32board.end();
      const removed = win32board.remove({ platform, env, home });
      if (!removed.ok) {
        everyTaskGone = false;
        left.push('the startup job for the Kosmos board (' + task.path + '), which is still in Task Scheduler (' + removed.because + ')');
      } else {
        done.push('removed the startup job for the Kosmos board (' + task.path + ')');
      }
      if (!ended.ok) left.push('the Kosmos board, which may keep running until you sign out, because ending it failed (' + ended.because + ')');
    }
  }

  /* 5-7: the folders, only once nothing registered still needs them. */
  let runtimeDir = null;
  let dataDir = null;
  try { runtimeDir = path.win32.dirname(win32anchor.anchorDir('win32', home, env)); } catch (e) { left.push('Kosmos\'s runtime folder in AppData\\Local, which we could not find (' + firstLine(e) + ')'); }
  try { dataDir = store.dataRootFor('win32', home, env); } catch (e) {
    if (o.deleteData) left.push('your agents\' chats and settings in AppData\\Roaming, which we could not find (' + firstLine(e) + ')');
  }
  const guards = { platform, projectsRoot, home, bundleRoot: o.bundleRoot || null };

  if (runtimeDir) {
    if (!everyTaskGone) {
      left.push('Kosmos\'s runtime folder (' + runtimeDir + '), kept because Kosmos startup jobs are still registered and need it');
    } else {
      const r = deleteFolder(runtimeDir, 'Kosmos\'s runtime folder', { ...guards, leaf: win32anchor.APP }, rm);
      (r.ok ? done : left).push(r.said);
    }
  }
  if (dataDir) {
    if (!o.deleteData) {
      notes.push('Your agents\' chats and settings were kept in ' + dataDir + '.');
    } else if (!everyTaskGone) {
      left.push('your agents\' chats and settings (' + dataDir + '), kept because Kosmos startup jobs are still registered and their agents use them');
    } else {
      const r = deleteFolder(dataDir, 'your agents\' chats and settings', { ...guards, leaf: store.APP }, rm);
      (r.ok ? done : left).push(r.said);
    }
  }
  notes.push('Your projects in ' + projectsRoot + ' were not touched.');

  return { ok: left.length === 0, done: done.map(oneLine), left: left.map(oneLine), notes: notes.map(oneLine) };
}

/** The report the launcher reads: one tagged sentence per line. */
function reportText(result) {
  return [
    ...(result.done || []).map((s) => 'DONE ' + oneLine(s)),
    ...(result.left || []).map((s) => 'LEFT ' + oneLine(s)),
    ...(result.notes || []).map((s) => 'NOTE ' + oneLine(s)),
  ].join('\r\n') + '\r\n';
}

function parseCliArgs(argv) {
  const a = { uninstall: false, deleteData: false, yes: false, root: null, report: null, unknown: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--uninstall') a.uninstall = true;
    else if (arg === '--delete-data') a.deleteData = true;
    else if (arg === '--yes') a.yes = true;
    else if (arg === '--root' || arg === '--report') { a[arg.slice(2)] = argv[i + 1] || null; i += 1; }
    else a.unknown = arg;
  }
  return a;
}

/**
 * `--yes` is the launcher's word that the person confirmed, and it stands in for
 * allowLiveExecution(), which only server.js's real start may call. Without it this prints what
 * it would remove and exits 2, having changed nothing.
 */
function cliMain(argv, deps) {
  const d = deps || {};
  const out = typeof d.write === 'function' ? d.write : (s) => process.stdout.write(s);
  const a = parseCliArgs(argv);
  if (!a.uninstall || a.unknown) { out(USAGE + '\n'); return 64; }
  if (!a.yes) {
    const env = worlds.preWorldEnv(process.env);
    const home = env.AGENT_WORKFORCE_HOME || os.homedir();
    let runtimeDir = null;
    let dataDir = null;
    try { runtimeDir = path.win32.dirname(win32anchor.anchorDir('win32', home, env)); } catch { runtimeDir = null; }
    try { dataDir = store.dataRootFor('win32', home, env); } catch { dataDir = null; }
    out(JSON.stringify({
      dryRun: true,
      wouldRemove: ['every task in Task Scheduler\'s Kosmos folder', runtimeDir].concat(a.deleteData ? [dataDir] : []),
      wouldKeep: (a.deleteData ? [] : [dataDir]).concat([a.root || 'the Kosmos folder this runs from']),
      because: 'nothing was changed: add --yes to remove Kosmos',
    }, null, 2) + '\n');
    return 2;
  }
  const result = (d.uninstall || uninstall)({ deleteData: a.deleteData, bundleRoot: a.root, liveExecutionAllowed: () => true });
  if (a.report) {
    try {
      fs.writeFileSync(a.report, reportText(result), 'utf8');
    } catch (e) {
      out('could not write the report to ' + a.report + ': ' + firstLine(e) + '\n');
      return 1;
    }
  }
  out(JSON.stringify(result, null, 2) + '\n');
  return result.ok ? 0 : 1;
}

module.exports = { uninstall, cliMain, classifyTask, folderRefusal, reportText, FOLDER_DELETE_TRIES, FOLDER_DELETE_WAIT_MS };

/* Guarded on being the main module: requiring this file must never remove anything. */
if (require.main === module) {
  process.exitCode = cliMain(process.argv.slice(2));
}
