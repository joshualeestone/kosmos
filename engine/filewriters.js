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
/* kosmos#7989: at most this many owner notices in one project's room per NOTICE_EVERY_MS (per hour, not overall: a room
   where agents edit each other's files all day gets up to this many each hour). Past it, one note says further notices
   are held back. */
const NOTICE_ROOM_MAX = 6;
/* kosmos#7989: a session name as Kosmos makes one (create.js NAME_RE is this shape; at most 32 long); a name read back from
   the record that is not this shape gets no notice. */
const SESSION_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
/* kosmos#7989: the record's own entry for those notices. A file's name is derived from its path, and noteWrite refuses a
   path holding any control character, so this key cannot be a file's. */
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
function resetForTests() { rootsCache = { at: 0, roots: [] }; membersCache = { at: 0, byId: new Map() }; }

/* The project whose folder holds `file` (the deepest one, when one project's folder sits inside another's), and the
   file's name relative to it ('/'-joined), or null. */
function projectOf(file, roots) { return projectOfResolved(resolved(file), roots); }
/* projectOf for a path already resolved, so a caller that resolved it once does not resolve it again (kosmos#7989
   review 6: a second resolve is a second chance for a swapped link). */
function projectOfResolved(abs, roots) {
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
       and no notice is made for it. Once a record has been pruned (KEEP_MS or MAX_ENTRIES, by any later write to the
       project), its owner goes with it and the next writer becomes the owner; a record still on disk keeps its owner. */
    const first = prev ? (typeof prev.first === 'string' && prev.first ? prev.first : null) : who;
    const entry = { agent: who, at: new Date(now).toISOString() };
    if (first) entry.first = first;
    /* kosmos#7989: another agent about to change an owned file is said in the project's room, at most once per writer and
       owner per NOTICE_EVERY_MS (NOTICES_KEY keeps when each pair was last said, stamped before the note is written, so a
       note that fails silences that pair for the hour, the quiet direction), and at most NOTICE_ROOM_MAX pairs per project
       in that time, after which one note says the rest are held back. A notice, not a lock: nothing is refused. */
    let notice = null;
    const book = rec[NOTICES_KEY] && typeof rec[NOTICES_KEY] === 'object' && rec[NOTICES_KEY].by && typeof rec[NOTICES_KEY].by === 'object'
      ? { ...rec[NOTICES_KEY].by } : {};
    for (const k of Object.keys(book)) if (!(now - Date.parse(book[k]) < NOTICE_EVERY_MS)) delete book[k];
    const heldAt = rec[NOTICES_KEY] && Date.parse(rec[NOTICES_KEY].held);
    let held = Number.isFinite(heldAt) && now - heldAt >= 0 && now - heldAt < NOTICE_EVERY_MS ? rec[NOTICES_KEY].held : null;
    if (first && first !== who && SESSION_NAME_RE.test(first) && SESSION_NAME_RE.test(who)) {
      const pair = who + '\u0000' + first;
      const last = Date.parse(book[pair]);
      // The project's members are read only when a notice is due; an owner no longer on it takes no slot and gets no note.
      if (!(Number.isFinite(last) && now - last >= 0 && now - last < NOTICE_EVERY_MS) && onProject(at.projectId, first, now)) {
        if (Object.keys(book).length < NOTICE_ROOM_MAX) {
          notice = { projectId: at.projectId, name: at.name, owner: first, writer: who };
          book[pair] = entry.at;
        } else if (!held) {
          notice = { projectId: at.projectId, heldBack: true };
          held = entry.at;
        }
      }
    }
    if (Object.keys(book).length || held) rec[NOTICES_KEY] = { at: entry.at, by: book, ...(held ? { held } : {}) }; else delete rec[NOTICES_KEY];
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

/* The file's name is an agent's choice (or an archive's), so it is quoted, cut, its brackets (fullwidth and CJK ones too)
   made round, and invisible characters (tag characters, variation selectors, fillers) removed: a name must never spell
   a marker in a line that speaks in Kosmos's voice (as the room's text view does for an outside row, server.js, kind
   'external'). Line and paragraph separators and direction controls go too, so it cannot break or reorder the line. */
function quotedName(name) {
  const s = String(name || '').toWellFormed()   // review 8: no lone surrogate half reaches the log (#7108)
    .replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u115f\u1160\u180e\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\u3164\ufe00-\ufe0f\ufeff\uffa0\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}]/gu, ' ')
    .replace(/[\[\uff3b\u3010\u3014\u3016\u3018\u301a]/g, '(').replace(/[\]\uff3d\u3011\u3015\u3017\u3019\u301b]/g, ')').replace(/"/g, "'");
  const cut = require('./textcut').cutUnits(s, NOTICE_NAME_MAX);
  return '"' + cut + (cut.length < s.length ? '...' : '') + '"';
}
/* The writer and owner are session names (SESSION_NAME_RE, checked before a notice is made), so they are not quoted. */
function ownerNoticeText({ name, owner, writer }) {
  return writer + ' was about to change ' + quotedName(name) + ' (' + owner + ' was the first agent seen changing it here). '
    + 'A notice, not a lock: ' + owner + ', read it again before you build on what you last saw in it. For the next hour, '
    + 'Kosmos will not post a separate notice for each other file ' + writer + ' changes that you were the first seen changing.';
}
/* kosmos#8235: the room's copy also says when the owner gets its own, so a check made just after the change does not
   read as the notice never arriving. Not in the owner's copy, which is that delivery. It names what delivers it
   (Kosmos's report hook in Claude Code; other runners keep only the room note, engine/filenotices.js) and speaks to
   the owner as the note's earlier sentences do. FILE_NOTICE_EVERY in both report hooks is the five minutes, counted
   from the owner's last look. Left out on purpose, to keep one sentence: the hook needs an agent token or a tmux pane,
   and the owner's queue keeps at most MAX_PENDING notices for at most a day (engine/filenotices.js). */
function roomNoticeText(n) {
  return ownerNoticeText(n) + ' Kosmos\'s hook in Claude Code also hands you this notice at a prompt of yours, '
    + 'looking at most once every five minutes, so a prompt soon after its last look may not carry it yet.';
}
const HELD_BACK_TEXT = 'Kosmos has posted its limit of file-owner notices in this room for the hour and is holding back the '
  + 'rest for now. Read a shared file again before you build on what you last saw in it.';
/* Whether `owner` is on the project, asked only when a notice is due. The members are kept for ROOTS_TTL_MS, as the roots
   are, since a departed owner's or a full room's writes ask again on every edit; so for up to that long an owner who just
   left may get one notice, and one who just joined gets none (the next write after it does). An unreadable list is no. */
let membersCache = { at: 0, byId: new Map() };
function onProject(projectId, owner, now = Date.now()) {
  try {
    if (!(now - membersCache.at < ROOTS_TTL_MS && now >= membersCache.at)) {
      const byId = new Map();
      for (const p of require('./projects').readAll()) if (p && p.id && Array.isArray(p.agents)) byId.set(p.id, p.agents.slice());
      membersCache = { at: now, byId };
    }
    const agents = membersCache.byId.get(projectId);
    return Boolean(agents && agents.includes(owner));
  } catch { return false; }
}
/* kosmos#7989: the note another agent's write of an owned file leaves in the project's room, for the agents (the
   person's room view leaves agent notes out). Names are session names, as the record keeps them. Best-effort: a note
   that cannot be written changes nothing about the write. */
function ownerNotice(n) {
  try {
    const messages = require('./messages');
    messages.roomNote(n.projectId, n.heldBack ? HELD_BACK_TEXT : roomNoticeText(n), { audience: messages.NOTE_AUDIENCE_AGENTS });
  } catch { /* the write stands */ }
  /* kosmos#7989 slice 3: the notice also waits for the owner itself (engine/filenotices.js), which Kosmos's Claude
     Code hook hands to it at its next turn. kosmos#8235: the owner is queued ownerNoticeText; the room gets
     roomNoticeText, which adds when that happens. Not the held-back note: that one names no owner. Separate from the room note,
     so either failing leaves the other. */
  if (!n.heldBack) {
    try { require('./filenotices').queue(n.owner, ownerNoticeText(n)); } catch { /* the write stands */ }
  }
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

/* kosmos#7989 slice 2: what the record says about one file, for `kosmos project who <file>` (filewhoview.renderWho prints
   it). `file` is an absolute path; it is read against the projects' folders as they are now (not the edit-time cache,
   since a project made a moment ago must answer). `lastChange` compares the file's modification time with the last
   record by writerOf's window: 'seen' (the change follows the record), 'after' (it changed later, unseen), 'before' (its
   modification time is older than the record), or null (no record, or no file). `nameOf` gives an agent's display name. Never
   throws; a path outside every project folder answers { ok: false, because: 'outside' }, and a folder (a project's
   own, or one inside it) { ok: false, because: 'folder' }, said only for a path inside a project. */
function about(file, { projects, nameOf = (s) => s, now = Date.now() } = {}) {
  try {
    if (typeof file !== 'string' || !path.isAbsolute(file) || /[\x00-\x1f\x7f]/.test(file)) return { ok: false, because: 'path' };
    const list = Array.isArray(projects) ? projects : require('./projects').readAll();
    const roots = rootsOf(list);   // a project's own folder, from the board's list: not a caller's path
    /* Review 5: a caller picks this path, and resolving it runs on the board's one thread, so a path on a network mount
       (/net autofs, /Volumes, /Network, a UNC share) that no project lives on is answered as outside before anything
       touches it: a stalled share would otherwise freeze the board for everyone. */
    /* Partial by design: a link to a mount, another spelling of one, or a mapped drive letter is not caught. A project
       whose folder, as listed or resolved (`roots`, no extra disk access), is on that mount lets the path through.
       Windows \\?\ and \\.\ prefixes are not shares. Compared without case on Windows. */
    const lexical = path.resolve(file);
    const fold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
    const mountOf = (p) => { const m = /^(\/(?:net|Volumes|Network)\/[^/]+|\\\\(?![?.]\\)[^\\]+|\/\/(?![?.]\/)[^/]+)/.exec(p); return m ? m[1] : null; };
    const mount = mountOf(lexical);
    const onMount = (p) => typeof p === 'string' && p && fold(path.resolve(p) + path.sep).startsWith(fold(mount + path.sep));
    if (mount && !list.some((p) => p && onMount(p.folder)) && !roots.some((r) => onMount(r.root))) {
      return { ok: false, because: 'outside' };
    }
    // Review 2: resolved once, and every later read uses this, so a link swapped between two reads cannot redirect one.
    const abs = resolved(lexical);
    const at = projectOfResolved(abs, roots);
    if (!at) {
      // Review 1: a project's own folder is in no project by projectOf (an empty name), and is not "outside" either.
      return roots.some((r) => r.root === abs) ? { ok: false, because: 'folder' } : { ok: false, because: 'outside' };
    }
    const shown = (s) => { try { return nameOf(s) || s; } catch { return s; } };
    /* Review 2: a record is filed under the deepest project at the moment of the write, so a project made later inside
       another's folder leaves the file's earlier records under the outer one. Every project whose folder holds the file
       is read (only those: the others are skipped before their record is opened), and the newest entry is the last
       agent seen. Review 3: the owner is from the deepest project's own entry only, the one noteWrite notices from, so
       this never names an owner the notices would not act on; a file whose only entries are an outer project's has no
       owner here, as noteWrite treats it. An entry older than KEEP_MS before `now` (lapsed, not yet pruned) is not read,
       although noteWrite still hands its `first` on until the record is pruned (review 7): so after 30 quiet days this can
       show no owner where the next write's notice names one. The quiet direction, kept on purpose. */
    const entries = [];
    for (const { id, root } of roots) {
      const rel = path.relative(root, abs);
      if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) continue;
      const name = rel.split(path.sep).join('/');
      const e = readRecord(id)[name];
      if (name !== NOTICES_KEY && e && typeof e === 'object' && typeof e.agent === 'string' && e.agent && Number.isFinite(Date.parse(e.at))
        && now - Date.parse(e.at) <= KEEP_MS) {
        entries.push({ e, deepest: id === at.projectId });
      }
    }
    entries.sort((a, b) => Date.parse(b.e.at) - Date.parse(a.e.at));
    const entry = entries.length ? entries[0].e : null;
    const ownEntry = (entries.find((x) => x.deepest) || {}).e || null;
    let modified = null;
    let notFile = null;
    try {
      // lstat of the resolved path: a link here now was swapped in after it was resolved, and is not followed.
      /* Review 6: lstat refuses a link only in the last part of the path. A folder above it swapped for a link since the
         path was resolved would point the stat outside the project, so the folder is resolved again, before and after
         the stat (review 7: one check after leaves a swap-and-back window), and must not have moved; if it has, or
         cannot be resolved, nothing about the file is said. */
      const stayed = () => { try { return fs.realpathSync.native(path.dirname(abs)) === path.dirname(abs); } catch { return null; } };
      const before = stayed();
      if (before === false) return { ok: false, because: 'outside' };
      const st = fs.lstatSync(abs);
      if (stayed() !== true) return { ok: false, because: 'outside' };
      // Review 1: a folder inside a project is not a file that is gone; it has no record of its own.
      if (st.isDirectory()) return { ok: false, because: 'folder' };
      if (st.isFile()) modified = new Date(st.mtimeMs).toISOString();
      // Review 5: a link here is one to nothing (resolved() keeps a dangling link's own path), or one swapped in after
      // the path was resolved; either way it is not followed. Review 4: a pipe, socket or device is there, not gone.
      else notFile = st.isSymbolicLink() ? 'link' : 'special';
    } catch { /* not there */ }
    const seen = entry && typeof entry.agent === 'string' && entry.agent && Number.isFinite(Date.parse(entry.at)) ? entry : null;
    let lastChange = null;
    if (seen && modified) {
      if (writerOf(seen, modified)) lastChange = 'seen';
      else lastChange = Date.parse(modified) > Date.parse(seen.at) ? 'after' : 'before';
    }
    const project = list.find((p) => p && p.id === at.projectId);
    return {
      ok: true,
      projectId: at.projectId,
      projectName: project && typeof project.name === 'string' ? project.name : null,
      name: at.name,
      exists: Boolean(modified),
      ...(notFile ? { notFile } : {}),
      modified,
      lastSeen: seen ? { agent: seen.agent, shown: shown(seen.agent), at: seen.at } : null,
      owner: ownEntry && typeof ownEntry.first === 'string' && ownEntry.first ? { agent: ownEntry.first, shown: shown(ownEntry.first) } : null,
      lastChange,
    };
  } catch { return { ok: false, because: 'unreadable' }; }
}

module.exports = { about, noteWrite, writerOf, annotate, projectOf, fileFor, resetForTests, ownerNoticeText, roomNoticeText /* kosmos#8235 */, HELD_BACK_TEXT, WRITE_WINDOW_MS, SLACK_MS, KEEP_MS, NOTICE_EVERY_MS, NOTICE_ROOM_MAX };
