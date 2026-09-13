'use strict';
/**
 * `Kosmos.exe --uninstall`, the half that is already a fact in the engine
 * (win32-installer-native, installer audit W-27a).
 *
 * 🛑 WHY THIS IS NODE AND NOT THE LAUNCHER. Deleting the folder was the only "uninstall" a
 * Windows user had, and it left `Kosmos\board` and every `Kosmos\agent-*` task firing at each
 * sign-in, plus both data folders. Removing those needs the task names, the schtasks seam, the
 * anchor's folder, the store's folder, every Kosmos's project and working folders and the board's
 * identity probe, and every one of them is already derived once, in win32job, win32board,
 * win32anchor, store, worlds and win32handoff. A C# copy in the launcher would be a second
 * derivation of each (convention 5). So the launcher asks the questions and shows the answer, and
 * this module does the removing.
 *
 * 🔑 IN ORDER, EACH STEP WITH ITS OWN RESULT, NOTHING SILENTLY SKIPPED:
 *   1. ask the board's port who answers, on every address a board of this user could be on
 *      (win32handoff.probeBoardOnEveryAddress, the identity probe). A Kosmos
 *      board its logon task did NOT start (a double-clicked Kosmos.exe, say) is out of reach of
 *      every task command, and could re-register tasks and re-create folders behind the removal,
 *      so NOTHING is changed and the person is told to close Kosmos first;
 *   2. read every task in Task Scheduler's Kosmos folder from the machine's whole task list
 *      (win32job.kosmosFolderTasks, locale-independent);
 *   3. switch the board's task off and end the board. If a board was answering, wait for it to
 *      stop; one that still answers means no agent task is removed and no folder deleted, and the
 *      board task's switch is put back the way it was read;
 *   4. every agent task, of every Kosmos: disable, end, remove (win32job, by the world its own
 *      path names);
 *   5. a task in the folder that is neither is LEFT, and named, never guessed at;
 *   6. remove the board's task;
 *   7. read the whole task list AGAIN. Only a list that shows no Kosmos task at all, and a port
 *      where no Kosmos board answers, lets a folder go. Success is never inferred from what
 *      schtasks printed, which is translated;
 *   8. %LOCALAPPDATA%\Kosmos (the anchor's folder) goes only when it is exactly the plain
 *      `<LOCALAPPDATA>\Kosmos`, is neither the data folder nor overlaps it, and is not inside a
 *      projects or working folder;
 *   9. on the second yes, %APPDATA%\Kosmos (the store) is emptied EXCEPT every Kosmos's projects
 *      and working folders, which are kept with the folders above them, and each is named. When
 *      the list of Kosmoses cannot be read, or a kept folder IS the store or holds it, the store is
 *      not touched at all.
 * Every refusal and failure comes back as a sentence naming what was left behind.
 *
 * ⚠️ GATED TWICE (convention 3). `uninstall()` refuses without `liveExecutionAllowed`, and the
 * CLI below is a dry run unless `--yes`, which only the launcher passes, after the person
 * confirmed (engine/win32update.js's S2 CLI shape). Under both, win32job and win32board refuse
 * schtasks from any test process.
 *
 * The launcher's CLI:
 *     node app\engine\win32uninstall.js --uninstall --port <n> [--delete-data] [--root <bundle>] [--report <file>] [--yes]
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
   scanner can hold a handle a little longer. removeFolderWithRetries tries again itself (fs.rmSync's
   own maxRetries did not, measured): 20 tries 500ms apart is 10s. The wait for an ended board to stop
   answering is the same budget, polled at
   the same interval, because it is the same process leaving. */
const FOLDER_DELETE_TRIES = 20;
const FOLDER_DELETE_WAIT_MS = 500;
const BOARD_GONE_WAIT_MS = FOLDER_DELETE_TRIES * FOLDER_DELETE_WAIT_MS;

/* How many paths that would not delete are named one by one before the rest are counted. Enough
   for a person to act on the usual one or two locked files; a long list says the same thing. */
const MAX_NAMED_LEFTOVERS = 10;

/* Round 3, finding 3: once the folders went, how long before one last look for a Kosmos task or a board.
   It catches a board that registers its task, or comes up, within 3s of the folders going. A board that
   reaches its registration later is not seen (the plan's known limits). The value is from
   engine/win32handoff.js's measured ~2s from a board's boot to its hand-off, where it registers. */
const REREGISTER_SETTLE_MS = 3000;
const RESTART_THEN_REMOVE_AGAIN = 'Restart your computer, then remove Kosmos again.';

const REFUSED_WITHOUT_CONFIRM = 'Kosmos was not removed, because the removal was not confirmed';
const KOSMOS_STILL_OPEN = 'Kosmos is still open. Close Kosmos, then remove it again.';
const STARTUP_UNREADABLE = 'Kosmos could not check whether it starts when you sign in. Nothing was removed. Try again in a minute.';
const STARTUP_WOULD_NOT_SWITCH_OFF = 'Kosmos could not switch off the job that starts it when you sign in, so nothing was removed. Try again in a minute';

const USAGE = 'usage: node engine/win32uninstall.js --uninstall --port <n> [--delete-data] [--root <folder>] [--report <file>] [--yes]';

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
 * resolved spelling; always with one kind of separator, without a trailing one, and lower-cased,
 * because Windows paths are not case-sensitive.
 */
function onDisk(dir) {
  let at;
  try { at = fs.realpathSync.native(dir); } catch { at = path.resolve(String(dir)); }
  return at.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
}
/** Is `child` the same folder as `parent`, or inside it? */
function onDiskInside(child, parent) {
  const c = onDisk(child);
  const r = onDisk(parent);
  return c === r || c.startsWith(r + '/');
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

/* The errors Windows gives while another process still holds a file in the folder (a node.exe that
   /End has not finished ending, an editor): worth trying again. Anything else is final at once. */
const FOLDER_DELETE_RETRY_CODES = new Set(['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY']);

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * 🛑 THE RETRIES ARE HERE, NOT IN fs.rmSync (round 3, finding 4, measured). With a file in the folder held
 * open without sharing, `fs.rmSync`'s own `maxRetries` gave up at once: EPERM on the folder after 4ms
 * (Node 26, this box). So each try is one plain rmSync, and a held folder is tried FOLDER_DELETE_TRIES
 * times, FOLDER_DELETE_WAIT_MS apart, before its error is reported.
 */
function removeFolderWithRetries(dir, wait) {
  const pause = typeof wait === 'function' ? wait : sleepSync;
  for (let attempt = 1; ; attempt += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (e) {
      if (attempt >= FOLDER_DELETE_TRIES || !FOLDER_DELETE_RETRY_CODES.has(e && e.code)) throw e;
      pause(FOLDER_DELETE_WAIT_MS);
    }
  }
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
 * read, or names a Kosmos it drops, or a world FOLDER whose name is not a safe id, means we do not
 * know what is somebody's work, and nothing in the data folder is deleted. A plain FILE in the
 * worlds folder (Explorer's `desktop.ini`, say) is nobody's Kosmos and is not a reason to stop
 * (round 2, finding 6).
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
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
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
 * removed as links, or kept when they lead to a kept folder; they are never followed. Returns EVERY
 * path that could not be deleted (round 2, finding 7: one failure used to stop every folder above
 * it being tidied, unreported).
 */
function deleteAllExcept(dir, keep, rm) {
  const kept = keep.map(onDisk);
  const holdsKept = (at) => { const d = onDisk(at); return kept.some((k) => k === d || k.startsWith(d + '/')); };
  const failures = [];
  const walk = (folder) => {
    let names;
    try { names = fs.readdirSync(folder); } catch (e) { failures.push(folder + ' (' + firstLine(e) + ')'); return true; }
    let staysHere = false;
    for (const name of names) {
      const at = path.join(folder, name);
      let st;
      try { st = fs.lstatSync(at); } catch { continue; }
      if (holdsKept(at) && (st.isSymbolicLink() || kept.includes(onDisk(at)))) { staysHere = true; continue; }
      if (st.isSymbolicLink()) {
        try { removeLink(at); } catch (e) { failures.push(at + ' (' + firstLine(e) + ')'); staysHere = true; }
        continue;
      }
      if (st.isDirectory() && holdsKept(at)) {
        if (walk(at)) { staysHere = true; continue; }
        try { fs.rmdirSync(at); } catch (e) { failures.push(at + ' (' + firstLine(e) + ')'); staysHere = true; }
        continue;
      }
      try { rm(at); } catch (e) { failures.push(at + ' (' + firstLine(e) + ')'); staysHere = true; continue; }
      if (fs.existsSync(at)) { failures.push(at + ' (it was still there after deleting it)'); staysHere = true; }
    }
    return staysHere;
  };
  if (!walk(dir)) {
    try { fs.rmdirSync(dir); } catch (e) { failures.push(dir + ' (' + firstLine(e) + ')'); }
  }
  return failures;
}

/** Every leftover, named up to MAX_NAMED_LEFTOVERS and counted after that. */
function leftoverList(failures) {
  const named = failures.slice(0, MAX_NAMED_LEFTOVERS).join('; ');
  const more = failures.length - MAX_NAMED_LEFTOVERS;
  return more > 0 ? named + '; and ' + more + ' more' : named;
}

/**
 * Is a Kosmos board open on the port, and did its logon task start it?
 *   `{answering: false}`                          no board: every address refused, or only a page that is not Kosmos
 *   `{answering: true, byTask: true|false|null}`  a Kosmos board answered; byTask says whether its task started it
 *   `{answering: true, byTask: false, unanswered}` no answer, only a timeout or a failed look (`unanswered` is
 *                                                  the outcome): a board that may be open. The first look reads
 *                                                  the board task on that (stopForUnansweredFirstLook): a task
 *                                                  that reads running goes on to be switched off, ended and
 *                                                  waited for; every later look counts it as still open.
 * A probe that cannot run is a failed look.
 */
async function boardOnPort(port, o) {
  const handoff = require('./win32handoff');
  /* Round 4, finding 1: every address a board of this user could be on, not 127.0.0.1 alone. */
  const probe = typeof o.probe === 'function' ? o.probe : (p) => handoff.probeBoardOnEveryAddress(p, o.env || process.env, undefined, o.lookup);
  let answer;
  try { answer = await probe(port); } catch { return { answering: true, byTask: false, unanswered: handoff.PROBE_OUTCOMES.ERROR }; }
  /* Round 3, finding 1: only a refused connection proves nobody is there. A board that did not answer
     in time, or a look that failed, may be a busy Kosmos board, the very one this must not run under.
     win32handoff.boardMayBeOpen is the one reading of that, shared with the move. `unanswered` says why,
     for the first look (round 4, finding 3). */
  if (!answer || !answer.answering) {
    if (!handoff.boardMayBeOpen(answer)) return { answering: false };
    return { answering: true, byTask: false, unanswered: (answer && answer.outcome) || handoff.PROBE_OUTCOMES.ERROR };
  }
  /* Something that is not a Kosmos board (no identity, no started-by-task word) cannot register a
     task or re-create a folder; only a Kosmos board stops the removal. */
  if (!answer.identity && typeof answer.startedByTask !== 'boolean') return { answering: false };
  if (typeof answer.startedByTask === 'boolean') return { answering: true, byTask: answer.startedByTask };
  /* A board older than the started-by-task word: Task Scheduler's own running state, true or unknown. */
  let running = null;
  try { running = win32board.status().running; } catch { running = null; }
  return { answering: true, byTask: running === true ? true : null };
}

function sleeperFor(o) {
  return typeof o.sleep === 'function' ? o.sleep : (ms) => new Promise((r) => setTimeout(r, ms));
}

/* Waits through answers AND timeouts: a board that stops answering in time is not a board that went.
   Bounded by the clock as well as by the count, because a probe that times out takes PROBE_TIMEOUT_MS
   of its own on top of each wait. */
async function waitForBoardToGo(port, o) {
  const sleep = sleeperFor(o);
  const now = typeof o.now === 'function' ? o.now : Date.now;
  const started = now();
  for (let waited = 0; ; waited += FOLDER_DELETE_WAIT_MS) {
    if (!(await boardOnPort(port, o)).answering) return true;
    if (waited >= BOARD_GONE_WAIT_MS || now() - started >= BOARD_GONE_WAIT_MS) return false;
    await sleep(FOLDER_DELETE_WAIT_MS);
  }
}

const TURN_SWITCH_BACK_ON = 'Turn "Start Kosmos when I sign in to Windows" back on in Settings';
const SWITCHED_BACK_ON = 'Its startup job was switched back on, as it was.';

/**
 * Round 3, finding 2: the board task was switched off for the removal. When the removal leaves that task
 * behind, it goes back to the position it was read in: on only if it was on. Returns the words to add to
 * the leftover's sentence when it could not be put back ('' otherwise).
 */
function putBoardSwitchBack(boardSwitch, notes) {
  if (!boardSwitch || boardSwitch.enabled !== true) return '';
  const back = win32board.enable();
  if (back.ok) { notes.push(SWITCHED_BACK_ON); return ''; }
  return '. It is switched off now (' + back.because + '). ' + TURN_SWITCH_BACK_ON;
}

/**
 * Round 4, finding 3: the first look got no answer, only a timeout or a failed look. Returns the stop, or
 * null to go on as with the task's own board.
 *   - the board task reads RUNNING: the usual busy board its task started. Go on to switch it off, end it
 *     and wait for it, which stops with the switch put back if it does not go;
 *   - the task cannot be read: round 3's stop, "Kosmos is still open";
 *   - the task is not proven running, and the look timed out: something accepts and never answers, which
 *     may be a hand-started board, "Kosmos is still open";
 *   - the task is not proven running, and the look failed: win32handoff.cannotTellIfOpenSentence, which
 *     names another program only when the task is known not to be registered (round 5, finding 5). A
 *     connection that was reset is NOT taken as "not Kosmos", because a board mid-restart resets
 *     connections too.
 */
function stopForUnansweredFirstLook(outcome, port) {
  const handoff = require('./win32handoff');
  let task = null;
  try { task = win32board.status(); } catch { task = null; }
  if (!task || !task.known) return stillOpen();
  if (task.running === true) return null;
  if (outcome === handoff.PROBE_OUTCOMES.TIMED_OUT) return stillOpen();
  return stoppedUnchanged(handoff.cannotTellIfOpenSentence(port, task) + ' ' + RESTART_THEN_REMOVE_AGAIN);
}

/* A stop before anything was changed, saying why. */
function stoppedUnchanged(sentence) {
  return { ok: false, refused: true, done: [], left: [oneLine(sentence)], notes: [] };
}

function stillOpen(extraLeft, notes) {
  return { ok: false, refused: true, stillOpen: true, done: [], left: [KOSMOS_STILL_OPEN].concat(extraLeft || []).map(oneLine), notes: (notes || []).map(oneLine) };
}

/**
 * Remove Kosmos from this computer, except the folder it runs from and every Kosmos's projects and
 * agents' working folders.
 *
 * @param {object} opts
 *   port                  the board's port, as the launcher derives it; without one nothing is removed
 *   deleteData            also empty the store (the person said yes to the second question)
 *   bundleRoot            the Kosmos folder running this, which is never deleted from here
 *   liveExecutionAllowed  () => boolean; without it this refuses and changes nothing
 *   platform, env, home, projectsRoot, removeFolder, probe, sleep   seams, with real defaults
 * @returns {Promise<{ok: boolean, refused?: boolean, stillOpen?: boolean, done: string[], left: string[], notes: string[]}>}
 *   `left` names everything still on the computer that the removal was meant to take away.
 */
async function uninstall(opts) {
  const o = opts || {};
  const allowed = typeof o.liveExecutionAllowed === 'function' ? o.liveExecutionAllowed() : liveExec.liveExecutionAllowed();
  if (!allowed) return { ok: false, refused: true, done: [], left: [REFUSED_WITHOUT_CONFIRM], notes: [] };
  const platform = o.platform || process.platform;
  if (platform !== 'win32') {
    return { ok: false, refused: true, done: [], left: ['Kosmos removes itself this way only on Windows'], notes: [] };
  }
  const port = Number(o.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return { ok: false, refused: true, done: [], left: ['Kosmos was not removed, because it could not tell which port Kosmos uses, so it could not check whether Kosmos is still open'], notes: [] };
  }
  const env = worlds.preWorldEnv(o.env || process.env);
  const home = o.home || env.AGENT_WORKFORCE_HOME || os.homedir();
  const rm = typeof o.removeFolder === 'function' ? o.removeFolder : removeFolderWithRetries;
  const projectsRoot = o.projectsRoot || require('./projects').projectsRoot();
  const done = [];
  const left = [];
  const notes = [];

  /* 1: a Kosmos board no task command can stop means nothing is changed at all. */
  const firstLook = await boardOnPort(port, o);
  if (firstLook.unanswered) {
    const stop = stopForUnansweredFirstLook(firstLook.unanswered, port);
    if (stop) return stop;
  } else if (firstLook.answering && firstLook.byTask !== true) {
    return stillOpen();
  }

  /* 2-7: the tasks. Commands are issued in order; whether each is gone is READ afterwards. */
  let everyTaskGone = false;
  const before = win32job.kosmosFolderTasks();
  if (!before.known) {
    left.push('the startup jobs in Task Scheduler\'s Kosmos folder, which we could not read (' + before.because + ')');
  } else {
    const tasks = before.paths.map(classifyTask);
    const board = tasks.find((t) => t.kind === 'board');
    const said = new Map();
    let boardSwitch = null;
    if (board) {
      /* Round 3, finding 2: fail closed BEFORE changing anything. A switch that cannot be read could
         not be put back if the removal stops, and a task that will not switch off keeps bringing the
         board back behind the removal. */
      try { boardSwitch = win32board.status(); } catch { boardSwitch = null; }
      if (!boardSwitch || !boardSwitch.known || !boardSwitch.registered) return stoppedUnchanged(STARTUP_UNREADABLE);
      const switchedOff = win32board.disable();
      if (!switchedOff.ok) return stoppedUnchanged(STARTUP_WOULD_NOT_SWITCH_OFF + ' (' + switchedOff.because + ').');
      win32board.end();
    }
    if (firstLook.answering && !(await waitForBoardToGo(port, o))) {
      /* The board that answered did not go. Nothing else is touched, and the one thing this changed,
         the board task's switch, goes back to the position it was read in. */
      if (board && boardSwitch && boardSwitch.known && boardSwitch.enabled === true) {
        const back = win32board.enable();
        if (!back.ok) return stillOpen(['the startup job for the Kosmos board, which is switched off now (' + back.because + '). ' + TURN_SWITCH_BACK_ON]);
        return stillOpen([], [SWITCHED_BACK_ON]);
      }
      return stillOpen();
    }
    for (const task of tasks.filter((t) => t.kind === 'agent')) {
      win32job.disable(task.name, task.worldId);
      win32job.end(task.name, task.worldId);
      const removed = win32job.remove(task.name, task.worldId);
      if (!removed.ok) said.set(task.path.toLowerCase(), removed.because);
    }
    let boardRemoval = null;
    if (board) {
      boardRemoval = win32board.remove({ platform, env, home });
      if (!boardRemoval.ok) said.set(board.path.toLowerCase(), boardRemoval.because);
    }
    const after = win32job.kosmosFolderTasks();
    if (!after.known) {
      left.push('the startup jobs in Task Scheduler\'s Kosmos folder, which we could not read again to see they were gone (' + after.because + ')');
      /* Round 4, finding 2: a board job Windows would not remove is still there, switched off by this
         removal, even though the list cannot show it. Its switch goes back as it was read. */
      if (board && !boardRemoval.ok) {
        left.push('the startup job for the Kosmos board (' + board.path + '), which Windows would not remove (' + boardRemoval.because + ')'
          + putBoardSwitchBack(boardSwitch, notes));
      }
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
            + ', which is still in Task Scheduler' + (why ? ' (' + why + ')' : '')
            + (task.kind === 'board' ? putBoardSwitchBack(boardSwitch, notes) : ''));
        }
      }
      everyTaskGone = after.paths.length === 0;
    }
  }

  /* A board that started while the tasks went (or answers now for any reason) keeps every folder. */
  let boardGone = true;
  if (everyTaskGone && (await boardOnPort(port, o)).answering) {
    boardGone = false;
    left.push(KOSMOS_STILL_OPEN);
  }

  /* 8-9: the folders, only once nothing registered, and no board, still needs them. */
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
  const defaultRoots = [projectsRoot, store.workersRootFor(env, home, 'win32')];
  /* A kept folder that IS this folder, or holds it (round 2, finding 5). */
  const keptHolding = (dir, roots) => roots.find((k) => onDiskInside(dir, k));

  if (runtimeDir) {
    const label = 'Kosmos\'s runtime folder';
    const guardDirs = kept.known ? keptDirs : defaultRoots;
    let refusal = null;
    if (!everyTaskGone) refusal = 'Kosmos startup jobs are still registered and need it';
    else if (!boardGone) refusal = 'Kosmos is still open';
    else if (onDisk(runtimeDir) !== onDisk(plainRuntimeDir)) refusal = 'it is not the usual ' + plainRuntimeDir + ', so Kosmos cannot be sure nothing else lives there';
    else if (dataDir && (onDiskInside(runtimeDir, dataDir) || onDiskInside(dataDir, runtimeDir))) refusal = 'your agents\' chats and settings are in the same place (' + dataDir + ')';
    else if (isLink(runtimeDir)) refusal = 'it is a link to another folder';
    else if (keptHolding(runtimeDir, guardDirs)) refusal = 'it is inside your projects or working folders (' + keptHolding(runtimeDir, guardDirs) + ')';
    else if (guardDirs.some((k) => onDiskInside(k, runtimeDir))) refusal = 'some of your projects or working folders are inside it';
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
      else if (!boardGone) refusal = 'Kosmos is still open';
      else if (!kept.known) refusal = kept.because;
      else if (isLink(dataDir)) refusal = 'it is a link to another folder';
      else if (keptHolding(dataDir, keptDirs)) refusal = 'it is one of your projects or working folders, or inside one (' + keptHolding(dataDir, keptDirs) + ')';
      else refusal = folderRefusal(dataDir, { ...guards, leaf: store.APP });
      if (refusal) {
        left.push(label + ' (' + dataDir + '), kept because ' + refusal);
      } else if (!fs.existsSync(dataDir)) {
        done.push(label + ' (' + dataDir + ') were already gone');
      } else {
        const failures = deleteAllExcept(dataDir, keptDirs, rm);
        if (failures.length) left.push(label + ' in ' + dataDir + ', ' + failures.length + ' of which could not be deleted: ' + leftoverList(failures));
        else done.push('deleted ' + label + ' (' + dataDir + '), keeping your projects and working folders');
      }
    }
  }
  if (kept.known) {
    for (const root of kept.roots) if (fs.existsSync(root.dir)) notes.push(root.sentence);
  }

  /* Round 3, finding 3: a board that was still starting as the removal began can register its task
     again, or come up, just after everything went. So once everything went, wait REREGISTER_SETTLE_MS
     and look once more. Anything found is named, and the result is not ok, so the launcher keeps the
     Start menu entry and the Apps entry for removing Kosmos again. */
  if (everyTaskGone && boardGone) {
    await sleeperFor(o)(REREGISTER_SETTLE_MS);
    const later = win32job.kosmosFolderTasks();
    if (!later.known) {
      left.push('the startup jobs in Task Scheduler\'s Kosmos folder, which we could not read a last time to see nothing came back (' + later.because + ')');
    } else {
      for (const task of later.paths.map(classifyTask)) {
        const label = task.kind === 'agent' ? agentLabel(task)
          : task.kind === 'board' ? 'the startup job for the Kosmos board (' + task.path + ')'
            : 'a task named ' + task.path + ' in Task Scheduler\'s Kosmos folder';
        left.push(label + ', which was registered again while Kosmos was being removed. Remove Kosmos again');
      }
    }
    if ((await boardOnPort(port, o)).answering) left.push(KOSMOS_STILL_OPEN);
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
  const a = { uninstall: false, deleteData: false, yes: false, root: null, report: null, port: null, unknown: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--uninstall') a.uninstall = true;
    else if (arg === '--delete-data') a.deleteData = true;
    else if (arg === '--yes') a.yes = true;
    else if (arg === '--root' || arg === '--report' || arg === '--port') { a[arg.slice(2)] = argv[i + 1] || null; i += 1; }
    else a.unknown = arg;
  }
  return a;
}

/**
 * `--yes` is the launcher's word that the person confirmed, and it stands in for
 * allowLiveExecution(), which only server.js's real start may call. Without it this prints what
 * it would remove and exits 2, having changed nothing.
 */
async function cliMain(argv, deps) {
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
  const result = await (d.uninstall || uninstall)({ deleteData: a.deleteData, bundleRoot: a.root, port: a.port, liveExecutionAllowed: () => true });
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

module.exports = {
  uninstall, cliMain, classifyTask, folderRefusal, keptRoots, reportText,
  FOLDER_DELETE_TRIES, FOLDER_DELETE_WAIT_MS, BOARD_GONE_WAIT_MS, MAX_NAMED_LEFTOVERS, REREGISTER_SETTLE_MS,
  KOSMOS_STILL_OPEN, STARTUP_UNREADABLE, STARTUP_WOULD_NOT_SWITCH_OFF,
};

/* Guarded on being the main module: requiring this file must never remove anything. */
if (require.main === module) {
  cliMain(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (e) => { process.stderr.write(String((e && e.stack) || e) + '\n'); process.exitCode = 1; },
  );
}
