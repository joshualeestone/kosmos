'use strict';
/**
 * Delete what is left of an agent (#514).
 *
 * `remove.js`'s first rule is that nothing on disk is ever deleted, and that
 * rule is what makes a removal reversible. It is also why a removed agent's
 * name stays taken: `create.js` refuses a name whose folder or job file still
 * exists. So a person who removed an agent and wants the name back has,
 * until this module, no way through the product. This is the separate verb
 * that frees the name, kept out of `remove.js` on purpose so the never-delete
 * rule there stays true to the letter.
 *
 * THE TWO QUESTIONS (the product's own rule for anything you cannot take
 * back): can the person undo it themselves, and before anyone acted on it?
 * A folder that goes to the Mac's Trash answers yes to both, so that is what
 * this does whenever it can: the folder and the job file are MOVED into
 * `~/.Trash` under a dated name, where Finder shows them and the person can
 * drag them back. Only when the Trash cannot take them (a different volume,
 * or no Trash directory) are they deleted for good, and the plan says which
 * BEFORE the click, so the confirmation is never lighter than the act.
 *
 * What it touches, and nothing else: `<WORKERS_DIR>/<name>` and
 * `<AGENTS_DIR>/<label>.plist`, both resolved by `create.js` (one definition
 * of where an agent lives). A folder that is a symlink, or that resolves
 * outside WORKERS_DIR, is refused rather than followed. A name with a live
 * session is refused: this is for leftovers, and a running agent is not one.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const create = require('./create');
const remove = require('./remove');
const status = require('./status');

const OUTCOME = { DELETED: 'deleted', REFUSED: 'refused', PARTIAL: 'partial' };
const HOME = process.env.AGENT_WORKFORCE_HOME || os.homedir();
const TRASH = () => process.env.AGENT_WORKFORCE_TRASH || path.join(HOME, '.Trash');
/* A walk that stops counting past this many entries: the numbers are for a
   sentence, and "more than 20,000 files" is the honest form past it. */
const WALK_CAP = 20000;

/* Test seam for the one thing this runs: `launchctl bootout` before the job
   file goes, so launchd does not keep a job whose file has vanished. */
let runner = null;
function setRunner(fn) { runner = typeof fn === 'function' ? fn : null; }
function run(file, args) {
  if (runner) return runner(file, args);
  try {
    return { ok: true, stdout: execFileSync(file, args, { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (err) {
    return { ok: false, code: err && err.status, stderr: String(err && err.stderr || '') };
  }
}

function insideDir(child, parent) {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Count what a folder holds: files, bytes, newest change. Never follows
    symlinks. Capped, and says so. */
function measure(dir) {
  let files = 0;
  let bytes = 0;
  let newest = 0;
  let capped = false;
  let git = false;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (files >= WALK_CAP) { capped = true; break; }
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) { files += 1; continue; }
      if (e.isDirectory()) {
        if (d === dir && e.name === '.git') git = true;
        stack.push(p);
        continue;
      }
      files += 1;
      try {
        const st = fs.statSync(p);
        bytes += st.size;
        if (st.mtimeMs > newest) newest = st.mtimeMs;
      } catch { /* counted, not sized */ }
    }
    if (capped) break;
  }
  return { files, bytes, newest: newest ? Math.floor(newest / 1000) : 0, capped, git };
}

function sizeWords(bytes) {
  if (bytes < 1024) return bytes + ' bytes';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '') + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1).replace(/\.0$/, '') + ' GB';
}
function agoWords(unix, now) {
  if (!unix) return '';
  const s = Math.max(0, Math.floor((now || Date.now()) / 1000 - unix));
  if (s < 60) return 'a moment ago';
  const m = Math.floor(s / 60);
  if (m < 60) return m + (m === 1 ? ' minute ago' : ' minutes ago');
  const h = Math.floor(m / 60);
  if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 30) return d + ' days ago';
  return 'on ' + new Date(unix * 1000).toISOString().slice(0, 10);
}
function filesWords(m) {
  const n = m.capped ? 'more than ' + m.files.toLocaleString('en-US') : m.files.toLocaleString('en-US');
  return n + (m.files === 1 && !m.capped ? ' file' : ' files');
}

/** Whether the Trash can take a path: it exists, and it is on the same
    volume, so a rename works and nothing is copied-then-deleted. */
function trashCanTake(p) {
  try {
    const t = fs.statSync(TRASH());
    if (!t.isDirectory()) return false;
    return fs.statSync(p).dev === t.dev;
  } catch { return false; }
}

/**
 * What deleting would do, in the engine's words. `ok: false` with a `because`
 * when it must not be offered. The confirmation paints THESE words, never its
 * own, so the description of the act cannot drift from the act.
 */
function plan(name, opts) {
  const now = (opts && opts.now) || Date.now();
  const clean = create.cleanName(name);
  const unsafe = remove.unsafeToActOn(clean);
  if (unsafe) return { ok: false, because: unsafe };
  const shown = status.readIdentity(clean).displayName || clean;

  let live = null;
  try { live = status.paneRoster().find((c) => c.sessionName === clean) || null; }
  catch {
    return { ok: false, because: `we could not check whether ${shown} is running right now, so we have not offered to delete anything. Try again in a moment.` };
  }
  if (live) return { ok: false, because: `${shown} is running, so there is nothing left over to delete. Remove it first if you want it gone.` };

  const folderPath = create.workerDir(clean);
  const jobPath = create.plistPath(clean);
  let folder = null;
  let lst = null;
  try { lst = fs.lstatSync(folderPath); } catch { lst = null; }
  if (lst) {
    if (lst.isSymbolicLink()) {
      return { ok: false, because: `${shown}'s folder is a link to somewhere else, so Kosmos will not delete it. Remove the link yourself if you are sure.` };
    }
    if (!lst.isDirectory() || !insideDir(fs.realpathSync(folderPath), fs.realpathSync(create.WORKERS))) {
      return { ok: false, because: `${shown}'s folder is not where Kosmos keeps agents, so Kosmos will not delete it.` };
    }
    const m = measure(folderPath);
    folder = { path: folderPath, ...m, trash: trashCanTake(folderPath) };
  }
  const job = fs.existsSync(jobPath) ? { path: jobPath, label: create.serviceLabel(clean), trash: trashCanTake(jobPath) } : null;
  if (!folder && !job) {
    return { ok: false, because: `nothing of ${shown} is left on this computer, so there is nothing to delete. If the name is still refused, something else holds it.` };
  }

  /* One mode for the whole act, so the sentence is one sentence: to the
     Trash only if EVERYTHING can go there. */
  const toTrash = (!folder || folder.trash) && (!job || job.trash);
  const loses = [];
  if (folder) {
    const what = filesWords(folder) + (folder.files ? ', ' + sizeWords(folder.bytes) : '');
    const when = folder.newest ? ', last changed ' + agoWords(folder.newest, now) : '';
    loses.push(`Its folder: ${what}${when}` + (folder.git ? ', including a git repository' : ''));
  }
  if (job) loses.push('Its startup job, so nothing tries to start it again');
  const question = `Delete what is left of ${shown}?`;
  const reassurance = toTrash
    ? `Everything goes to the Trash, where you can get it back until you empty it. After this, the name ${shown} is free for a new agent.`
    : `This cannot be undone: the Trash cannot take these files, so they will be deleted for good. After this, the name ${shown} is free for a new agent.`;
  const verb = folder
    ? (toTrash ? `Move ${filesWords(folder)} to the Trash` : `Delete ${filesWords(folder)} for good`)
    : (toTrash ? 'Move the startup job to the Trash' : 'Delete the startup job for good');
  const hint = folder
    ? `${shown}'s folder is still on this computer (${filesWords(folder)}${folder.newest ? ', last changed ' + agoWords(folder.newest, now) : ''}), and the name stays taken until it is gone.`
    : `A startup job for ${shown} is still on this computer, and the name stays taken until it is gone.`;
  return {
    ok: true,
    name: clean,
    shown,
    toTrash,
    /* Typing the name is asked only when nothing can bring the files back. */
    typeToConfirm: toTrash ? null : shown,
    folder: folder && { path: folder.path, files: folder.files, bytes: folder.bytes, newest: folder.newest, capped: folder.capped, git: folder.git },
    job: job && { path: job.path, label: job.label },
    question,
    reassurance,
    loses,
    verb,
    hint,
  };
}

function trashName(p) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return path.join(TRASH(), `${path.basename(p)} (Kosmos ${stamp})`);
}

/** The act. Re-plans first, so nothing is deleted that the plan would not
    have offered a moment ago. `typed` must match when the plan asks for it. */
function del(name, opts) {
  const p = plan(name);
  if (!p.ok) return { outcome: OUTCOME.REFUSED, because: p.because };
  if (p.typeToConfirm && String((opts && opts.typed) || '').trim() !== p.typeToConfirm) {
    return { outcome: OUTCOME.REFUSED, because: `type ${p.typeToConfirm} to confirm; nothing was deleted` };
  }
  const steps = [];
  const gone = [];
  const stuck = [];
  const move = (from, what) => {
    try {
      if (p.toTrash) {
        fs.mkdirSync(TRASH(), { recursive: true });
        fs.renameSync(from, trashName(from));
      } else {
        fs.rmSync(from, { recursive: true, force: true });
      }
      if (fs.existsSync(from)) throw new Error('still there');
      gone.push(what);
      steps.push({ step: what, ok: true });
    } catch (err) {
      stuck.push(what);
      steps.push({ step: what, ok: false, because: String(err && err.message || err) });
    }
  };
  if (p.job) {
    /* Stop the job first, so launchd does not hold a job whose file has
       gone. Best effort: a job that was never loaded answers "not found",
       which is the state we want. */
    run('launchctl', ['bootout', `gui/${process.getuid ? process.getuid() : 501}/${p.job.label}`]);
    move(p.job.path, 'its startup job');
  }
  if (p.folder) move(p.folder.path, 'its folder');
  /* The removed-list record, if any, is what keeps a name hidden on the
     board; with the files gone it has nothing to point at. */
  try { remove.forget(p.name); } catch { /* the record is inert without files */ }
  if (stuck.length) {
    return {
      outcome: gone.length ? OUTCOME.PARTIAL : OUTCOME.REFUSED,
      because: `we could not ${p.toTrash ? 'move' : 'delete'} ${stuck.join(' or ')}. ` + (gone.length ? `${gone.join(' and ')} ${gone.length === 1 ? 'is' : 'are'} gone.` : 'Nothing was changed.'),
      steps,
    };
  }
  return {
    outcome: OUTCOME.DELETED,
    toTrash: p.toTrash,
    shown: p.shown,
    said: p.toTrash
      ? `${p.shown}'s files are in the Trash. The name is free.`
      : `${p.shown}'s files are deleted. The name is free.`,
    steps,
  };
}

module.exports = { OUTCOME, plan, del, setRunner, measure, TRASH };
