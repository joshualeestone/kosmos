'use strict';

/**
 * #5812: which agent last changed a project file.
 *
 * Claude Code's PreToolUse hook sends the path of every Edit, Write, MultiEdit and NotebookEdit to the board (the
 * /api/undo/keep route) just before the edit. For a path inside a project's folder, noteWrite records which agent was
 * about to write it, per project, under the file's project-relative name (the name listFiles gives it). writerOf then
 * names that agent only when the file's last change came within WRITE_WINDOW_MS after the record (or SLACK_MS before
 * it). The record is made before the edit, so it is a heuristic: see the plan's weakest premise.
 *
 * One small JSON file per project under the store. Never throws.
 */

const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

const WRITE_WINDOW_MS = 2 * 60 * 1000;
const SLACK_MS = 2000;
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 2000;
const REWRITE_MS = 5000;
const ROOTS_TTL_MS = 10 * 1000;

function dir() { return path.join(store.ROOT, 'filewriters'); }
function fileFor(projectId) { return path.join(dir(), store.safeKey(String(projectId)) + '.json'); }

function readRecord(projectId) {
  try {
    const got = JSON.parse(fs.readFileSync(fileFor(projectId), 'utf8'));
    // No prototype: a file named __proto__ or constructor is an ordinary key here.
    return got && typeof got === 'object' && !Array.isArray(got) ? Object.assign(Object.create(null), got) : Object.create(null);
  } catch { return Object.create(null); }
}

/* The path with its links resolved, so ~/Kosmos/Projects reached through a link matches. The file, and even its
   folders, may not exist yet (a Write that creates them), so the deepest part that exists is resolved and the rest is
   joined back on. */
function resolved(p) {
  const abs = path.resolve(p);
  let head = abs;
  const tail = [];
  while (true) {
    try { return path.join(fs.realpathSync.native(head), ...tail); } catch { /* not there yet: one level up */ }
    const up = path.dirname(head);
    if (up === head) return abs;
    tail.unshift(path.basename(head));
    head = up;
  }
}

/* The projects' folders, resolved, kept for ROOTS_TTL_MS: noteWrite runs on every edit an agent makes. */
let rootsCache = { at: 0, roots: [] };
function projectRoots(now) {
  if (now - rootsCache.at < ROOTS_TTL_MS && now >= rootsCache.at) return rootsCache.roots;
  rootsCache = { at: now, roots: rootsOf(require('./projects').readAll()) };
  return rootsCache.roots;
}
function resetForTests() { rootsCache = { at: 0, roots: [] }; }

/* The project whose folder holds `file` (the deepest one, when one project's folder sits inside another's), and the
   file's name relative to it ('/'-joined), or null. */
function projectOf(file, roots) {
  const abs = resolved(file);
  let best = null;
  for (const { id, root } of roots) {
    const rel = path.relative(root, abs);
    if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) continue;   // '..notes.md' is inside
    if (!best || root.length > best.root.length) best = { root, projectId: id, name: rel.split(path.sep).join('/') };
  }
  return best && { projectId: best.projectId, name: best.name };
}
/* Each project's id and resolved folder (a folder that is gone is left out). */
function rootsOf(projects) {
  const roots = [];
  for (const p of projects) {
    if (!p || !p.id || typeof p.folder !== 'string' || !p.folder) continue;
    try { roots.push({ id: p.id, root: fs.realpathSync.native(p.folder) }); } catch { /* gone */ }
  }
  return roots;
}

/* Record that `who` is about to write `file`. `who` may be a function, called only for a file inside a project (the
   agent lookup is not paid for any other edit). Returns true when recorded. */
function noteWrite(file, who, { now = Date.now(), projects } = {}) {
  try {
    if (typeof file !== 'string' || !path.isAbsolute(file) || /[\x00-\x1f\x7f]/.test(file)) return false;
    const at = projectOf(file, Array.isArray(projects) ? rootsOf(projects) : projectRoots(now));
    if (!at) return false;
    if (typeof who === 'function') who = who();
    if (typeof who !== 'string' || !who) return false;
    const rec = readRecord(at.projectId);
    const prev = rec[at.name];
    const since = prev ? now - Date.parse(prev.at) : NaN;
    // The same agent again within REWRITE_MS (an edit in several steps): the record already says it.
    if (prev && prev.agent === who && since >= 0 && since < REWRITE_MS) return true;
    rec[at.name] = { agent: who, at: new Date(now).toISOString() };
    const kept = Object.entries(rec)
      .filter(([, v]) => v && typeof v === 'object' && now - Date.parse(v.at) <= KEEP_MS)
      .sort((a, b) => Date.parse(b[1].at) - Date.parse(a[1].at))
      .slice(0, MAX_ENTRIES);
    fs.mkdirSync(dir(), { recursive: true });
    require('./securewrite').writeSecret(fileFor(at.projectId), JSON.stringify(Object.fromEntries(kept)), 0o600, { atomicOnly: true });
    return true;
  } catch { return false; }
}

/* The agent that made the change at `modifiedIso`, from its record, or null. */
function writerOf(entry, modifiedIso) {
  if (!entry || typeof entry !== 'object' || typeof entry.agent !== 'string') return null;
  const at = Date.parse(entry.at);
  const mod = Date.parse(modifiedIso);
  if (!Number.isFinite(at) || !Number.isFinite(mod)) return null;
  return mod - at <= WRITE_WINDOW_MS && at - mod <= SLACK_MS ? entry.agent : null;
}

/* listFiles rows of one project, each with `changedBy` (the agent's name as `nameOf` shows it) when writerOf names
   one. Rows are copied; the input is not changed. */
function annotate(projectId, files, nameOf = (s) => s) {
  const rec = readRecord(projectId);
  return (Array.isArray(files) ? files : []).map((f) => {
    const who = f && typeof f.name === 'string' ? writerOf(rec[f.name], f.modified) : null;
    if (!who) return f;
    let shown = who;
    try { shown = nameOf(who) || who; } catch { shown = who; }
    return { ...f, changedBy: shown };
  });
}

module.exports = { noteWrite, writerOf, annotate, projectOf, fileFor, resetForTests, WRITE_WINDOW_MS, SLACK_MS, KEEP_MS };
