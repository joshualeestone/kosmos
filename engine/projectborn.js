'use strict';

/**
 * #7185: whether a row stored under a project id was written by an EARLIER project of that name.
 *
 * A project's id comes from its name, so a project deleted and made again under the same name has the same id, and
 * every store keyed by that id (a task's conversation in engine/taskchat.js, the room's rows in engine/messages.js)
 * still holds the deleted project's rows. They stay on disk: nothing here deletes a person's words, and an owner may
 * want them back. They are simply not the new project's, and a row stamped before the project's createdAt cannot be.
 *
 * The projects file is read once and kept until the file itself changes (path, inode, size, mtime, ctime), because the readers
 * call this per row and per task.
 *
 * Fails OPEN (#7367): when the projects file exists but cannot be read or parsed (a crash can leave it torn or all
 * NUL), no row counts as earlier, the same as before #7185. Failing closed hid every room's rows and refused every room
 * post, so one damaged file silenced every agent; the Projects page is where that file's fault is shown
 * (projects.readAll throws for it). The cost: while the file is damaged, a deleted-and-re-made project's old rows show
 * again. ok is false then, so a reader that KEEPS what it worked out (engine/receipt.js) or ACTS on old rows
 * (messages.sweepUnanswered, which would nudge about a deleted project's ask) does nothing until the file reads. Every
 * such reader (receipt, sweepUnanswered/unanswered, undo.plan, holdstale.owed and its timer) checks before and after
 * its reads; the list is kept in .claude/plans/failopen-projects-7367.md. A project
 * id with no record, or a record with no valid createdAt, keeps every row (no stamp to compare with).
 */

const fs = require('node:fs');

/* The stores key a project by store.safeKey(id) (taskchat, taskseen), so the stamps are looked up the same way: an id
   spelled another way still finds its project's createdAt. */
function keyOf(id) {
  try { return require('./store').safeKey(String(id)); } catch { return String(id); }
}

let CACHE = null;
const NO_PROJECTS = { ok: true, born: new Map() };   // one object, so a caller's work against it is kept
const UNREADABLE = { ok: false };                     // the same, while the projects file cannot be read
const UNREADABLE_KEEP_MS = 5000;                      // #7367: how long a failed read is kept before it is tried again

function births() {
  const projects = require('./projects');
  const f = projects.file();
  let st;
  try {
    st = fs.statSync(f);
  } catch (err) {
    return err && err.code === 'ENOENT' ? NO_PROJECTS : UNREADABLE;
  }
  if (CACHE && CACHE.file === f && CACHE.ino === st.ino && CACHE.size === st.size && CACHE.mtimeMs === st.mtimeMs && CACHE.ctimeMs === st.ctimeMs
    && !(CACHE.until && Date.now() >= CACHE.until)) return CACHE.value;
  let all;
  try {
    all = projects.readAll();
  } catch {
    /* #7367: kept against the file's stat, so a damaged file is not re-read on every room read, but only for
       UNREADABLE_KEEP_MS: a passing read error on a good file (a scanner holding it) must not stand until the file next
       changes, showing a re-made project's predecessor rows with nothing saying so. */
    CACHE = { file: f, ino: st.ino, size: st.size, mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs, value: UNREADABLE, until: Date.now() + UNREADABLE_KEEP_MS };
    return UNREADABLE;
  }
  const born = new Map();
  for (const p of Array.isArray(all) ? all : []) {
    const t = p ? Date.parse(p.createdAt) : NaN;
    if (p && typeof p.id === 'string' && Number.isFinite(t)) born.set(keyOf(p.id), t);
  }
  const value = { ok: true, born };
  CACHE = { file: f, ino: st.ino, size: st.size, mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs, value };
  return value;
}

/* The stamps, read ONCE, for many rows: { ok, earlier(projectId, at), stamp }. earlier() is true when a row stamped
   `at` under `projectId` belongs to an earlier project of that name (leave it out); a row with no readable `at` under
   a project that has a createdAt is left out too. ok is false when the projects
   file exists but cannot be read; then earlier() is false for every row (#7367: fails open, see the top). stamp is the
   same object for as long as the projects file is unchanged, so a caller can keep work done against it. */
function snapshot() {
  const b = births();
  const earlier = (projectId, at) => {
    if (!b.ok) return false;
    const t = b.born.get(keyOf(projectId));
    if (t == null) return false;
    const a = Date.parse(at);
    return !(Number.isFinite(a) && a >= t);
  };
  return { ok: b.ok, earlier, stamp: b };
}

function olderThanProject() {
  return snapshot().earlier;
}

module.exports = { snapshot, olderThanProject };
