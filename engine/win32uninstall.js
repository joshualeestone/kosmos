'use strict';
/**
 * `Kosmos.exe --uninstall`, the half that is already a fact in the engine
 * (win32-installer-native, installer audit W-27a).
 *
 * 🛑 WHY THIS IS NODE AND NOT THE LAUNCHER. Deleting the folder was the only "uninstall" a
 * Windows user had, and it left `Kosmos\board` and every `Kosmos\agent-*` task firing at each
 * sign-in, plus both data folders. Removing those needs the task names, the schtasks seam, the
 * anchor's folder, the store's folder and every Kosmos's project and working folders, and every
 * one of them is already derived once, in win32job, win32board, win32anchor, store and worlds. A
 * C# copy in the launcher would be a second derivation of each (convention 5). So the launcher
 * asks the questions and shows the answer, and this module does the removing.
 *
 * 🔑 IN ORDER, EACH STEP WITH ITS OWN RESULT, NOTHING SILENTLY SKIPPED:
 *   1. read every task in Task Scheduler's Kosmos folder from the machine's whole task list
 *      (win32job.kosmosFolderTasks, locale-independent);
 *   2. switch the board's task off and end the board FIRST, so nothing can re-register an agent
 *      while the agents are being removed;
 *   3. every agent task, of every Kosmos: disable, end, remove (win32job, by the world its own
 *      path names);
 *   4. a task in the folder that is neither is LEFT, and named, never guessed at;
 *   5. remove the board's task;
 *   6. read the whole task list AGAIN. Only a list that shows no Kosmos task at all lets a folder
 *      go. Success is never inferred from what schtasks printed, which is translated;
 *   7. %LOCALAPPDATA%\Kosmos (the anchor's folder) goes only when it is exactly the plain
 *      `<LOCALAPPDATA>\Kosmos` and is neither the data folder nor overlaps it;
 *   8. on the second yes, %APPDATA%\Kosmos (the store) is emptied EXCEPT every Kosmos's projects
 *      and working folders, which are kept with the folders above them, and each is named. When
 *      the list of Kosmoses cannot be read, the store is not touched at all.
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

/** Case-insensitive on Windows, where paths are; exact elsewhere. For names, not the disk. */
function isSameOrInside(child, parent, platform) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const fold = (s) => (platform === 'win32' ? s.toLowerCase() : s);
  const c = fold(p.resolve(String(child))).replace(/[\\/]+$/, '');
  const r = fold(p.resolve(String(parent))).replace(/[\\/]+$/, '');
  if (!r) return false;
  return c === r || c.startsWith(r + p.sep);
}

/**
 * A folder as the disk names it, for comparing two folders: its real path when it exists
 * (`realpathSync.native` expands an 8.3 short name and resolves a junction), otherwise its
 * resolved spelling; always without a trailing separator and lower-cased, because Windows paths
 * are not case-sensitive.
 */
function onDisk(dir) {
  let at;
  try { at = fs.realpathSync.native(dir); } catch { at = path.resolve(String(dir)); }
  return at.replace(/[\\/]+$/, '').toLowerCase();
}
function onDiskInside(child, parent) {
  const c = onDisk(child);
  const r = onDisk(parent);
  return c === r || c.startsWith(r + path.sep.toLowerCase()) || c.startsWith(r + '/') || c.startsWith(r + '\\');
}

/**
 * Why this folder must not be deleted, or null. The folder must be the one Kosmos derives
 * (`leaf`), and it must not hold the person's user folder or the Kosmos folder this removal is
 * running from. (The projects and working folders are handled by what is kept, keptRoots.)
 */
function folderRefusal(dir, g) {
  const p = g.platform === 'win32' ? path.win32 : path.posix;
  if (!dir || !p.isAbsolute(dir)) return 'we could not work out where it is';
  if (p.basename(dir).toLowerCase() !== String(g.leaf).toLowerCase()) return 'it is not a folder named ' + g.leaf;
  if (g.home && isSameOrInside(g.home, dir, g.platform)) return 'your user folder is inside it';
  if (g.bundleRoot && isSameOrInside(g.bundleRoot, dir, g.platform)) return 'Kosmos is running from inside it (' + g.bundleRoot + ')';
  return null;
}

function removeFolderWithRetries(dir) {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: FOLDER_DELETE_TRIES, retryDelay: FOLDER_DELETE_WAIT_MS });
}

/* A junction or symbolic link goes as a link: the folder it points at is never entered. */
function removeLink(at) {
  try { fs.rmdirSync(at); } catch { fs.unlinkSync(at); }
}

function isLink(at) {
  try { return fs.lstatSync(at).isSymbolicLink(); } catch { return false; }
}

/**
 * Every Kosmos's projects folder and agents' working folder: what the second yes must never take.
 *
 * 🛑 ROUND 1, FINDING 1. A named Kosmos keeps its projects and workers INSIDE the data root
 * (`<data>\worlds\<id>\projects`, `...\workers`), so guarding only the default projects folder let
 * "also delete chats and settings" delete a named Kosmos's work. The roots here come from the ONE
 * derivation, `worlds.envOverridesFor`, for every Kosmos the registry names AND every world folder
 * on disk the registry no longer names (its work is still somebody's), plus the default Kosmos's
 * own roots (`projects.projectsRoot`, `store.workersRootFor`).
 *
 * ⚠️ FAIL CLOSED. `worlds.readRegistry` quietly falls back to the default Kosmos when the file is
 * unreadable, which is right for a board and wrong here: a registry that exists but cannot be
 * read, or names a Kosmos it drops, or a world folder whose name is not a safe id, means we do not
 * know what is somebody's work, and nothing in the data folder is deleted.
 *
 * Returns `{known: true, roots: [{dir, sentence}]}` or `{known: false, because}`.
 */
function keptRoots(o) {
  const base = o.dataDir;
  const file = worlds.registryPath(base);
  let namedIds = null;
  if (fs.existsSync(file)) {
    let obj;
    try { obj = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
      return { known: false, because: 'the list of your Kosmoses (' + file + ') could not be read (' + firstLine(e) + ')' };
    }
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.worlds)) {
      return { known: false, because: 'the list of your Kosmoses (' + file + ') is not in a shape Kosmos can read' };
    }
    namedIds = obj.worlds.map((w) => (w && typeof w.id === 'string' ? w.id : null));
  }
  const listed = worlds.listWorlds(base);
  if (namedIds && namedIds.some((id) => id === null || !listed.some((w) => w.id === id))) {
    return { known: false, because: 'the list of your Kosmoses (' + file + ') names a Kosmos Kosmos cannot read safely' };
  }
  const candidates = listed.slice();
  const worldsFolder = path.dirname(worlds.worldBaseDir(base, { id: 'kosmos' }));
  try {
    for (const entry of fs.readdirSync(worldsFolder, { withFileTypes: true })) {
      if (candidates.some((w) => w.id === entry.name)) continue;
      candidates.push({ id: entry.name, name: entry.name });
    }
  } catch (e) {
    if (!e || e.code !== 'ENOENT') return { known: false, because: 'the folder of your Kosmoses (' + worldsFolder + ') could not be read (' + firstLine(e) + ')' };
  }
  const roots = [];
  for (const world of candidates) {
    let overrides;
    try { overrides = worlds.envOverridesFor(base, world); } catch (e) {
      return { known: false, because: 'a Kosmos folder in ' + worldsFolder + ' has a name Kosmos cannot use safely (' + world.id + ')' };
    }
    const isDefault = world.id === worlds.DEFAULT_ID;
    const projects = isDefault ? o.projectsRoot : overrides.AGENT_WORKFORCE_PROJECTS;
    const workers = isDefault ? store.workersRootFor(o.env, o.home, 'win32') : overrides.AGENT_WORKFORCE_WORKERS;
    const whose = isDefault ? '' : ' for the Kosmos "' + (world.name || world.id) + '"';
    roots.push({ dir: projects, sentence: 'Your projects' + whose + ' were kept in ' + projects + '.' });
    roots.push({ dir: workers, sentence: 'Your agents\' working folders' + whose + ' were kept in ' + workers + '.' });
  }
  return { known: true, roots };
}

/**
 * Delete everything in `dir` except `keep` (folders), keeping each kept folder's parents. Links are
 * removed as links, or kept when they lead to a kept folder; they are never followed. Returns the
 * sentences for what could not be deleted.
 */
function deleteAllExcept(dir, keep, rm) {
  const kept = keep.map(onDisk);
  const holdsKept = (at) => { const d = onDisk(at); return kept.some((k) => k === d || k.startsWith(d + '\\') || k.startsWith(d + '/')); };
  const failures = [];
  const walk = (folder) => {
    let names;
    try { names = fs.readdirSync(folder); } catch (e) { failures.push(folder + ' (' + firstLine(e) + ')'); return true; }
    let keptHere = false;
    for (const name of names) {
      const at = path.join(folder, name);
      let st;
      try { st = fs.lstatSync(at); } catch { continue; }
      if (holdsKept(at) && (st.isSymbolicLink() || kept.includes(onDisk(at)))) { keptHere = true; continue; }
      if (st.isSymbolicLink()) {
        try { removeLink(at); } catch (e) { failures.push(at + ' (' + firstLine(e) + ')'); }
        continue;
      }
      if (st.isDirectory() && holdsKept(at)) {
        if (walk(at)) keptHere = true;
        else { try { fs.rmdirSync(at); } catch (e) { failures.push(at + ' (' + firstLine(e) + ')'); } }
        continue;
      }
      try { rm(at); } catch (e) { failures.push(at + ' (' + firstLine(e) + ')'); continue; }
      if (fs.existsSync(at)) failures.push(at + ' (it was still there after deleting it)');
    }
    return keptHere || failures.length > 0;
  };
  if (!walk(dir)) {
    try { fs.rmdirSync(dir); } catch (e) { failures.push(dir + ' (' + firstLine(e) + ')'); }
  }
  return failures;
}

/**
 * Remove Kosmos from this computer, except the folder it runs from and every Kosmos's projects and
 * agents' working folders.
 *
 * @param {object} opts
 *   deleteData            also empty the store (the person said yes to the second question)
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

  /* 1-6: the tasks. Commands are issued in order; whether each is gone is READ afterwards. */
  let everyTaskGone = false;
  const before = win32job.kosmosFolderTasks();
  if (!before.known) {
    left.push('the startup jobs in Task Scheduler\'s Kosmos folder, which we could not read (' + before.because + ')');
  } else {
    const tasks = before.paths.map(classifyTask);
    const board = tasks.find((t) => t.kind === 'board');
    const said = new Map();
    if (board) {
      win32board.disable();
      win32board.end();
    }
    for (const task of tasks.filter((t) => t.kind === 'agent')) {
      win32job.disable(task.name, task.worldId);
      win32job.end(task.name, task.worldId);
      const removed = win32job.remove(task.name, task.worldId);
      if (!removed.ok) said.set(task.path.toLowerCase(), removed.because);
    }
    if (board) {
      const removed = win32board.remove({ platform, env, home });
      if (!removed.ok) said.set(board.path.toLowerCase(), removed.because);
    }
    const after = win32job.kosmosFolderTasks();
    if (!after.known) {
      left.push('the startup jobs in Task Scheduler\'s Kosmos folder, which we could not read again to see they were gone (' + after.because + ')');
    } else {
      const remaining = new Set(after.paths.map((p) => p.toLowerCase()));
      for (const task of tasks) {
        if (task.kind === 'other' || remaining.has(task.path.toLowerCase())) continue;
        done.push('removed ' + (task.kind === 'board' ? 'the startup job for the Kosmos board (' + task.path + ')' : agentLabel(task)));
      }
      for (const task of after.paths.map(classifyTask)) {
        const why = said.get(task.path.toLowerCase());
        if (task.kind === 'other') {
          left.push('a task named ' + task.path + ' in Task Scheduler\'s Kosmos folder, which Kosmos does not recognise, so it was left in place. '
            + 'Remove it in Task Scheduler (Task Scheduler Library, then Kosmos) and remove Kosmos again');
        } else {
          left.push((task.kind === 'board' ? 'the startup job for the Kosmos board (' + task.path + ')' : agentLabel(task))
            + ', which is still in Task Scheduler' + (why ? ' (' + why + ')' : ''));
        }
      }
      everyTaskGone = after.paths.length === 0;
    }
  }

  /* 7-8: the folders, only once nothing registered still needs them. */
  let runtimeDir = null;
  let plainRuntimeDir = null;
  let dataDir = null;
  try {
    runtimeDir = path.win32.dirname(win32anchor.anchorDir('win32', home, env));
    plainRuntimeDir = path.win32.dirname(win32anchor.anchorDir('win32', home, { LOCALAPPDATA: env.LOCALAPPDATA }));
  } catch (e) { left.push('Kosmos\'s runtime folder in AppData\\Local, which we could not find (' + firstLine(e) + ')'); }
  try { dataDir = store.dataRootFor('win32', home, env); } catch (e) {
    if (o.deleteData) left.push('your agents\' chats and settings in AppData\\Roaming, which we could not find (' + firstLine(e) + ')');
  }
  const guards = { platform, home, bundleRoot: o.bundleRoot || null };
  const kept = dataDir ? keptRoots({ dataDir, env, home, projectsRoot }) : { known: false, because: 'we could not find your data folder' };
  const keptDirs = kept.known ? kept.roots.map((r) => r.dir) : [];

  if (runtimeDir) {
    const label = 'Kosmos\'s runtime folder';
    let refusal = null;
    if (!everyTaskGone) refusal = 'Kosmos startup jobs are still registered and need it';
    else if (onDisk(runtimeDir) !== onDisk(plainRuntimeDir)) refusal = 'it is not the usual ' + plainRuntimeDir + ', so Kosmos cannot be sure nothing else lives there';
    else if (dataDir && (onDiskInside(runtimeDir, dataDir) || onDiskInside(dataDir, runtimeDir))) refusal = 'your agents\' chats and settings are in the same place (' + dataDir + ')';
    else if (isLink(runtimeDir)) refusal = 'it is a link to another folder';
    /* Named Kosmoses keep their work under the DATA folder, which the runtime folder was just shown
       not to overlap, so an unreadable list still leaves the default Kosmos's own roots to check. */
    else if ((kept.known ? keptDirs : [projectsRoot, store.workersRootFor(env, home, 'win32')]).some((k) => onDiskInside(k, runtimeDir))) {
      refusal = 'some of your projects or working folders are inside it';
    }
    else refusal = folderRefusal(runtimeDir, { ...guards, leaf: win32anchor.APP });
    if (refusal) {
      left.push(label + ' (' + runtimeDir + '), kept because ' + refusal);
    } else if (!fs.existsSync(runtimeDir)) {
      done.push(label + ' (' + runtimeDir + ') was already gone');
    } else {
      try { rm(runtimeDir); } catch (e) { left.push(label + ' (' + runtimeDir + '), which could not be deleted (' + firstLine(e) + '), so some of it may be left'); }
      if (fs.existsSync(runtimeDir)) {
        if (!left.some((l) => l.startsWith(label + ' (' + runtimeDir))) left.push(label + ' (' + runtimeDir + '), which was still there after deleting it');
      } else {
        done.push('deleted ' + label + ' (' + runtimeDir + ')');
      }
    }
  }

  if (dataDir) {
    const label = 'your agents\' chats and settings';
    if (!o.deleteData) {
      notes.push('Your agents\' chats and settings were kept in ' + dataDir + '.');
    } else {
      let refusal = null;
      if (!everyTaskGone) refusal = 'Kosmos startup jobs are still registered and their agents use them';
      else if (!kept.known) refusal = kept.because;
      else if (isLink(dataDir)) refusal = 'it is a link to another folder';
      else refusal = folderRefusal(dataDir, { ...guards, leaf: store.APP });
      if (refusal) {
        left.push(label + ' (' + dataDir + '), kept because ' + refusal);
      } else if (!fs.existsSync(dataDir)) {
        done.push(label + ' (' + dataDir + ') were already gone');
      } else {
        const failures = deleteAllExcept(dataDir, keptDirs, rm);
        if (failures.length) left.push(label + ' in ' + dataDir + ', some of which could not be deleted: ' + failures.join('; '));
        else done.push('deleted ' + label + ' (' + dataDir + '), keeping your projects and working folders');
      }
    }
  }
  if (kept.known) {
    for (const root of kept.roots) if (fs.existsSync(root.dir)) notes.push(root.sentence);
  }

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
      wouldRemove: ['every task in Task Scheduler\'s Kosmos folder', runtimeDir].concat(a.deleteData ? [dataDir + ', except every Kosmos\'s projects and working folders'] : []),
      wouldKeep: (a.deleteData ? [] : [dataDir]).concat([a.root || 'the Kosmos folder this runs from', 'every Kosmos\'s projects and agents\' working folders']),
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

module.exports = { uninstall, cliMain, classifyTask, folderRefusal, keptRoots, reportText, FOLDER_DELETE_TRIES, FOLDER_DELETE_WAIT_MS };

/* Guarded on being the main module: requiring this file must never remove anything. */
if (require.main === module) {
  process.exitCode = cliMain(process.argv.slice(2));
}
