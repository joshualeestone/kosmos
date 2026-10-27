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
/* #7221: how Windows spells a path, read without touching the disk (engine/winpath.js). */
const { classify, isNamespaceSpelling, isLongDrivePath, isDevicePart, driveOf, followableLinkTarget, shareOf, asShareSpelling, isPlainShare, asDrivePath, writtenInside, sameWrittenPath, mayHold } = require('./winpath');

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
const CANNOT_READ = 'that file could not be read';
/* A hard link is the same file under a second name, which may be anywhere on the disk: the name in the
   agent's folder says nothing about where else it lives, so a file with more than one name is refused
   (review r1, finding 3, decided). A copy, not a link, is what the agent sends. */
const HARD_LINK = 'that file has another name somewhere else on this computer (a hard link), so it cannot be attached; attach a copy of it instead';
const NOT_YOURS = 'only a file directly in your Files folder, or inside the folder of a project you are on, can be attached';
/* #7221: the Windows refusals, said as what they are. */
const ON_NETWORK = 'that path is on another computer on the network, or names a device, so it cannot be attached; copy the file into your Files folder and attach it from there';
const DEVICE_NAME = 'that name belongs to a Windows device, not a file, so it cannot be attached';
const STREAM = 'that names a part of a file (an alternate data stream) or a device, not a file, so it cannot be attached';
const TOO_MANY_LINKS = 'that path goes through too many links to follow, so it cannot be attached';
const LONG_FORM = 'write the file\'s path with its drive letter (C:\\...), not in the \\\\?\\ form, to attach it';
const UNREADABLE_LINK = 'that path goes through a link that cannot be followed, so it cannot be attached';
/* A link the walk found listed in its folder but could not lstat: a junction aimed at a share is one (Windows lets a
   junction name only a local volume, so it leads nowhere this computer can read). allowedRoot leaves such a folder of
   another agent unresolved (review 15 finding 1), as it does a link to a share. */
const DEAD_LINK = 'that path goes through a link that leads nowhere this computer can read, so it cannot be attached';
/* Another agent's project folder leads somewhere this cannot place (\Device\..., \\?\GLOBALROOT\..., a stream), so it
   may hold any file and every project file is refused until that row is fixed (review 26 finding 1). Said as what it
   is, so the board's owner can find the row; the Files folder still works. */
const OTHER_FOLDER_UNPLACED = 'another project\'s folder on this computer leads somewhere that cannot be checked, so no project file can be attached until that project\'s folder is fixed; copy the file into your Files folder and attach it from there';

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
function filesRoot(sessionName, filesDir = dmfiles.filesDir(sessionName)) {
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
  /* BigInt (#7221): NTFS file ids are 64-bit, and on the Windows box 434 of 2000 fresh files had one past 2^53, where a
     number ino loses its low bits; 19 pairs of DIFFERENT files then shared a dev:ino key. A wrong match here can put a
     file inside a project it is not in, or inside a folder Kosmos keeps. */
  try { const st = fs.statSync(p, { bigint: true }); return st.dev + ':' + st.ino; } catch { return null; }
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

function allowedRoot(sessionName, real, roster, given, { filesDir, projectList, win = false } = {}) {
  const chain = chainOf(real);
  const filesReal = filesRoot(sessionName, filesDir);
  if (filesReal && chain[1] && chain[1].id && chain[1].id === idOf(filesReal)) return { root: filesReal };
  let all = projectList;
  if (!Array.isArray(all)) { try { all = projects.readAll(); } catch { all = []; } }
  /* #7221 review 1 finding 3: on Windows, a project folder written as a share (\\host\share, which any agent can
     register with `kosmos project create`) is resolved only when the file itself is on that same share: a share's
     real path cannot be a folder above a local file, nor above a file on another share, and resolving it is the SMB
     contact this guards (review 2 finding 3: a file on a mapped-drive project used to resolve every share-written
     project, other agents' included). */
  const fileShare = win ? shareOf(real) : null;
  /* The deepest project holding the file, by identity: the one whose folder is nearest the file in its chain. */
  let best = null;
  /* Projects of OTHER agents left unresolved below. A nested project the agent is not on exists to keep its files
     from the outer project's agents, so skipping it must not let the outer project answer instead (review 5 finding
     1): after the loop, a skipped one whose folder may hold the file refuses the attach. */
  const skippedOthers = [];   // read only after best is the agent's: with no project of its own there, it is refused anyway
  for (const p of all) {
    if (!p || typeof p.folder !== 'string' || !p.folder) continue;
    /* Only ANOTHER agent's project folder is ever left unresolved, and only when it leads to a share. The agent's own
       folders are resolved as on main, a share among them included: the person chose that share (review 11 finding
       2). Another agent's folder written as a share (any agent can register one) is resolved only for a file on that
       same share; one written on a drive is walked first, by lstat and readlink (its \\?\C:\ and \\.\C:\ spellings
       read as the drive path they are), and left unresolved only when the walk says its links lead to a share (review
       3 finding 1). Every other folder, a local link the walk will not follow included, is resolved as on main, so
       identity decides; skipping those let a nested project's files through (review 11 finding 1). A folder written
       as a local volume (\\?\Volume{GUID}\) is walked like a drive path and resolved unless its links lead to a share
       (review 19 finding 1). */
    if (win && !(p.agents || []).includes(sessionName)) {
      const skipped = otherFolderSkip(p.folder, fileShare);
      if (skipped) { skippedOthers.push(skipped); continue; }
    }
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
  const holds = skippedOthers.map((s) => skippedMayHold(s, given, real));
  if (holds.includes('held')) return null;
  if (holds.includes('unplaced')) return { refused: OTHER_FOLDER_UNPLACED };
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

/* Whether allowedRoot leaves ANOTHER agent's project folder unresolved, and if so where its walk says it leads; null
   when the folder is resolved as on main. Left unresolved: a folder written as a share other than the file's; a
   folder whose links lead to a share (or toward one this cannot name); a dead junction; a chain longer than Windows
   follows. `leadsTo` is the share path a link to a plain share names (the rest of the folder's path joined on), so a
   skipped folder is judged by where it goes, never by its own spelling alone (review 16 finding 1). */
function otherFolderSkip(folder, fileShare) {
  /* A folder "holds no files" only when its kind is no-file-namespace (a pipe, a mailslot, a DOS
     device: \\.\pipe\..., \\.\COM1): such a folder leads nowhere, so it cannot make another agent's
     attach refuse (reviews 12 and 23). Any other namespace that names no share may name a drive
     (\\?\GLOBALROOT\...), so it stays unknown and fails closed. */
  /* The skip gate is the network SHAPE, not the kind: a DosDevices drive alias (\??\Global\C:\) is
     networkSpelled, and must be left unresolved exactly as before, even though its kind is a drive. */
  const c = classify(folder);
  if (c.networkSpelled) {
    if (fileShare && c.share === fileShare) return null;
    if (c.kind === 'no-file-namespace') return { folder, kind: 'nowhere', leadsTo: null };
    return { folder, kind: 'share', leadsTo: c.share ? asShareSpelling(folder) : null };
  }
  let leadsTo = null;
  let leadsNowhere = false;
  const noteShare = (cur, to, rest) => {
    const ct = classify(to);
    if (ct.share) leadsTo = asShareSpelling(path.win32.resolve(asShareSpelling(to), ...rest));
    else if (ct.kind === 'no-file-namespace') leadsNowhere = true;
    return false;
  };
  /* A folder written as a local volume (\\?\Volume{GUID}\...) is walked too: it is on this computer, but a link below
     its root can still lead to a share (review 19 finding 1), so the volume spelling is accepted where the walk meets
     it and its parts are lstat'd like a drive path's. */
  const onPath = (reached) => (classify(reached).kind === 'local-volume' ? null : winSpellingRefusal(reached, null));
  const walked = walkLinks(asDrivePath(folder), onPath, 0, noteShare);
  if (walked === ON_NETWORK) return { folder, kind: leadsNowhere ? 'nowhere' : 'share', leadsTo };
  if (walked === DEAD_LINK || walked === TOO_MANY_LINKS) return { folder, kind: 'nowhere', leadsTo: null };
  /* Anything else is resolved as on main, CANNOT_READ included (review 17 finding 3, kept on purpose): lstat refusing
     (EACCES) makes realpath refuse too; readlink fails only for a reparse point Node does not read as a link (a cloud
     placeholder, deduplication, a WSL link), and Win32 does not follow those to another path, so the realpath stays
     on this computer. Leaving such a folder unresolved instead would judge a nested project by spelling alone. */
  return null;
}
/* Whether a project folder of another agent left unresolved may hold the file, erring toward yes. By its own spelling
   first (winpath.mayHold). Then by where it leads: one that leads nowhere holds nothing; one that leads to another
   computer cannot hold a file on this one, and holds a file on a share when the file is under the share it leads to,
   whatever the server is called, or when where it leads cannot be named (review 16 finding 1).
   It answers 'held' when the folder may hold the file, 'unplaced' when it may only because where it leads cannot be
   placed at all, and null when it cannot hold it. allowedRoot says the two refusals differently (review 26 finding 1):
   an agent refused because one project row on the board cannot be placed is told that, not that the file is not in
   a project of its own. */
function skippedMayHold(skipped, given, real) {
  /* A folder whose kind is not a drive, a share or a local volume (a no-file, unplaceable or
     driveless spelling): mayHold answers yes for it whatever the file, so its yes says nothing
     about the file. */
  const fk = classify(skipped.folder).kind;
  const unplaceable = fk !== 'local-drive' && fk !== 'share' && fk !== 'local-volume';
  if (mayHold(skipped.folder, given, real)) return unplaceable ? 'unplaced' : 'held';
  if (skipped.kind === 'nowhere') return null;
  /* A destination that cannot be named may be anywhere, this computer included, so it may hold any file (review 22
     finding 1: a link to \??\Global\C:\... had been read as "another computer" and a local file let through). */
  if (!skipped.leadsTo) return 'unplaced';
  if (!classify(real).networkSpelled) return null;
  return mayHold(skipped.leadsTo, real, real) ? 'held' : null;
}

/* #7226: rule 1 below, found by IDENTITY. The spelling test (given starts with home) misses the same folder spelled
   another way: a different case on a case-insensitive Mac volume (/users/<name>/.aws), or home reached through a link.
   So walk the path as given, one component at a time, and find the component that IS home (device and inode, links in
   the prefix followed, as the open will follow them); a dot name in what comes after it is hidden in home. The dot test
   is on the names as given, which is the point of rule 1: the name the file was reached through. No home id, or a
   prefix that cannot be read: nothing found here, and the spelling test above still applies. */
function givenHiddenUnderHome(given, homeId) {
  if (!homeId) return false;
  /* Review 1: only what follows the root (on Windows the drive or the \\server\\share is the root, and splitting the whole
     path walked it twice and matched nothing); a backslash separates only where it is a separator (on a Mac it is part
     of a name); and a "." segment is no name (as path.relative read it before). */
  const root = path.parse(given).root;
  const parts = given.slice(root.length).split(path.sep === '\\' ? /[\\/]/ : /\//).filter((seg) => seg && seg !== '.');
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) {
    cur = path.join(cur, parts[i]);
    if (idOf(cur) === homeId) return parts.slice(i + 1).some((seg) => seg.startsWith('.'));
  }
  return false;
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
  if (givenHiddenUnderHome(given, k.homeId)) return HIDDEN_IN_HOME;
  const h = k.homeId ? chain.findIndex((c) => c.id === k.homeId) : -1;
  if (h > 0 && chain.slice(0, h).some((c) => c.name.startsWith('.'))) return HIDDEN_IN_HOME;
  if (chain.slice(0, rootDepth).some((c) => c.name.startsWith('.'))) return 'a hidden file, or a file in a hidden folder, cannot be attached';
  return null;
}

/* #7221: on a Windows board, a path is refused by how it is spelled and where its links point BEFORE the first
   realpath, because resolving is itself the contact. Measured on the Windows box (2026-10-26): realpathSync.native
   on a symlink to \\<unroutable host>\share stalled 21 s on an SMB attempt (the board's event loop with it), while
   lstat and readlink on the same link answered in 0 ms and touch nothing past the link itself. So:
   1. The spelling: a \\ or // start (a share, or the \\?\ and \\.\ device namespaces), a colon past the drive
      (an alternate data stream, or COM1:), a last part that is a DOS device name (NUL, COM1.txt), and a drive
      letter that none of the agent's roots (its Files folder, its projects) is on, since a mapped drive is a share
      under a letter. None of these is a file the agent was asked to hand over, so each is refused without a look.
      One exception, the person's own choice: a plain \\host\share path written inside a project folder of the
      agent's that is itself written as that share (review 3 finding 2), as it attached on main.
   2. The links: each part of the path is lstat'd; a link's target is read (readlink) and followed only when it is a
      drive path or a relative one (an allow-list), part by part. Only then is the path resolved.
   3. The real path, once resolved: a network path or a device name there is refused too (a second guard), except
      for a file written inside one of the agent's own project folders, since a project may live on a share.
   And allowedRoot, which resolves every project folder to judge containment, resolves a folder written as a share
   only for a file on that same share (review 1 finding 3, review 2 finding 3), and walks a folder written on a
   drive by rule 2 first, skipping one whose links leave for a share (review 3 finding 1).
   ⚠️ What this does not close (review 1 finding 3, named): (a) a link swapped to point at a share between a walk
   and the realpath after it (the first one, and readOwn's second, which runs the walk again just before it): the
   realpath may already have made the contact, and for a file written inside one of the agent's project folders the
   open is not refused either (a project's files may be share paths by design); everywhere else the open is
   refused; (b) the OTHER folders an attach resolves to judge containment: a project
   folder on a drive letter that is mapped to a share (telling a mapped letter apart needs a call Node does not
   have; the lstat walk of that folder touches the share too, before its realpath does; every registered project
   folder's links are walked on each Windows attach of a project file, cheap on local disks, growing with the
   number of projects), and the folders Kosmos
   itself made (the Files folder and its parent, each agent's folder, ~/.ssh, ~/.config), which a person or a
   process of this user would have to replace with a link to a share; and every agent's RECORDED folder, which for
   a connected agent is its own working folder and may simply be written as a share or a mapped drive: keptRoots
   stats it and instructions.fileFor lstats it on each project-file attach, as on main (#7232); (c) a share is
   matched by how it is WRITTEN (review 4 finding 2): a project written \\fileserver\x whose real path reads
   \\10.0.0.5\x (or a DFS path, or another name for the server) is not matched to its files, which are then refused,
   where main matched by identity. Write the project folder as Windows resolves it; (d) a link that IS one of the
   agent's project folders is followed onto a share only when the walk reaches it as written: a project written
   C:\work\proj where C:\work is itself a link (to D:\work) is met as D:\work\proj, does not match, and its share
   files are refused, where main attached them (the safe direction; write the project folder as it resolves);
   (e) an AGENT can make the board contact a share it names: register a project at \\host\share (kosmos project
   create), then attach from it, since a share project is the one place a share path is allowed. Project create
   resolves the folder already, so the contact happens there first; refusing it here would close nothing. Closing it
   belongs at project create (#7229). */
/* The agent's roots: `drives`, the letters every root is written on or reaches through its own links, and `folders`, the
   agent's own project folders (on a drive letter, or a plain share). A project may live on a share, written as a
   mapped drive (projects.js opens "a Z:\ record whose realpath is \\server\share") or as \\server\share itself; that
   is the person's own choice of folder, and those files attached on main. So a file written inside one of these
   folders may be on a share: winSpellingRefusal lets a \\host\share spelling through only there (review 3 finding 2),
   and winRealRefusal a share real path only there (review 1 finding 2, narrowed in review 2 finding 2 from the bare
   drive letter, which on a box with Files and projects all on C: let every attach through). The agent's Files folder
   is one of these folders too: a CONNECTED agent's Files sits beside its own working folder, which may be on a
   mapped drive or a share, and those files attached on main (review 17 finding 1). */
function agentRoots(sessionName, filesDir, projectList) {
  const drives = new Set();
  const folders = [];          // every folder of the agent's, Files included: rule 1's share exception
  const projectFolders = [];   // the project folders alone: the second guard's exemption (Files has its own)
  const walkFrom = [];
  const addDrivePath = (p) => { drives.add(driveOf(p)); walkFrom.push(asDrivePath(p)); };
  let filesFolder = null;
  const filesKind = typeof filesDir === 'string' ? classify(filesDir).kind : null;
  if (filesKind === 'local-drive') { addDrivePath(filesDir); filesFolder = filesDir; }
  else if (filesKind === 'share') filesFolder = asShareSpelling(filesDir);
  if (filesFolder) folders.push(filesFolder);
  for (const p of projectList) {
    if (!p || typeof p.folder !== 'string' || !(p.agents || []).includes(sessionName)) continue;
    const fk = classify(p.folder).kind;
    if (fk === 'local-drive') addDrivePath(p.folder);
    /* A share written \\?\UNC\host\share is read as \\host\share (review 12 NIT). A local volume written without a
       letter adds nothing here: its files named by a drive path on a drive no other root reaches are refused, the safe
       direction (named in the plan). */
    if (fk === 'local-drive') projectFolders.push(p.folder);
    else if (fk === 'share') projectFolders.push(asShareSpelling(p.folder));
  }
  folders.push(...projectFolders);
  /* `cache` is an object every copy of these roots shares (winLinkRefusal works on a copy), so the roots' links are
     walked once per attach, the readOwn recheck included (review 24 finding 1). */
  return { drives, folders, projectFolders, filesFolder, walkFrom, cache: { reached: null } };
}
/* Whether a root is on drive `d`, as written or through its own links. A root written on C: may live on D: through a
   junction or link on its way (C:\Users\me\work -> D:\work), and a path the walk follows onto D: is then judged on D:,
   as it was by identity on main (review 4 finding 1). The roots' links are walked only when the written drives do not
   answer, and once per attach (review 5 finding 2): a file directly in Files never touches a project folder, which may
   be on a mapped drive whose server is down. ⚠️ Named (review 6 finding 2): a path on a drive no root is written on
   (any caller of /api/reply can name Q:\x) does walk the agent's OWN roots, so one of its own projects on a mapped
   drive whose server is down stalls that attach, as any attach of a file in that project already would. */
function rootReaches(roots, d) {
  if (roots.drives.has(d)) return true;
  const cache = roots.cache || (roots.cache = { reached: null });
  if (!cache.reached) {
    cache.reached = new Set();
    for (const f of roots.walkFrom || []) drivesReached(f, cache.reached);
  }
  return cache.reached.has(d);
}
/* Add to `out` the drive `p` is written on and every drive its links lead to, followed as winLinkRefusal follows
   them (lstat and readlink, the allow-list of targets, at most MAX_HOPS links). Stops quietly where the walk would
   refuse or cannot read: a root it cannot walk adds only the drives seen so far. */
function drivesReached(p, out) {
  walkLinks(p, (reached) => {
    const d = driveOf(reached);
    if (!d) return 'not on a drive';   // stops the walk; why is not needed here
    out.add(d);
    return null;
  });
}
function readProjects() {
  let all = [];
  try { all = projects.readAll(); } catch { all = []; }
  return Array.isArray(all) ? all : [];
}
/* Whether `given` is a plain \\host\share path written inside one of the agent's own folders that is itself written as
   a share (a project, or a connected agent's Files): the person's own choice of share (rule 1's one exception). */
function inOwnShareFolder(given, roots) {
  return !!roots && isPlainShare(given) && roots.folders.some((f) => isPlainShare(f) && writtenInside(given, f));
}
/* The refusal for a Windows path by its spelling alone, or null. Called before anything touches the path. `roots`
   is the agent's (agentRoots); null when the path is a project folder being checked, with no owner to compare. */
function winSpellingRefusal(given, roots) {
  const c = classify(given);
  const share = isNamespaceSpelling(given) || c.networkSpelled;   // \\..., and an NT \??\UNC\... too (review 21 NIT)
  /* A local drive path written in its long form (\\?\C:\, \\.\C:\, \??\C:\) is refused too, as main never had to: the
     rules below compare spellings (a hidden folder of home, a project folder), and it does not start the way they do.
     It is said as what it is, not as a network path or a stream (review 13 NIT, review 18 NIT). */
  if (roots && (isLongDrivePath(given) || c.kind === 'local-volume')) return LONG_FORM;   // a local volume too (review 24 NIT)
  /* Every \\ or // start is refused (a share, the \\?\ and \\.\ namespaces), but a plain \\host\share path written
     inside one of the agent's own share-written folders. */
  if (share && !inOwnShareFolder(given, roots)) return ON_NETWORK;
  if (given.indexOf(':', 2) >= 0) return STREAM;
  const parts = given.split(/[\\/]+/).filter(Boolean);
  if (parts.length && isDevicePart(parts[parts.length - 1])) return DEVICE_NAME;
  if (roots && !share) {
    if (!c.drive || !rootReaches(roots, c.drive)) return NOT_YOURS;
  }
  return null;
}
/* Why a link target that is not followed is refused. Local only when it names a local volume (an allow-list, as for
   the targets that are followed): anything else is said as "may reach another computer", ON_NETWORK, so allowedRoot
   leaves such another agent's folder unresolved and fails closed. A deny-list of share spellings missed the many ways
   the object manager reaches the share redirector (\??\Global\UNC\..., \??\GLOBALROOT\GLOBAL??\UNC\...,
   \Device\LanmanRedirector\..., WebDAV), whose realpath is the contact (review 14 finding 1). */
function unfollowedLinkRefusal(to) {
  return classify(String(to)).kind === 'local-volume' ? UNREADABLE_LINK : ON_NETWORK;
}
/* Follow the links in `p` by lstat and readlink only, and say why not if any of them leaves for the network, a
   device or a drive outside the roots. Null when the path may be resolved. A chain of more than MAX_HOPS links is
   refused. */
/* More than Windows itself follows (63 reparse points in one resolution): a path the walk gives up on, Windows cannot
   resolve either, so it holds no file and its realpath reaches no other computer (review 16). */
const MAX_HOPS = 64;
/* Reads the folder's names, so it is asked only after an lstat ENOENT (a missing part, usually a mistyped name). The
   name is matched in any case: a junction aimed at a share lstats ENOENT in EVERY case, so an exact match would let
   the same junction typed in another case through to realpath (review 7 finding 1). In a case-sensitive folder the
   cost is a mistyped case refused as an unfollowable link rather than "no file": the safe direction. */
function listed(p) {
  const name = path.win32.basename(p).toLowerCase();
  try { return fs.readdirSync(path.win32.dirname(p)).some((n) => n.toLowerCase() === name); } catch { return false; }
}
function winLinkRefusal(p, roots) {
  /* One link the walk follows that the allow-list would not: one of the agent's own project folders that is itself a
     link to a plain share (C:\x\proj -> \\host\share\proj), the person's choice of folder as a mapped drive is (review
     11 finding 2). The share it names is then treated as one of the agent's project folders for the rest of the walk,
     so the walk goes on down it and still refuses a link further down that leaves for another share (review 12
     finding 1). winRealRefusal later lets the share real path through as a project file. */
  const view = roots ? { ...roots, folders: roots.folders.slice() } : null;
  const ownShareProject = (linkPath, to) => {
    if (!view || !isPlainShare(to) || !roots.folders.some((f) => classify(f).kind === 'local-drive' && sameWrittenPath(linkPath, f))) return false;
    view.folders.push(to);
    return true;
  };
  return walkLinks(p, (reached) => winSpellingRefusal(reached, view), 0, ownShareProject);
}
/* The one link walk (review 9 finding 2: drivesReached had its own copy). Each path the walk reaches, the given one and
   then each followed link's resolved path, is shown to `onPath` before its parts are read; a sentence from onPath, or
   from the walk itself, stops it and is returned. Null: the walk reached the end with nothing refused. */
function walkLinks(p, onPath, hops = 0, acceptLink = null) {
  if (hops >= MAX_HOPS) return TOO_MANY_LINKS;
  const why = onPath(p);
  if (why) return why;
  const root = path.win32.parse(p).root;
  const parts = p.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let cur = root;
  for (let i = 0; i < parts.length; i++) {
    cur = path.win32.join(cur, parts[i]);
    let lst;
    try { lst = fs.lstatSync(cur); } catch (err) {
      /* ENOENT: missing, or a junction aimed at a share (Windows lets a junction name only a local volume), which
         lstats ENOENT and readlinks EINVAL while its folder lists it as a link (measured 2026-10-26). So the folder is
         asked, a local read: an entry under that name is a link this walk cannot follow, refused rather than handed
         to realpath; no entry is really missing, and the realpath that follows says so. Any other error (EACCES,
         EPERM) is a part that cannot be read, said as that (review 1 finding 4). */
      /* A part missing here ends the walk: the realpath that follows answers ENOENT for it. A part made between this
         walk and that realpath (a link to a share, say) is never walked: the swap window the header names as (a). */
      if (!err || err.code !== 'ENOENT') return CANNOT_READ;
      return listed(cur) ? DEAD_LINK : null;
    }
    if (!lst.isSymbolicLink()) continue;
    let to;
    try { to = fs.readlinkSync(cur); } catch { return CANNOT_READ; }
    const target = followableLinkTarget(to);
    if (target === null) {
      if (!acceptLink || !acceptLink(cur, to, parts.slice(i + 1))) return unfollowedLinkRefusal(to);
      return walkLinks(path.win32.resolve(to, ...parts.slice(i + 1)), onPath, hops + 1, acceptLink);
    }
    const next = path.win32.resolve(path.win32.dirname(cur), target, ...parts.slice(i + 1));
    return walkLinks(next, onPath, hops + 1, acceptLink);
  }
  return null;
}
/* Where the agent's Files folder really is. Read with the real realpath, never the test seam, which stands in for the
   FILE's resolution: the folder's own location is a fact about the agent, not part of the swap a test simulates. */
function filesFolderReal(filesFolder) {
  try { return fs.realpathSync.native(filesFolder); } catch { return ''; }
}
/* The second guard. A share real path is let through for a file written inside one of the agent's project folders,
   and for one written inside its Files folder only when that folder ITSELF resolves to a share (a connected agent
   working on a mapped drive or a share, review 17 finding 1): a Files folder on this computer keeps the guard, so a
   path swapped onto a share between the walk and the realpath is still refused before the open. */
function winRealRefusal(real, given, roots) {
  if (classify(real).networkSpelled) {
    const inProject = roots.projectFolders.some((f) => writtenInside(given, f));
    const inSharedFiles = !inProject && !!roots.filesFolder && writtenInside(given, roots.filesFolder)
      && classify(filesFolderReal(roots.filesFolder)).networkSpelled;
    if (!inProject && !inSharedFiles) return ON_NETWORK;
  }
  if (isDevicePart(path.win32.basename(real))) return DEVICE_NAME;
  return null;
}

/**
 * Copy one of the agent's own files into the attachment store.
 * Returns { ok: true, rec } (rec as attachments.save returns it) or { ok: false, because }.
 */
function attach(sessionName, given, { roster, platform = process.platform } = {}) {
  if (typeof given !== 'string' || !given || given.includes('\0')) return { ok: false, because: 'name the file to attach by its path' };
  if (!path.isAbsolute(given)) return { ok: false, because: 'give the full path of the file to attach' };
  if (given.split(/[\\/]/).includes('..')) return { ok: false, because: 'a path with .. in it cannot be attached; give the file\'s own full path' };
  const win = platform === 'win32';
  /* Read once on Windows and handed on: an attach still reads each agent's instructions path once (r5-3), and the
     projects list once (review 1 finding 6). Elsewhere allowedRoot reads both itself, as before. */
  const filesDir = win ? dmfiles.filesDir(sessionName) : undefined;
  const projectList = win ? readProjects() : undefined;
  const roots = win ? agentRoots(sessionName, filesDir, projectList) : null;
  if (win) {
    const why = winLinkRefusal(given, roots);
    if (why) return { ok: false, because: why };
  }
  let real;
  try { real = realOf(given); } catch (err) {
    return { ok: false, because: err && err.code === 'ENOENT' ? 'there is no file at ' + given : CANNOT_READ };
  }
  if (win) {
    const why = winRealRefusal(real, given, roots);
    if (why) return { ok: false, because: why };
  }
  let st;
  /* BigInt, so readOwn compares the open file with this one by its exact id (#7221; see idOf). */
  try { st = fs.statSync(real, { bigint: true }); } catch { return { ok: false, because: CANNOT_READ }; }
  if (st.isDirectory()) return { ok: false, because: 'that is a folder; attach one file at a time' };
  if (!st.isFile()) return { ok: false, because: 'that is not an ordinary file, so it cannot be attached' };
  if (Number(st.nlink) > 1) return { ok: false, because: HARD_LINK };
  const size = Number(st.size);
  const where = allowedRoot(sessionName, real, roster, given, { filesDir, projectList, win });
  if (!where) return { ok: false, because: NOT_YOURS };
  if (where.refused) return { ok: false, because: where.refused };
  if (size > attachments.MAX_BYTES) {
    // Review 5: "larger than", not its rounded size, which reads "100 MB" just past a 100 MB cap.
    return { ok: false, because: 'that file is larger than ' + attachments.MAX_WORDS + ', the most a conversation carries; tell them where it is saved instead' };
  }
  if (size === 0) return { ok: false, because: 'there is nothing in that file' };
  const used = sentToday(sessionName);
  if (used + size > DAILY_BYTES) {
    return { ok: false, because: 'you have attached ' + attachments.sizeWords(used) + ' to your replies in the last 24 hours, and an agent can attach up to 200 MB a day; tell them where this one is saved instead' };
  }
  const name = path.basename(real);   // review r2 finding 5: the file's own name, not a link's (report.pdf -> notes.txt is notes.txt)
  try {
    /* #6734: copied across in chunks into the stored file, never held whole; a refused read leaves nothing stored. */
    const kept = attachments.saveFilled('agent', sessionName, { name, type: typeOf(name), by: 'agent' }, (out) => readOwn(real, st, given, out, { recheck: win ? () => winLinkRefusal(given, roots) : null }));
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
/* Whether two stats name one file. Exact when both carry BigInt ids (attach and readOwn's own reads do); a caller that
   passes number stats (a test, say) is compared as numbers, as before, with the precision those keep. */
function sameFile(a, b) {
  if (typeof a.ino === 'bigint' && typeof b.ino === 'bigint') return a.dev === b.dev && a.ino === b.ino;
  return Number(a.dev) === Number(b.dev) && Number(a.ino) === Number(b.ino);
}
/* `recheck` (#7221 review 21 finding 2): on Windows, the link walk again, run just before the given path is resolved a
   second time below, so a link swapped onto a share since the first walk is refused before that realpath, not after
   it. The window this leaves is only the walk-to-realpath gap the header names as (a). */
function readOwn(real, st, given, out, { recheck = null } = {}) {
  if (typeof given !== 'string' || !given) return { ok: false, because: CHANGED };   // required (review r6 finding 3)
  let fd = null;
  try {
    fd = fs.openSync(real, OPEN_FLAGS);
    /* Review r2 finding 7 (decided): the given path is resolved again once the file is open, and must still land
       on `real`. With the dev/ino compare below, a folder above the file swapped between the check and the open is
       caught too, not only the last component. */
    /* Once (review r6 finding 3): the descriptor's own facts, used for every check below. BigInt, so the identity
       compares below are exact (#7221; see idOf). */
    const open = fs.fstatSync(fd, { bigint: true });
    const openSize = Number(open.size);
    let again = null;
    if (recheck && recheck()) return { ok: false, because: CHANGED };
    try { again = realOf(given); } catch { again = null; }
    if (again !== real) return { ok: false, because: CHANGED };
    /* Review r3 finding 4: and the file at `real` now must be the one the descriptor holds. This narrows the
       window to a DOUBLE swap (swap a folder, open, swap it back before these reads); it does not close one, since
       Node has no openat walk that would hold each folder open on the way down. */
    let now = null;
    try { now = fs.statSync(real, { bigint: true }); } catch { now = null; }
    if (!now || !sameFile(now, open)) return { ok: false, because: CHANGED };
    if (!open.isFile() || !sameFile(open, st)) return { ok: false, because: CHANGED };
    if (Number(open.nlink) > 1) return { ok: false, because: HARD_LINK };
    const buf = Buffer.allocUnsafe(Math.min(openSize + 1, COPY_CHUNK));
    let n = 0;
    /* Review 2: never past one byte beyond the size measured, as before #6734, so a file that keeps growing costs at
       most that one byte, not a copy up to the cap. */
    const limit = Math.min(openSize, attachments.MAX_BYTES) + 1;
    while (n < limit) {
      const got = fs.readSync(fd, buf, 0, Math.min(buf.length, limit - n), n);
      if (got === 0) break;
      // Review 4: a failed write is the store's failure (a full disk, say), not the file's, and is said so.
      try { for (let w = 0; w < got;) w += fs.writeSync(out, buf, w, got - w); } catch { return { ok: false, because: 'Kosmos could not store a copy of that file' }; }
      n += got;
    }
    /* Exactly the size the descriptor said (review r7 finding 1): more is a file that grew, fewer one that shrank
       between the fstat and the read, which would otherwise be sent cut. */
    if (n > attachments.MAX_BYTES || n !== openSize) return { ok: false, because: CHANGED };
    return { ok: true, size: n };
  } catch {
    return { ok: false, because: CANNOT_READ };
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

/* winSpellingRefusal is exported for engine/replyfile.win32-7221.test.js only; nothing else should call it (review 4
   NIT). The pure path rules it builds on are engine/winpath.js. */
module.exports = { attach, discard, typeOf, readOwn, sentToday, seed, setRealpathForTests, OPEN_FLAGS, DAILY_BYTES, NOT_YOURS, HARD_LINK, KEPT_FOR_KOSMOS, WIDE_PROJECT, HIDDEN_IN_HOME, IN_LIBRARY, ON_NETWORK, DEVICE_NAME, UNREADABLE_LINK, STREAM, LONG_FORM, TOO_MANY_LINKS, DEAD_LINK, OTHER_FOLDER_UNPLACED,
  winSpellingRefusalForTests: winSpellingRefusal };
