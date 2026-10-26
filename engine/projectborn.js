'use strict';

/**
 * #7185: whether a row stored under a project id was written by an EARLIER project of that name.
 *
 * A project's id comes from its name, so a project deleted and made again under the same name has the same id, and
 * every store keyed by that id (a task's conversation in engine/taskchat.js, the room's rows in engine/messages.js)
 * still holds the deleted project's rows. They stay on disk: nothing here deletes a person's words, and an owner may
 * want them back. They are simply not the new project's, and a row stamped before the project's createdAt cannot be.
 *
 * The projects file is read once and kept until the file itself changes (inode, size, mtime), because the readers
 * call this per row and per task.
 *
 * Fails CLOSED: when the projects file exists but cannot be read, every project-tagged row counts as earlier, so a
 * failure hides rows rather than showing another project's words. A project id with no record, or a record with no
 * valid createdAt, keeps every row (no stamp to compare with, the same as before #7185).
 */

const fs = require('node:fs');

let CACHE = null;

function births() {
  const projects = require('./projects');
  let st;
  try {
    st = fs.statSync(projects.file());
  } catch (err) {
    return err && err.code === 'ENOENT' ? { ok: true, born: new Map() } : { ok: false };
  }
  if (CACHE && CACHE.ino === st.ino && CACHE.size === st.size && CACHE.mtimeMs === st.mtimeMs) return CACHE.value;
  let all;
  try {
    all = projects.readAll();
  } catch {
    return { ok: false };
  }
  const born = new Map();
  for (const p of Array.isArray(all) ? all : []) {
    const t = p ? Date.parse(p.createdAt) : NaN;
    if (p && typeof p.id === 'string' && Number.isFinite(t)) born.set(p.id, t);
  }
  const value = { ok: true, born };
  CACHE = { ino: st.ino, size: st.size, mtimeMs: st.mtimeMs, value };
  return value;
}

/* A test for many rows at once, the stamps read ONCE: earlier(projectId, at) is true when a row stamped `at` under
   `projectId` belongs to an earlier project of that name (leave it out). */
function olderThanProject() {
  const b = births();
  return (projectId, at) => {
    if (!b.ok) return true;
    const t = b.born.get(String(projectId));
    if (t == null) return false;
    const a = Date.parse(at);
    return !(Number.isFinite(a) && a >= t);
  };
}

module.exports = { olderThanProject };
