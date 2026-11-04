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
 * kosmos#7989: it also keeps each file's owner (the first agent seen about to change it) and, when another agent is
 * about to change it, writes a notice in the project's room for the agents (ownerNotice), throttled under NOTICES_KEY.
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
/* kosmos#7989: at most one owner notice per writer and owner in a project in this long, so a writer changing a whole
   folder of one agent's files leaves one note, not one per file. */
const NOTICE_EVERY_MS = 60 * 60 * 1000;
/* kosmos#7989: at most this many owner notices in one project's room per NOTICE_EVERY_MS, so a busy room's own posts are not
   pushed out of what `kosmos room` shows by default. */
const NOTICE_ROOM_MAX = 6;
/* kosmos#7989: the record's own entry for those notices. A file name never holds a control character (noteWrite refuses
   one), so this key cannot be a file's. */
const NOTICES_KEY = '\u0000notices';
/* kosmos#7989: how much of a file name a notice quotes. */
const NOTICE_NAME_MAX = 120;

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
    /* kosmos#7989: the file's owner is the first agent seen about to change it here (`first`): the agent recorded when the
       file had no record yet, set once and never moved by a later write. A record from before this change has no owner,
       and no notice is made for it. A record dropped by KEEP_MS or MAX_ENTRIES takes its owner with it, so the next
       writer becomes the owner (stated in the plan). */
    const first = prev ? (typeof prev.first === 'string' && prev.first ? prev.first : null) : who;
    const entry = { agent: who, at: new Date(now).toISOString() };
    if (first) entry.first = first;
    /* kosmos#7989: another agent about to change an owned file is said in the project's room, at most once per writer and
       owner per NOTICE_EVERY_MS (NOTICES_KEY keeps when each pair was last said; stamped before the note is written, so
       a note that fails, or one skipped because the owner is no longer on the project, silences that pair for the hour, the
       quiet direction), and at most NOTICE_ROOM_MAX pairs per project in that time. A notice, not a lock: nothing is refused. */
    let notice = null;
    const book = rec[NOTICES_KEY] && typeof rec[NOTICES_KEY] === 'object' && rec[NOTICES_KEY].by && typeof rec[NOTICES_KEY].by === 'object'
      ? { ...rec[NOTICES_KEY].by } : {};
    for (const k of Object.keys(book)) if (!(now - Date.parse(book[k]) < NOTICE_EVERY_MS)) delete book[k];
    if (first && first !== who) {
      const pair = who + '\u0000' + first;
      const last = Date.parse(book[pair]);
      const roomFull = Object.keys(book).length >= NOTICE_ROOM_MAX;
      if (!roomFull && !(Number.isFinite(last) && now - last >= 0 && now - last < NOTICE_EVERY_MS)) {
        notice = { projectId: at.projectId, name: at.name, owner: first, writer: who };
        book[pair] = entry.at;
      }
    }
    if (Object.keys(book).length) rec[NOTICES_KEY] = { at: entry.at, by: book }; else delete rec[NOTICES_KEY];
    rec[at.name] = entry;
    const kept = Object.entries(rec)
      .filter(([, v]) => v && typeof v === 'object' && now - Date.parse(v.at) <= KEEP_MS)
      .sort((a, b) => Date.parse(b[1].at) - Date.parse(a[1].at))
      .slice(0, MAX_ENTRIES);
    fs.mkdirSync(dir(), { recursive: true });
    require('./securewrite').writeSecret(fileFor(at.projectId), JSON.stringify(Object.fromEntries(kept)), 0o600, { atomicOnly: true });
    if (notice) ownerNotice(notice);
    return true;
  } catch { return false; }
}

/* kosmos#7989: the note another agent's write of an owned file leaves in the project's room, for the agents (the
   person's room view leaves agent notes out). Names are session names, as the record keeps them. Best-effort: a note
   that cannot be written changes nothing about the write. */
/* The file's name is an agent's choice, so it is quoted, cut, and its square brackets made round: a name must never spell
   a marker in a line that speaks in Kosmos's voice (as the room's text view does for an outside row, server.js, kind
   'external'). Line and paragraph separators and direction controls go too, so it cannot break or reorder the line. */
function quotedName(name) {
  const s = String(name || '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\[/g, '(').replace(/\]/g, ')').replace(/"/g, "'");
  const cut = require('./textcut').cutUnits(s, NOTICE_NAME_MAX);
  return '"' + cut + (cut.length < s.length ? '...' : '') + '"';
}
function ownerNoticeText({ name, owner, writer }) {
  return writer + ' was about to change ' + quotedName(name) + ' (' + owner + ' was the first agent seen changing it here). '
    + 'A notice, not a lock: ' + owner + ', read it again before you build on what you last saw in it. For the next hour, '
    + 'Kosmos will not post a separate notice for each other file ' + writer + ' changes that you were first to change.';
}
function ownerNotice(n) {
  try {
    // An owner no longer on the project is not addressed in a room it does not read.
    const p = require('./projects').readAll().find((x) => x && x.id === n.projectId);
    if (!p || !Array.isArray(p.agents) || !p.agents.includes(n.owner)) return;
    const messages = require('./messages');
    messages.roomNote(n.projectId, ownerNoticeText(n), { audience: messages.NOTE_AUDIENCE_AGENTS });
  } catch { /* the write stands */ }
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

module.exports = { noteWrite, writerOf, annotate, projectOf, fileFor, resetForTests, ownerNoticeText, WRITE_WINDOW_MS, SLACK_MS, KEEP_MS, NOTICE_EVERY_MS, NOTICE_ROOM_MAX };
