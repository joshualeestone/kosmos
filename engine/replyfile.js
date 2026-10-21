'use strict';
/**
 * A file an agent attaches to its reply to the person (#6726).
 *
 * Josh, 2026-10-20 09:03, to Mona Lisa: "any chance i can get the file here so i
 * can download it". `kosmos reply` was text only, so a finished file could reach
 * him only as a sentence saying where it was saved.
 *
 * 🔑 THE SAME ATTACHMENT A PERSON'S UPLOAD IS. The file is copied into the
 * attachment store (engine/attachments.js, scope 'agent', owner the agent's own
 * session) and the reply's row carries `attachments.rowFields`, so the page draws
 * the card it already draws for a person's file (pjAttachmentCards, on the agent's
 * row too) and the download is the existing GET /api/attachment/<id>. No new route.
 *
 * 🔑 A COPY, NEVER A PATH. The bytes are read once, here, and stored; the
 * agent's own file is never served. A later edit or delete of the original
 * cannot change what was sent.
 *
 * 🛑 ONLY THE AGENT'S OWN FILES. The card's own limit: a file directly in the
 * agent's Files folder (engine/dmfiles.js filesDir, the one the page lists), or
 * anywhere inside the folder of a project the agent is on. Decided on the REAL
 * path (every link followed), so a link that points out is judged by where it
 * lands. Refused as well, before anything is resolved: a relative path and a `..`
 * segment (said plainly, even when it would land inside). Refused after: anything
 * that is not a regular file (a folder, a device, a FIFO), a hidden name on the
 * way down from the root (a project's `.env` or `.git` is not something the
 * person asked for), a file inside a NESTED project the agent is not on, and a
 * file over the size a conversation carries (attachments.MAX_BYTES, the cap a
 * person's upload has), a file with a second name (a hard link), and a Files folder
 * that is itself a link (its target would become the root). Paths are compared in
 * their ON-DISK spelling (realpathSync.native, as projects.js reads project folders),
 * so a different case or Unicode form cannot slip a file past a nested project.
 * The route attaches only for a sender a token named (server.js /api/reply).
 *
 * ⚠️ THE WEAKEST POINT, stated: the containment check reads the real path, then
 * the file is opened by that path with O_NOFOLLOW and O_NONBLOCK, the given path is
 * resolved again and must still land on the same real path (review r2 finding 7), the
 * file now at that path must be the one the descriptor holds, and the open file must be
 * the one the check saw (device and inode, one name). That refuses a swapped last
 * component, and a single swap of a folder above the file between the check and the
 * open. It does not close a DOUBLE swap (a folder swapped, the file opened, the folder
 * swapped back before the re-reads): Node has no openat walk to hold each folder open.
 * The check is also only as good as the roots it is given: this user's processes can
 * write the projects list and the profiles it reads.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const attachments = require('./attachments');
const dmfiles = require('./dmfiles');
const projects = require('./projects');
const store = require('./store');

/* The type a stored file is described by, from its extension. The page words the
   card from it (pjFileWord) and the download carries it with nosniff, an attachment
   disposition and a sandbox, so a wrong guess costs only a word on the card. */
const TYPES = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.heic': 'image/heic', '.avif': 'image/avif', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.aac': 'audio/aac',
  '.txt': 'text/plain', '.md': 'text/markdown', '.markdown': 'text/markdown', '.csv': 'text/csv', '.log': 'text/plain',
  '.html': 'text/html', '.htm': 'text/html', '.json': 'application/json', '.yaml': 'application/yaml', '.yml': 'application/yaml',
  '.zip': 'application/zip', '.rtf': 'application/rtf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.doc': 'application/msword', '.xls': 'application/vnd.ms-excel', '.ppt': 'application/vnd.ms-powerpoint',
  '.pages': 'application/vnd.apple.pages', '.numbers': 'application/vnd.apple.numbers', '.key': 'application/vnd.apple.keynote',
};
function typeOf(name) {
  return TYPES[path.extname(String(name || '')).toLowerCase()] || 'application/octet-stream';
}

const CHANGED = 'that file changed while it was being attached; try again';
/* A hard link is the same file under a second name, which may be anywhere on the disk: the name in the
   agent's folder says nothing about where else it lives, so a file with more than one name is refused
   (review r1, finding 3, decided). A copy, not a link, is what the agent sends. */
const HARD_LINK = 'that file has another name somewhere else on this computer (a hard link), so it cannot be attached; attach a copy of it instead';
const NOT_YOURS = 'only a file directly in your Files folder, or inside the folder of a project you are on, can be attached';

/* The ON-DISK spelling, as projects.js resolveReal reads a project's folder: realpathSync.native,
   never the JS realpathSync, which keeps the caller's case and Unicode form. On a case-insensitive,
   normalization-insensitive disk (APFS by default) the JS one let /X/A/b/f dodge a nested project
   at /X/A/B, and refused a Files folder typed in another case (review r1, finding 1). */
let realpathForTests = null;   // a test's stand-in, to make the second resolution (after the open) answer differently
function realOf(p) {
  if (realpathForTests) return realpathForTests(p);
  return typeof fs.realpathSync.native === 'function' ? fs.realpathSync.native(p) : fs.realpathSync(p);
}
/* Review r3 finding 5: only a test may swap how paths resolve. Outside one this throws, so the seam cannot be
   turned on in a running board by anything that can require this module. Gated on store.isTestProcess, the same
   test-process answer store.js gates KOSMOS_ALLOW_REAL_ROOT on. */
function setRealpathForTests(fn) {
  if (!store.isTestProcess(process.env)) {
    throw new Error('setRealpathForTests is for tests only');
  }
  realpathForTests = typeof fn === 'function' ? fn : null;
}
function realOrNull(p) {
  try { return realOf(p); } catch { return null; }
}
function inside(root, real) {
  return real.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
}

/**
 * The agent's Files folder as it is on disk, or null when it is not a plain folder of its own: a
 * Files folder that is a link (or sits under a link) would make the link's target the root, so a
 * Files pointing at ~/.ssh would send the key (review r1, finding 2). Kosmos makes the folder
 * itself, as a real folder beside the agent's instructions, so a link there is never ours.
 */
function filesRoot(sessionName) {
  const filesDir = dmfiles.filesDir(sessionName);
  if (!filesDir) return null;
  let lst;
  try { lst = fs.lstatSync(filesDir); } catch { return null; }
  if (lst.isSymbolicLink() || !lst.isDirectory()) return null;
  const real = realOrNull(filesDir);
  const parent = realOrNull(path.dirname(filesDir));
  if (!real || !parent || real !== path.join(parent, path.basename(filesDir))) return null;
  return real;
}

const KEPT_FOR_KOSMOS = 'that file is in a folder Kosmos keeps for itself or for its agents (its data, an agent\'s own folder, or .config or .ssh in the home folder), so it cannot be attached from a project';
const WIDE_PROJECT = 'that project\'s folder is the whole home folder, or holds Kosmos\'s own data or every agent\'s folder, so no file can be attached from it';
const HIDDEN_IN_HOME = 'that file is in a hidden folder of the home folder, or is a hidden file there, where settings and keys are kept, so it cannot be attached';
const IN_LIBRARY = 'that file is in the Library folder, where apps keep their data, so it cannot be attached; only iCloud Drive and cloud folders there can be';

/* Review r2 finding 1 (decided): a project is a folder an agent can adopt itself (`kosmos project create "x"
   <existing folder>`), or a person can make one at ~/work, so "a project you are on" alone would reach other
   agents' Files, the board token, the sender tokens and the person's uploads. allowedRoot below decides where a
   file may come from: DIRECTLY in the sender's Files folder, or under the deepest project that holds it, when that
   project is the sender's and the file is not under anything keptRoots lists, not in a hidden folder of home, and
   not in ~/Library outside the places people keep their files. Every comparison is by IDENTITY (review r4
   finding 1), never by how a path is spelled. */
function agentNames(sessionName, roster) {
  const names = new Set([String(sessionName)]);
  for (const c of Array.isArray(roster) ? roster : []) if (c && typeof c.sessionName === 'string' && c.sessionName) names.add(c.sessionName);
  try { for (const k of require('./status').createdKeys()) if (typeof k === 'string' && k) names.add(k); } catch { /* the roster alone */ }
  return names;
}
/* A folder or file by IDENTITY (device and inode), never by spelling (review r4 finding 1). realpathSync.native
   returns /System/Volumes/Data/Users/<me>/... unchanged, and that is the same folder as /Users/<me>/... (a macOS
   firmlink), so every rule here that compared strings could be stepped around by spelling. Null when it cannot
   be read. */
function idOf(p) {
  try { const st = fs.statSync(p); return st.dev + ':' + st.ino; } catch { return null; }
}
/* The file and every folder above it, nearest first, each with its identity and its own name on disk. */
function chainOf(real) {
  const out = [];
  let cur = real;
  for (;;) {
    out.push({ p: cur, id: idOf(cur), name: path.basename(cur) });
    const up = path.dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return out;
}
/* The identities of a folder and every folder above it: "does X contain this folder" is "is X's id in here". */
function aboveIds(p) {
  return new Set(chainOf(p).map((c) => c.id).filter(Boolean));
}

/* The roots the rules below name, each by identity, read once per call (the roots are environment-set, and a
   test or a world switch moves them).
   Kept wholesale: the data root, the legacy data root (AgentWorkforce, review r3 finding 2), the workers root
   (every created agent's folder), ~/.config and ~/.ssh.
   Kept piecemeal (review r4 finding 3, r5 finding 2): an agent whose folder is recorded OUTSIDE the workers root
   is a connected agent, and that folder is its own working folder, often a person's project. Only what Kosmos
   writes there is kept (KOSMOS_WRITES): its Files and Inbox, its launch log (start.log, create.logFile), and its
   brief under every runner's name with the backup instructions.js keeps beside it (<brief>.previous), since a
   runner switch leaves the old name's file behind. Every agent is listed: the sender, the roster the route hands
   in, and every agent created on this computer. */
const KOSMOS_WRITES = ['Files', 'Inbox', 'start.log'].concat(...['CLAUDE.md', 'AGENTS.md', 'GEMINI.md'].map((b) => [b, b + '.previous']));
function keptRoots(sessionName, roster) {
  const home = process.env.AGENT_WORKFORCE_HOME || os.homedir();
  let legacy = null;
  try { legacy = store.dataRootFor(process.platform, home, process.env, store.LEGACY_APP); } catch { legacy = null; }
  const workers = require('./create').workersDir();
  const workersId = idOf(workers);
  const named = [store.ROOT, workers, path.join(home, '.config'), path.join(home, '.ssh')];
  if (legacy) named.push(legacy);
  /* One pass over the agents, one instructions.fileFor each (it reads the agent's profile and launch job), and
     everything else derived from that folder: review r5 finding 3. */
  const instructions = require('./instructions');
  for (const name of agentNames(sessionName, roster)) {
    let brief = null;
    try { brief = instructions.fileFor(name); } catch { brief = null; }
    if (typeof brief !== 'string' || !brief) continue;
    const own = path.dirname(brief);
    if (workersId && aboveIds(own).has(workersId)) { named.push(own); continue; }   // a created agent: all of it
    for (const f of KOSMOS_WRITES) named.push(path.join(own, f));
  }
  const lib = path.join(home, 'Library');
  return {
    home,
    homeId: idOf(home),
    data: store.ROOT,
    dataId: idOf(store.ROOT),
    workers,
    workersId,
    libraryId: idOf(lib),
    mobileDocsId: idOf(path.join(lib, 'Mobile Documents')),
    cloudStorageId: idOf(path.join(lib, 'CloudStorage')),
    kept: new Set(named.map(idOf).filter(Boolean)),
  };
}

/* ~/Library is app data (Keychains, Cookies, browser profiles, Messages, Mail), refused except where a person keeps
   their own files, and so where a person's project can live (review r3 finding 2, r4 finding 4): iCloud Drive
   (Mobile Documents/com~apple~CloudDocs), an iCloud app's user-visible Documents (Mobile Documents/<container>/
   Documents, where an Obsidian vault in iCloud lives), and the File Provider clouds in CloudStorage (Dropbox, Google
   Drive, OneDrive). register.js (guardedSpelling) already treats Mobile Documents as a person's place. Any other
   part of a container (com~apple~Notes's own data) stays refused. Matched by identity, with the names below the
   matched folder read from the real path. */
function libraryOpen(chain, k, rootDepth) {
  const at = (id) => (id ? chain.findIndex((c) => c.id === id) : -1);
  if (at(k.cloudStorageId) > 0) return true;
  const md = at(k.mobileDocsId);
  if (md > 0) {
    const container = chain[md - 1];
    if (container.name === 'com~apple~CloudDocs') return true;
    /* Review r5 finding 4: a container's Documents opens only to a project inside that same container (its root at
       the container or below it), so a project at Mobile Documents or ~/Library opens no app's Documents. */
    if (md >= 2 && chain[md - 2].name === 'Documents' && rootDepth <= md - 1) return true;
  }
  return false;
}

function allowedRoot(sessionName, real, roster, given) {
  const chain = chainOf(real);
  const filesReal = filesRoot(sessionName);
  if (filesReal && chain[1] && chain[1].id && chain[1].id === idOf(filesReal)) return { root: filesReal };
  let all = [];
  try { all = projects.readAll(); } catch { all = []; }
  /* The deepest project holding the file, by identity: the one whose folder is nearest the file in its chain. */
  let best = null;
  for (const p of all) {
    if (!p || typeof p.folder !== 'string' || !p.folder) continue;
    let root = null;
    try { root = projects.folderState(p.folder).real; } catch { root = null; }
    const rid = root ? idOf(root) : null;
    if (!rid) continue;
    const i = chain.findIndex((c, n) => n > 0 && c.id === rid);
    if (i < 0) continue;
    const mine = (p.agents || []).includes(sessionName);
    if (!best || i < best.depth) best = { root, rid, depth: i, mine };
    /* Several projects on the same deepest folder (review r7 finding 2): the agent is on it if ANY of them lists it,
       so the order projects.json happens to list them in never decides. */
    else if (i === best.depth && mine) best.mine = true;
  }
  if (!best || !best.mine) return null;
  const k = keptRoots(sessionName, roster);
  /* A project whose folder IS the home folder or CONTAINS it (/Users, /, the Data volume root), or holds the data
     root or the workers root, gives nothing (review r3 finding 3), wherever those roots live and however the folder
     is spelled. Two layers:
     - rootHolds (review r6 finding 1): for each ancestor A of the target's spelling, the target's path below A,
       joined onto the root, lands on the target itself. That is how /System/Volumes/Data holds /Users/<me> (its
       Users/<me> is home) without being any ancestor of home's spelling, and it holds the files outside home there
       too (Users/Shared, private/etc). It replaced the ancestor-id sets, which it covers (A's own id is the case of
       an empty path below A).
     - heldBelowRoot (review r5 finding 1): the target in the file's own chain at or below the root, where both share
       the file's spelling. Kept as a second layer for a spelling whose folder names below the root differ from the
       target's own (rootHolds joins the target's names); no such spelling is known on macOS. */
  const rootHolds = (target, targetId) => {
    if (!target || !targetId) return false;
    for (let a = target; ; a = path.dirname(a)) {
      if (idOf(path.join(best.root, path.relative(a, target))) === targetId) return true;
      if (path.dirname(a) === a) return false;
    }
  };
  const heldBelowRoot = (id) => {
    if (!id) return false;
    const at = chain.findIndex((c) => c.id === id);
    return at >= 0 && at <= best.depth;
  };
  if (rootHolds(k.home, k.homeId) || rootHolds(k.data, k.dataId) || rootHolds(k.workers, k.workersId)
    || heldBelowRoot(k.homeId) || heldBelowRoot(k.dataId) || heldBelowRoot(k.workersId)) return { refused: WIDE_PROJECT };
  if (chain.some((c) => c.id && k.kept.has(c.id))) return { refused: KEPT_FOR_KOSMOS };
  const hidden = hiddenRefusal(given, chain, best.depth, k);
  if (hidden) return { refused: hidden };
  if (k.libraryId && chain.some((c, n) => n > 0 && c.id === k.libraryId) && !libraryOpen(chain, k, best.depth)) return { refused: IN_LIBRARY };
  return { root: best.root };
}

/* The three hidden-name rules, in one place, for a PROJECT file only (review r6 finding 2): allowedRoot calls it after
   the Files early return, so an agent's own Files folder that sits under a dot folder (some runners keep their agents
   there) is not refused for it.
   1. The path AS GIVEN (review r5 finding 5), before any link is followed: a hidden name under home, so ~/.aws that is
      a link into a non-hidden dotfiles folder is refused by the name it was reached through. What none of these sees:
      a project rooted at that dotfiles folder, reaching the same file by its real, non-hidden path.
   2. The REAL path under home (review r3 finding 1): a hidden name anywhere between home and the file, whatever the
      project root (~/.aws, ~/.gnupg, ~/.kube, ~/.docker, a dotfile in home itself).
   3. Below the project root: a hidden file, or a file in a hidden folder of the project (.env, .git). */
function hiddenRefusal(given, chain, rootDepth, k) {
  const home = k.home;
  if (given.startsWith(home + path.sep) && path.relative(home, given).split(path.sep).some((seg) => seg.startsWith('.'))) return HIDDEN_IN_HOME;
  const h = k.homeId ? chain.findIndex((c) => c.id === k.homeId) : -1;
  if (h > 0 && chain.slice(0, h).some((c) => c.name.startsWith('.'))) return HIDDEN_IN_HOME;
  if (chain.slice(0, rootDepth).some((c) => c.name.startsWith('.'))) return 'a hidden file, or a file in a hidden folder, cannot be attached';
  return null;
}

/**
 * Copy one of the agent's own files into the attachment store.
 * Returns { ok: true, rec } (rec as attachments.save returns it) or { ok: false, because }.
 */
function attach(sessionName, given, { roster } = {}) {
  if (typeof given !== 'string' || !given || given.includes('\0')) return { ok: false, because: 'name the file to attach by its path' };
  if (!path.isAbsolute(given)) return { ok: false, because: 'give the full path of the file to attach' };
  if (given.split(/[\\/]/).includes('..')) return { ok: false, because: 'a path with .. in it cannot be attached; give the file\'s own full path' };
  let real;
  try { real = realOf(given); } catch (err) {
    return { ok: false, because: err && err.code === 'ENOENT' ? 'there is no file at ' + given : 'that file could not be read' };
  }
  let st;
  try { st = fs.statSync(real); } catch { return { ok: false, because: 'that file could not be read' }; }
  if (st.isDirectory()) return { ok: false, because: 'that is a folder; attach one file at a time' };
  if (!st.isFile()) return { ok: false, because: 'that is not an ordinary file, so it cannot be attached' };
  if (st.nlink > 1) return { ok: false, because: HARD_LINK };
  const where = allowedRoot(sessionName, real, roster, given);
  if (!where) return { ok: false, because: NOT_YOURS };
  if (where.refused) return { ok: false, because: where.refused };
  if (st.size > attachments.MAX_BYTES) {
    // Review 5: "larger than", not its rounded size, which reads "100 MB" just past a 100 MB cap.
    return { ok: false, because: 'that file is larger than ' + attachments.MAX_WORDS + ', the most a conversation carries; tell them where it is saved instead' };
  }
  if (st.size === 0) return { ok: false, because: 'there is nothing in that file' };
  const used = sentToday(sessionName);
  if (used + st.size > DAILY_BYTES) {
    return { ok: false, because: 'you have attached ' + attachments.sizeWords(used) + ' to your replies in the last 24 hours, and an agent can attach up to 200 MB a day; tell them where this one is saved instead' };
  }
  const name = path.basename(real);   // review r2 finding 5: the file's own name, not a link's (report.pdf -> notes.txt is notes.txt)
  try {
    /* #6734: copied across in chunks into the stored file, never held whole; a refused read leaves nothing stored. */
    const kept = attachments.saveFilled('agent', sessionName, { name, type: typeOf(name), by: 'agent' }, (out) => readOwn(real, st, given, out));
    if (!kept.ok) return kept;
    const rec = kept.rec;
    ledgerAdd(sessionName, rec.id, Date.parse(rec.at), rec.size);
    return { ok: true, rec };
  } catch (err) {
    // #6734 review 13: a system error (it has a code) carries a path with the user's name; the agent gets the sentence.
    return { ok: false, because: (err && !err.code && err.message) ? String(err.message) : 'that file could not be kept' };
  }
}

/* O_NONBLOCK: a FIFO swapped in after the stat would otherwise block this open, and with it the
   board's event loop, until a writer came (review r1, finding 4). On a regular file it changes nothing. */
/* Undefined on win32 (#1732 fs-const-platform-flag): captured here and ORed in undefined-safe. Without them the
   identity checks in readOwn (the given path resolved again to the same real path, the file there and the open
   descriptor the same dev/ino as the checked file, an ordinary file with one name) still refuse a swapped link or
   FIFO on every platform; the kernel flags are a second guard where they exist. */
const NOFOLLOW = fs.constants.O_NOFOLLOW;
const NONBLOCK = fs.constants.O_NONBLOCK;
const OPEN_FLAGS = fs.constants.O_RDONLY | (NOFOLLOW || 0) | (NONBLOCK || 0);

/**
 * The bytes of `real`, which must still be the file `st` described: opened without following a link
 * and without blocking, then checked to be that same ordinary file with one name. One byte past the
 * cap is read, so a file that grew since the stat is refused, not cut.
 * #6734: the bytes are written to the descriptor `out` as they are read, a chunk at a time, so a 100 MB
 * file is never held whole; the caller's store discards them on a refusal.
 * Returns { ok: true, size } or { ok: false, because }.
 */
const COPY_CHUNK = 1024 * 1024;
function readOwn(real, st, given, out) {
  if (typeof given !== 'string' || !given) return { ok: false, because: CHANGED };   // required (review r6 finding 3)
  let fd = null;
  try {
    fd = fs.openSync(real, OPEN_FLAGS);
    /* Review r2 finding 7 (decided): the given path is resolved again once the file is open, and must still land
       on `real`. With the dev/ino compare below, a folder above the file swapped between the check and the open is
       caught too, not only the last component. */
    const open = fs.fstatSync(fd);   // once (review r6 finding 3): the descriptor's own facts, used for every check below
    let again = null;
    try { again = realOf(given); } catch { again = null; }
    if (again !== real) return { ok: false, because: CHANGED };
    /* Review r3 finding 4: and the file at `real` now must be the one the descriptor holds. This narrows the
       window to a DOUBLE swap (swap a folder, open, swap it back before these reads); it does not close one, since
       Node has no openat walk that would hold each folder open on the way down. */
    let now = null;
    try { now = fs.statSync(real); } catch { now = null; }
    if (!now || now.dev !== open.dev || now.ino !== open.ino) return { ok: false, because: CHANGED };
    if (!open.isFile() || open.dev !== st.dev || open.ino !== st.ino) return { ok: false, because: CHANGED };
    if (open.nlink > 1) return { ok: false, because: HARD_LINK };
    const buf = Buffer.allocUnsafe(Math.min(open.size + 1, COPY_CHUNK));
    let n = 0;
    /* Review 2: never past one byte beyond the size measured, as before #6734, so a file that keeps growing costs at
       most that one byte, not a copy up to the cap. */
    const limit = Math.min(open.size, attachments.MAX_BYTES) + 1;
    while (n < limit) {
      const got = fs.readSync(fd, buf, 0, Math.min(buf.length, limit - n), n);
      if (got === 0) break;
      // Review 4: a failed write is the store's failure (a full disk, say), not the file's, and is said so.
      try { for (let w = 0; w < got;) w += fs.writeSync(out, buf, w, got - w); } catch { return { ok: false, because: 'Kosmos could not store a copy of that file' }; }
      n += got;
    }
    /* Exactly the size the descriptor said (review r7 finding 1): more is a file that grew, fewer one that shrank
       between the fstat and the read, which would otherwise be sent cut. */
    if (n > attachments.MAX_BYTES || n !== open.size) return { ok: false, because: CHANGED };
    return { ok: true, size: n };
  } catch {
    return { ok: false, because: 'that file could not be read' };
  } finally {
    if (fd !== null) try { fs.closeSync(fd); } catch { /* closed */ }
  }
}

/* Review r1 finding 8 / r2 finding 4 (decided): at most this many bytes of reply attachments per agent in any
   24 hours: far above a day of handing a person what was made for them (#6734: two files at the 100 MB cap; kept
   at 200 MB when the cap rose from 25 MB, since this is a brake on a loop, not a measure of one file).
   ⚠️ A BRAKE AGAINST MISTAKES AND RUNAWAY LOOPS, NOT A SECURITY BOUND. The ledger is seeded from the store's
   records (`by: 'agent'`, never the person's uploads), and the store is writable by every process of this user,
   agents included, so an agent determined to send more can rewrite the records the seed reads. It stops an
   agent that sends the same file in a loop, not one that is trying to get past it.
   The total is kept in memory, per agent key, so no reply walks the store: the store is read once, the first time
   any reply asks (`seed`), and each attach adds to it; `discard` takes an unsent copy back off. */
const DAILY_BYTES = 200 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;
let ledger = null;   // key -> Map(id -> { at, size })
function keyOf(sessionName) { try { return store.safeKey(sessionName); } catch { return null; } }
function seed(now = Date.now()) {
  ledger = new Map();
  const base = path.join(attachments.ROOT, 'agent');
  let keys = [];
  try { keys = fs.readdirSync(base); } catch { return; }
  for (const key of keys) {
    let ids = [];
    try { ids = fs.readdirSync(path.join(base, key)); } catch { continue; }
    for (const id of ids) {
      /* Review r6 finding 5: a record folder last changed more than a day ago cannot hold a copy from the last day,
         so the boot read skips it without parsing (a store keeps every upload ever made). */
      try { if (now - fs.statSync(path.join(base, key, id)).mtimeMs >= DAY_MS) continue; } catch { continue; }
      let rec;
      try { rec = JSON.parse(fs.readFileSync(path.join(base, key, id, 'record.json'), 'utf8')); } catch { continue; }
      if (!rec || rec.by !== 'agent' || !Number.isFinite(rec.size)) continue;
      const at = Date.parse(rec.at);
      if (Number.isFinite(at) && now - at < DAY_MS) entriesFor(key).set(id, { at, size: rec.size });
    }
  }
}
function entriesFor(key) {
  if (!ledger.has(key)) ledger.set(key, new Map());
  return ledger.get(key);
}
function ledgerAdd(sessionName, id, at, size) {
  const key = keyOf(sessionName);
  if (!key) return;
  if (!ledger) seed();
  entriesFor(key).set(id, { at: Number.isFinite(at) ? at : Date.now(), size });
}
function sentToday(sessionName, now = Date.now()) {
  const key = keyOf(sessionName);
  if (!key) return 0;
  if (!ledger) seed(now);
  let total = 0;
  for (const [id, e] of entriesFor(key)) {
    if (now - e.at >= DAY_MS) entriesFor(key).delete(id);
    else total += e.size;
  }
  return total;
}

/** Take back a stored copy whose reply was not kept, so nothing is left that no message carries. */
function discard(rec) {
  if (!rec || typeof rec.dir !== 'string' || !inside(attachments.ROOT, rec.dir)) return;
  try { fs.rmSync(rec.dir, { recursive: true, force: true }); } catch { /* best effort */ }
  const key = keyOf(rec.owner);
  if (ledger && key && ledger.has(key)) ledger.get(key).delete(rec.id);
}

module.exports = { attach, discard, typeOf, readOwn, sentToday, seed, setRealpathForTests, OPEN_FLAGS, DAILY_BYTES, NOT_YOURS, HARD_LINK, KEPT_FOR_KOSMOS, WIDE_PROJECT, HIDDEN_IN_HOME, IN_LIBRARY };
