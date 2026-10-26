'use strict';

/**
 * kosmos#5536 (E0.7, restore) slice 4b: the Kosmos a snapshot is restored into, and the restored agents LISTED, never
 * registered. Design: #5536 comment 6407859949; the enable path measured on comment 6408905798.
 *
 * A snapshot holds files only (engine/backuptick.js rootsFor: workers, projects, projects kept elsewhere, agent folders
 * kept elsewhere, transcripts), never Kosmos's own store. So a restore brings back no agent records, schedules or
 * memberships, and nothing here makes any: an agent comes back as a folder, stopped, until the person enables it on the
 * review screen (slice 4c), one at a time, through create.installJob. That call STARTS the agent (measured: enable then
 * bootstrap), which is why nothing in this module calls it.
 *
 *   prepareRestoreWorld   makes "Restored: <member>, <date>" with worlds.createWorld, and a private, empty folder
 *                         inside it for engine/restoresink.js (createWorld pre-makes store, projects and workers, and
 *                         the sink needs an empty root)
 *   finishRestoreWorld    after a restore that succeeded and whose sink is closed: moves the restored `workers` and
 *                         `projects` into the world's own (a rename within the world folder, so one volume
 *                         unless something is mounted inside it, which then shows as a failed move)
 *   listRestoredAgents    the agent folders the review screen offers, each with why it cannot be enabled if it cannot,
 *                         and the files in it that run or load something when the agent starts
 *
 * ⚠️ NOT REQUIRED BY worlds.js, and create.js only lazily, for the same reason as engine/worldimport.js: create freezes
 * store.ROOT at require.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');
const worlds = require('./worlds');
const { TEMP_PREFIX } = require('./restoresink');

const RESTORE_DIR = 'restored';                  // inside the world folder; what was not moved stays here, and is shown
/* Inside the restore folder, one per finish run: `held-back-<random>`, made new each time, so a snapshot cannot
   supply it in advance (its root names are chosen by whoever made the backup). */
const HELD_PREFIX = 'held-back-';
/* In the world folder, which a snapshot never writes: what each finish run held back (so a rerun still names it), and
   the lock one finish holds while it runs. */
const HELD_RECORD = 'restore-held-back.json';
const FINISH_LOCK = 'restore-finishing';
const MOVED = ['workers', 'projects'];           // the roots that become the world's own
const MAX_NAME_TRIES = 9;
const MAX_MEMBER_CHARS = 60;
const MAX_LISTED = 1000;
const BRIEFS = ['CLAUDE.md', 'AGENTS.md', 'AGENTS.override.md', 'GEMINI.md'];
const MAX_BRIEF_BYTES = 512 * 1024;
const MAX_ENTRIES_READ = 4 * MAX_LISTED;          // entries read from any one folder; past it the listing says `more`
const MAX_BRIEF_TOTAL = 32 * 1024 * 1024;         // brief bytes read across one listing (one brief may run past it)
const RENAME_RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);   // Windows: a scanner holding a just-written file
/* What in a folder a provider may read or run when it starts there: every dot-entry at its top (settings, hooks,
   skills, MCP servers, an environment file, any provider's own folder, git) except HARMLESS, and these plain names. */
const PLAIN_AT_START = ['CLAUDE.local.md', 'opencode.json', 'opencode.jsonc', 'node_modules'];   // compared folded, as APFS and NTFS open them
/* A git folder's config (core.fsmonitor, core.hooksPath) runs commands when git runs there, which a provider does as
   soon as an agent starts. So an agent folder holding one is not offered, and one in the workers folder blocks all. */
const GIT = '.git';
const HARMLESS = new Set(['.DS_Store']);   // Finder's own metadata, which no provider reads
/* Git also reads a folder as a repository with no .git at all: HEAD with objects and refs (a bare layout, accepted by
   default), or HEAD with a commondir file naming where they are. A top-level HEAD is therefore treated as git. */
const BARE = 'HEAD (git can read a folder holding it as a repository)';
const CUT = '(the folder holds more entries than were checked)';
const UNREADABLE = '(the folder could not be read)';
const GIT_WHY = 'git runs its settings here (hooks, fsmonitor) when an agent uses git in this folder';
/* Characters that draw nothing or only alter the one before, beside the classes cleanText drops: braille blank,
   Hangul and Khmer fillers, Mongolian and other variation selectors, the object replacement character. */
const BLANKS = new RegExp(`[${[0x2800, 0x3164, 0xffa0, 0x115f, 0x1160, 0x17b4, 0x17b5, 0x180b, 0x180c, 0x180d, 0x034f, 0xfffc, ...Array.from({ length: 16 }, (_, i) => 0xfe00 + i), ...Array.from({ length: 240 }, (_, i) => 0xe0100 + i)].map((c) => String.fromCodePoint(c)).join('')}]`, 'gu');

/* Attacker-written text made safe to show: control, format, bidi, private-use and blank characters dropped, at most
   two combining marks per character, spaces collapsed, cut at `max` code points; `fallback` when nothing visible is
   left. */
function cleanText(text, max, fallback) {
  const s = String(text == null ? '' : text).normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cs}]/gu, '')
    .replace(BLANKS, '')
    .replace(/(\p{M}{2})\p{M}+/gu, '$1')
    .replace(/\s+/g, ' ').trim();
  const cut = Array.from(s).slice(0, max).join('').trim();
  return cut || fallback;
}
const cleanMember = (member) => cleanText(member, MAX_MEMBER_CHARS, 'a member');

function dayOf(now) {
  const d = new Date(Number.isFinite(now) ? now : Date.now());
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function worldName(member, now, attempt = 1) {
  const base = `Restored: ${cleanMember(member)}, ${dayOf(now)}`;
  return attempt > 1 ? `${base} (${attempt})` : base;
}

function takenIds(base) {
  try { return new Set(worlds.readRegistry(base).worlds.map((w) => w.id)); } catch { return new Set(); }
}

/* The world's registry row is there and not hidden: a hidden Kosmos is off the list and cannot be switched to, so
   nothing is moved into it or offered from it. */
function onTheList(base, id) {
  try { return worlds.readRegistry(base).worlds.some((w) => w.id === id && !w.hiddenAt); } catch { return false; }
}

/* opts: { member, now?, createWorld?, hideWorld? } (the two world calls injectable for tests).
   { ok: true, world, dir, restoreDir } or { ok: false, because }. */
function prepareRestoreWorld(base, opts = {}) {
  const create = opts.createWorld || worlds.createWorld;
  const hide = opts.hideWorld || worlds.hideWorld;
  if (typeof base !== 'string' || !path.isAbsolute(base)) return { ok: false, because: 'the restore was asked without a place for its Kosmos' };
  let world = null, leftovers = 0;
  for (let n = 1; n <= MAX_NAME_TRIES && !world; n++) {
    const name = worldName(opts.member, opts.now, n);
    try { world = create(base, name); } catch (e) {
      // Taken (a hidden Kosmos keeps its id too): try the next name. Anything else is a failure.
      if (takenIds(base).has(store.safeKey(name))) continue;
      if (e && e.code === 'EWORLDLOCK') return { ok: false, because: 'another change to your Kosmos list is under way, so try again in a moment' };
      return { ok: false, because: 'the Kosmos for the restore could not be made' };
    }
    // createWorld reuses a world folder already on disk (its mkdirs are recursive). One left behind keeps its files
    // under the hidden row and is never handed to this restore: only a world whose folders are all new and empty is.
    if (!freshWorld(worlds.worldBaseDir(base, world))) {
      // Set aside before the next name is tried: left on the list, its unreviewed folders would be one switch away.
      try { hide(base, world.id); } catch {
        return { ok: false, because: `a Kosmos folder already on this computer under that name could not be set aside, so "${world.name}" is on your list holding files from before this restore; hide it before you open it` };
      }
      world = null;
      leftovers += 1;
    }
  }
  if (!world && leftovers) return { ok: false, because: `Kosmos folders already on this computer took ${leftovers} of the ${MAX_NAME_TRIES} names tried, so no restored Kosmos could be made today` };
  if (!world) return { ok: false, because: `there are already ${MAX_NAME_TRIES} restored Kosmoses for this member today; hide one and try again` };
  const dir = worlds.worldBaseDir(base, world);
  const restoreDir = path.join(dir, RESTORE_DIR);
  try {
    fs.mkdirSync(restoreDir, { mode: 0o700 });   // not recursive: it must be new, and the sink refuses a non-empty root
  } catch {
    let hidden = true;
    try { hide(base, world.id); } catch { hidden = false; }
    return { ok: false, because: hidden ? 'the folder for the restore could not be made, so the new Kosmos was hidden again'
      : `the folder for the restore could not be made, and the new, empty Kosmos "${world.name}" could not be hidden again` };
  }
  return { ok: true, world, dir, restoreDir };
}

function freshWorld(dir) {
  const leaves = [store.APP, 'projects', 'workers'];
  if (!realDir(dir)) return false;
  try {
    if (!fs.readdirSync(dir).every((n) => leaves.includes(n))) return false;
    return leaves.every((leaf) => realDir(path.join(dir, leaf)) && fs.readdirSync(path.join(dir, leaf)).length === 0);
  } catch { return false; }
}

function realDir(p) {
  try { const st = fs.lstatSync(p); return st.isDirectory() ? st : null; } catch { return null; }
}

/* The world folder for `world` under an absolute `base`, or null. */
function worldDirOf(base, world) {
  if (typeof base !== 'string' || !path.isAbsolute(base)) return null;
  try { return worlds.worldBaseDir(base, world); } catch { return null; }
}

function renameRetrying(src, dst) {
  for (let attempt = 1; ; attempt++) {
    try { fs.renameSync(src, dst); return; } catch (e) {
      if (process.platform !== 'win32' || !RENAME_RETRY_CODES.has(e && e.code) || attempt >= 8) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100 * attempt);
    }
  }
}

/* After a restore that SUCCEEDED, and after its sink is closed. opts: { base, world, restoreDir, result } where
   `result` is engine/restorerun.js runRestore's answer, which must be ok.
   { ok, moved: [name], kept: [label], heldBack: [label], failedFiles, fetchProblems, because? }, the same shape on
   every path. `failedFiles` counts the files runRestore listed as failed (it answers ok with some failed, since one
   damaged file does not fail the rest), and `fetchProblems` carries its reasons why some were not fetched.
   Only plain-named folders at the top of each root become the world's: everything else there (dot-entries, HEAD,
   node_modules, files, links) is held back in `restored/held-back-<random>/<root>/` and named in `heldBack`, because
   the top of workers or projects is above every agent and project the person makes in this world later, where
   nothing reviews it.
   Every check runs before anything moves, so a refusal moves nothing; a failure part way says what moved, and
   finishing again carries on. */
function finishRestoreWorld(opts = {}) {
  const { base, world, restoreDir } = opts;
  let moved = [], failedFiles = 0, fetchProblems = [];
  const dir = worldDirOf(base, world);
  const answer = (ok, because) => {
    const recorded = recordedHeld(dir);
    return Object.assign({ ok, moved, kept: keptIn(restoreDir, base, world).filter((n) => !recorded.includes(n)),
      heldBack: heldIn(restoreDir, recorded), failedFiles, fetchProblems }, because ? { because } : {});
  };
  const refuse = (because) => ({ ok: false, moved: [], kept: [], heldBack: [], failedFiles: 0, fetchProblems: [], because });
  if (!dir || !realDir(dir)) return refuse('the restore did not name its Kosmos');
  if (!opts.result || opts.result.ok !== true) return refuse('the restore did not succeed, so its files stay where it can continue');
  if (!onTheList(base, world.id)) return refuse('this is not a Kosmos on your list, so nothing is moved into it');
  const inner = opts.result.result;
  const notListed = inner && Number.isSafeInteger(inner.failedNotListed) && inner.failedNotListed > 0 ? inner.failedNotListed : 0;
  failedFiles = (inner && Array.isArray(inner.failed) ? inner.failed.length : 0) + notListed;
  // Why files were not fetched (a grant refused part way, files under an earlier key), for the screen beside the count.
  const problems = (Array.isArray(opts.result.fetchProblems) ? opts.result.fetchProblems : []).filter((x) => typeof x === 'string');
  fetchProblems = problems.slice(0, 20).map((x) => cleanText(x, 300, '')).filter(Boolean);
  if (problems.length > 20) fetchProblems.push('(more not listed)');
  if (restoreDir !== path.join(dir, RESTORE_DIR) || !realDir(restoreDir)) return refuse('the restore folder is not the one made for this Kosmos');
  const lock = takeFinishLock(dir);
  if (lock.busy) return refuse('a finish of this restore is already under way (a finish that stopped frees it within ten minutes)');
  if (!lock.release) return refuse(`the new Kosmos's folder could not be locked for the finish (${lock.code})`);
  try { return finishLocked(); } finally { lock.release(); }
  function finishLocked() {
    // A stopped restore keeps its record, an open sink holds its lock, and a crashed one leaves its temp folder: any of
    // the sink's own entries means the restore is not finished, and it continues in this folder (slice 3).
    let names;
    try { names = fs.readdirSync(restoreDir); } catch { names = null; }
    if (!names) return refuse('the restore folder could not be read');
    if (names.some((n) => n.toLowerCase().startsWith(TEMP_PREFIX))) {   // folded, as the sink reserves them
      return refuse('this restore has not finished, so its files stay where it can continue');
    }
    const roots = worlds.envOverridesFor(base, world);
    const target = { workers: roots.AGENT_WORKFORCE_WORKERS, projects: roots.AGENT_WORKFORCE_PROJECTS };
    const plan = [];
    for (const name of MOVED) {
      const src = path.join(restoreDir, name);
      let st = null;
      try { st = fs.lstatSync(src); } catch (e) {
        if (e && e.code === 'ENOENT') continue;   // a snapshot without projects has nothing to move
        return refuse(`the restored ${name} could not be checked`);
      }
      if (!st.isDirectory()) return refuse(`the restored ${name} is not a folder`);
      const dst = target[name];
      if (!realDir(dst)) return refuse(`the new Kosmos has no ${name} folder to receive it`);
      let inside;
      try { inside = fs.readdirSync(dst).filter((n) => !HARMLESS.has(n)); } catch { inside = null; }   // Finder's own file does not count
      if (!inside || inside.length) return refuse(`the new Kosmos already has files in its ${name} folder`);
      let top;
      try { top = fs.readdirSync(src); } catch { return refuse(`the restored ${name} could not be read`); }
      const hold = top.filter((n) => !plainFolder(src, n));
      plan.push({ name, src, dst, hold });
    }
    // Between the checks and the renames only this user's own processes can change these folders (the sink assumes the
    // same: the restore folder is private to the person).
    const heldName = path.join(restoreDir, HELD_PREFIX + crypto.randomBytes(6).toString('hex'));
    let heldMade = false;
    for (const { name, src, dst, hold } of plan) {
      try {
        if (hold.length && !heldMade) {
          // Recorded before the folder is made, so no held-back folder of this run is ever unrecorded (a later run
          // would list it as kept); heldIn lists only what is actually in it.
          recordHeld(dir, path.basename(heldName));
          fs.mkdirSync(heldName, { mode: 0o700 });   // new: refuses one already there
          heldMade = true;
        }
        if (hold.length) fs.mkdirSync(path.join(heldName, name), { mode: 0o700 });
        for (const n of hold) renameRetrying(path.join(src, n), path.join(heldName, name, n));
      } catch (e) {
        const code = e && typeof e.code === 'string' ? ` (${e.code})` : '';
        return answer(false, `the top of the restored ${name} could not be set aside${code}`);
      }
      try {
        if (!realDir(dst)) throw Object.assign(new Error('the target changed'), { code: 'ECHANGED' });
        for (const n of HARMLESS) { try { fs.unlinkSync(path.join(dst, n)); } catch { /* absent */ } }
        fs.rmdirSync(dst);
        renameRetrying(src, dst);
        moved.push(name);
      } catch (e) {
        let back = 'ok';
        let there = true;
        try { fs.lstatSync(dst); } catch { there = false; }
        if (!there) { try { fs.mkdirSync(dst); } catch { back = 'failed'; } } else if (!realDir(dst)) back = 'other';
        const code = e && typeof e.code === 'string' ? ` (${e.code})` : '';
        const after = back === 'failed' ? `, and its empty ${name} folder could not be put back`
          : back === 'other' ? `, and something other than a folder is now where its ${name} folder was` : '';
        return answer(false, `the restored ${name} could not be moved into the new Kosmos${code}${after}`);
      }
    }
    return answer(true);
  }
}

/* One finish at a time per world: a lock folder holding the owner's pid, made whole in a temporary folder and renamed
   into place, so a lock never exists without its pid (a rename onto an existing lock fails). A lock is stale when its
   process is gone, when it is older than FINISH_LOCK_STALE_MS (a recycled pid can look alive), or when it has no
   readable pid and is older than FINISH_LOCK_PIDLESS_MS (left by a crash of an older writer); a stale lock is renamed
   aside first, so only one taker wins. Returns { release } when taken, { busy: true } when a live finish holds it, or
   { code } when it cannot be made. release removes the lock if it held this process's pid when read (a takeover in
   between needs the ten-minute stale rule, so it is not guarded further). */
const FINISH_LOCK_STALE_MS = 10 * 60 * 1000;
const FINISH_LOCK_PIDLESS_MS = 30 * 1000;
function takeFinishLock(dir) {
  const at = path.join(dir, FINISH_LOCK);
  const mine = String(process.pid);
  for (let tries = 0; tries < 2; tries++) {
    const tmp = `${at}.new-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    try {
      fs.mkdirSync(tmp, { mode: 0o700 });
      fs.writeFileSync(path.join(tmp, 'pid'), mine, { mode: 0o600 });
    } catch (e) {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
      return { code: (e && e.code) || 'EUNKNOWN' };
    }
    try {
      renameRetrying(tmp, at);   // Windows: a scanner holding the pid file just written
      return { release: () => {
        try { if (fs.readFileSync(path.join(at, 'pid'), 'utf8') === mine) fs.rmSync(at, { recursive: true, force: true }); } catch { /* gone */ }
      } };
    } catch (e) {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
      let exists = true;
      try { fs.lstatSync(at); } catch { exists = false; }
      if (!exists) return { code: (e && e.code) || 'EUNKNOWN' };
    }
    let pid = NaN, age = 0;
    try { age = Date.now() - fs.lstatSync(at).mtimeMs; } catch { continue; }   // gone meanwhile: try again
    try { pid = Number(fs.readFileSync(path.join(at, 'pid'), 'utf8')); } catch { /* no pid */ }
    const hasPid = Number.isSafeInteger(pid) && pid > 0;
    const live = hasPid ? pidAlive(pid) && age < FINISH_LOCK_STALE_MS : age < FINISH_LOCK_PIDLESS_MS;
    if (live) return { busy: true };
    const aside = `${at}.stale-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    try { fs.renameSync(at, aside); } catch { return { busy: true }; }   // another taker won the rename
    // What was moved must be the lock judged stale: another taker may have put a fresh one there in between.
    let movedPid = NaN;
    try { movedPid = Number(fs.readFileSync(path.join(aside, 'pid'), 'utf8')); } catch { /* no pid */ }
    if (!(movedPid === pid || (Number.isNaN(movedPid) && Number.isNaN(pid)))) {
      try { fs.renameSync(aside, at); } catch { /* the new owner's lock stays aside; it releases nothing of ours */ }
      return { busy: true };
    }
    try { fs.rmSync(aside, { recursive: true, force: true }); } catch { /* aside, harmless */ }
  }
  return { busy: true };
}
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return !!e && e.code === 'EPERM'; }
}

/* A plain-named folder at the top of a root: what becomes the world's. Not a dot-entry, not HEAD (git), not
   node_modules (npm resolves packages up the tree, so npx in any agent folder below would run its scripts), not a
   file, not a link. */
const NOT_PLAIN = ['HEAD', 'node_modules'];
/* Dot-names git or a provider opens at start. Asked by exact name too, since some filesystems (HFS+ ignores
   zero-width characters) open a name that does not start with a dot as one of these. */
const START_DOT = [GIT, '.claude', '.mcp.json', '.envrc', '.codex', '.gemini', '.opencode'];
function plainFolder(parent, n) {
  if (n.startsWith('.') || NOT_PLAIN.some((x) => x.toLowerCase() === n.toLowerCase())) return false;
  let st;
  try { st = fs.lstatSync(path.join(parent, n), { bigint: true }); } catch { return false; }
  if (!st.isDirectory() || st.isSymbolicLink()) return false;
  // The filesystem may fold names further than toLowerCase does, so ask it: an entry that IS what the exact name
  // opens is held back too. With no file identity to compare (an inode of 0), only the names above decide.
  if (st.ino === 0n) return true;
  for (const x of [...NOT_PLAIN, ...START_DOT]) {
    let other;
    try { other = fs.lstatSync(path.join(parent, x), { bigint: true }); } catch { continue; }
    if (other.ino === st.ino && other.dev === st.dev) return false;
  }
  return true;
}

/* The held-back folders finish runs made, from the record in the world folder (a snapshot cannot write there, so a
   lookalike folder it supplies in the restore folder is never named). */
function recordedHeld(dir) {
  let rec;
  try { rec = JSON.parse(fs.readFileSync(path.join(dir, HELD_RECORD), 'utf8')); } catch { return []; }
  const re = new RegExp(`^${HELD_PREFIX}[0-9a-f]{12}$`);
  return Array.isArray(rec && rec.folders) ? rec.folders.filter((f) => typeof f === 'string' && re.test(f)) : [];
}
function recordHeld(dir, folder) {
  const folders = [...new Set([...recordedHeld(dir), folder])];
  const file = path.join(dir, HELD_RECORD);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ folders }), { mode: 0o600 });
  renameRetrying(tmp, file);
}

/* What the finish runs held back, as `<root>/<label>`, for the screen. */
function heldIn(restoreDir, folders) {
  const out = [];
  for (const folder of folders) {
    for (const name of MOVED) {
      const listed = namesIn(path.join(restoreDir, folder, name), MAX_LISTED);
      if (!listed) continue;
      for (const n of listed.names) out.push(`${name}/${labelOf(n)}`);
      if (listed.cut) out.push(`${name}/(more not listed)`);
      if (out.length >= MAX_LISTED) return out;
    }
  }
  return out;
}

function keptIn(restoreDir, base, world) {
  const dir = worldDirOf(base, world);
  if (!dir || restoreDir !== path.join(dir, RESTORE_DIR)) return [];
  const listed = namesIn(restoreDir, MAX_LISTED);
  if (!listed) return [];
  const out = listed.names.map((n) => cleanText(n, MAX_MEMBER_CHARS, '(a name that cannot be shown)'));
  if (listed.cut) out.push('(more not listed)');
  return out;
}

/* The briefs in a folder, in BRIEFS order: `plain` are files (read), `linked` are links (never opened, but a provider
   would follow them, so they are named). */
function briefsIn(folder) {
  const plain = [], linked = [];
  for (const b of BRIEFS) {
    let st;
    try { st = fs.lstatSync(path.join(folder, b)); } catch { continue; }
    if (st.isFile()) plain.push(b);
    else if (st.isSymbolicLink()) linked.push(b);
  }
  return { plain, linked };
}

/* The first MAX_BRIEF_BYTES + 1 bytes of a file found plain by lstat, refused if what opened is not that same file. */
function readBrief(file) {
  const before = fs.lstatSync(file, { bigint: true });
  if (!before.isFile()) throw new Error('not a plain file any more');   // a FIFO would block the open
  if (before.ino === 0n) throw new Error('this filesystem gives no file identity to compare');
  const fd = fs.openSync(file, 'r');
  try {
    const now = fs.fstatSync(fd, { bigint: true });
    if (!now.isFile() || now.ino !== before.ino || now.dev !== before.dev) throw new Error('changed while opening');
    const buf = Buffer.alloc(MAX_BRIEF_BYTES + 1);
    return buf.subarray(0, fs.readSync(fd, buf, 0, MAX_BRIEF_BYTES + 1, 0));
  } finally { fs.closeSync(fd); }
}

/* Up to `limit` entry names of a folder, sorted, and whether more were left unread; null if it cannot be read. */
function namesIn(folder, limit) {
  let dir;
  try { dir = fs.opendirSync(folder); } catch { return null; }
  const names = [];
  let cut = false;
  try {
    for (let e = dir.readSync(); e !== null; e = dir.readSync()) {
      if (names.length >= limit) { cut = true; break; }
      names.push(e.name);
    }
  } catch { return null; } finally { try { dir.closeSync(); } catch { /* read already */ } }
  return { names: names.sort(), cut };
}

/* What makes git treat `folder` itself as a repository: a .git entry, or a HEAD. Asked by lstat on exact names, so the
   filesystem's own case and normalisation rules decide, as they do for git. This is the check that counts; the
   name comparisons elsewhere only add to it. */
function gitIn(folder) {
  const has = (n) => { try { fs.lstatSync(path.join(folder, n)); return true; } catch { return false; } };
  const out = [];
  if (has(GIT)) out.push(GIT);
  if (has('HEAD')) out.push(BARE);
  return out;
}
const isGit = (runs) => runs.some((r) => r === BARE || r.toLowerCase() === GIT);

/* What in a folder runs or loads something when a provider starts there: its dot-entries and PLAIN_AT_START names (a
   link counts, unopened), a git repository in either form, linked briefs, briefs that are not plain UTF-8 text, and
   `@` imports in any brief. `budget.left` is the brief bytes the whole listing may still read. */
function runsIn(folder, budget) {
  const listed = namesIn(folder, MAX_ENTRIES_READ);
  if (!listed) return [UNREADABLE, ...gitIn(folder)];   // git still finds what lstat can see
  const out = [];
  for (const n of listed.names.filter((x) => x.startsWith('.') && !HARMLESS.has(x))) out.push(labelOf(n));
  // The start-time dot-names asked by exact name, for a spelling the filesystem opens as one of them.
  for (const x of START_DOT) {
    if (x === GIT || out.some((r) => r.toLowerCase() === x)) continue;   // git is asked by gitIn below
    try { fs.lstatSync(path.join(folder, x)); out.push(x); } catch { /* absent */ }
  }
  if (listed.cut) out.push(CUT);
  for (const g of gitIn(folder)) if (!out.includes(g)) out.push(g);
  const folded = new Set(listed.names.map((x) => x.toLowerCase()));
  // Folded names, and the exact name asked of the filesystem, which may fold further than toLowerCase.
  for (const n of PLAIN_AT_START) {
    let there = folded.has(n.toLowerCase());
    if (!there) { try { fs.lstatSync(path.join(folder, n)); there = true; } catch { /* absent */ } }
    if (there) out.push(n);
  }
  const briefs = briefsIn(folder);
  for (const b of briefs.linked) out.push(`${b} is a link`);
  for (const brief of briefs.plain) {
    if (budget.left <= 0) { out.push(`${brief} (not checked: the listing has read as much as it may)`); continue; }
    let bytes;
    try { bytes = readBrief(path.join(folder, brief)); } catch { out.push(`${brief} (could not be read)`); continue; }
    budget.left -= bytes.length;
    const head = bytes.subarray(0, MAX_BRIEF_BYTES);
    // UTF-16 (a byte-order mark, or NUL bytes) cannot be checked as text here; a provider may still read it.
    if (head.includes(0) || (head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff)) out.push(`${brief} (not plain text, so not checked)`);
    // An @ that starts a word, after a space, a line start or punctuation; not inside an address (a@b) or a word.
    // Or any @ before a path (/, ./, ../, ~/) whatever comes before it, since providers differ on what may precede one.
    // No m flag is needed: a line start inside the text is a newline, which the first class already accepts.
    else if (/(^|[^\p{L}\p{N}_@.])@[^\s@]|@(\.{1,2}\/|~\/|\/)/u.test(head.toString('utf8'))) out.push(`${brief} imports`);
    if (bytes.length > MAX_BRIEF_BYTES) out.push(`${brief} (too large to check in full)`);
  }
  return out;
}

const labelOf = (name) => cleanText(name, MAX_MEMBER_CHARS, '(a name that cannot be shown)');

/* opts: { base, world, restoreDir, nameOk? }.
   { agents: [{ folder, label, from, name, dir, brief, runs, because }], shared: [{ where, label, runs }], more }.
   `folder` is the name on disk, as written by whoever made the backup; `label` is it made safe to show (two folders
   can share a label, so the screen tells rows apart by `folder`). `because` null means the screen may offer to enable
   it (create.installJob on that name, under this world's roots); otherwise it is the plain reason it cannot be.
   `runs` lists what would run or load at start. `shared` is what every agent below it would read: entries at the top
   of the workers and projects folders other than plain-named folders, and each project with something in its `runs`.
   Contract for the screen (slice 4c): show `label`, never `folder` or `dir` (both carry the raw name); leave out a
   folder that already has a profile in this world (it was enabled before); show `runs` and `shared`; enable an agent whose
   `runs` is not empty, or while `shared` is not empty, only after the person acknowledges them, since a hook or an MCP
   server there runs the moment the agent starts; and enable nothing while `more` is true, since the list is then cut
   short. An empty `runs` means only that nothing at the folder's top was flagged, not that the agent is safe: 4a's
   review list is what shows every file. Labels can look alike (homoglyphs), so rows are told apart by `folder`. A
   git repository (a .git, or HEAD, objects and refs) in a project or at the top of projects is shared, not refused
   (projects are usually repositories; one at the top reaches every project without its own); one in an agent folder
   or at the top of workers refuses. Projects keep their own .git (restoring a repository whole is the point), so an
   agent made in this world later meets it without this review: start agents in a Restored world with git's hooks
   and fsmonitor switched off (4c). Agents kept elsewhere sit under the restore folder, whose top a snapshot chooses,
   so never run git or open a terminal there. A backup can force `more` with enough empty folders, so the screen should let the
   person review past the cap rather than stop. Nothing is registered, started or written.
   A world not on the list (no registry row, hidden, or its folder swapped for a link) answers with no rows and a
   `because`, so a refusal cannot read as an empty restore.
   opts.maxListed lowers MAX_LISTED and opts.briefTotal lowers MAX_BRIEF_TOTAL (tests). */
function listRestoredAgents(opts = {}) {
  const nameOk = opts.nameOk || ((n) => require('./create').NAME_RE.test(n));
  const worldDir = worldDirOf(opts.base, opts.world);
  const listable = worldDir && realDir(worldDir) && onTheList(opts.base, opts.world.id);
  if (!listable) return { agents: [], shared: [], more: false, because: 'this is not a Kosmos on your list, so nothing in it is offered' };
  const roots = worlds.envOverridesFor(opts.base, opts.world);
  const budget = { left: Number.isSafeInteger(opts.briefTotal) && opts.briefTotal >= 0 ? Math.min(opts.briefTotal, MAX_BRIEF_TOTAL) : MAX_BRIEF_TOTAL };
  const cap = Number.isSafeInteger(opts.maxListed) && opts.maxListed > 0 ? Math.min(opts.maxListed, MAX_LISTED) : MAX_LISTED;
  const agents = [], shared = [];
  let more = false;
  const full = () => { if (agents.length + shared.length >= cap) { more = true; return true; } return false; };
  const entriesOf = (parent) => {
    if (!parent || !realDir(parent)) return [];
    const listed = namesIn(parent, MAX_ENTRIES_READ);
    if (!listed) { more = true; return []; }   // a folder that cannot be read leaves the list incomplete
    if (listed.cut) more = true;
    return listed.names;
  };
  const isTopFolder = (parent, n) => {
    if (n.startsWith('.')) return false;
    try { const st = fs.lstatSync(path.join(parent, n)); return st.isDirectory() || st.isSymbolicLink(); } catch { return false; }
  };
  // Asked before any capped loop, so no number of entries can hide it.
  const workersGit = roots.AGENT_WORKFORCE_WORKERS && realDir(roots.AGENT_WORKFORCE_WORKERS) ? gitIn(roots.AGENT_WORKFORCE_WORKERS) : [];
  const workersNames = entriesOf(roots.AGENT_WORKFORCE_WORKERS);
  const gitAbove = workersGit.length > 0 || workersNames.some((n) => n.toLowerCase() === GIT);
  // What the top of workers holds is read by every agent below it (briefs walked up to, start-time files, git).
  const workersTop = roots.AGENT_WORKFORCE_WORKERS && realDir(roots.AGENT_WORKFORCE_WORKERS) ? runsIn(roots.AGENT_WORKFORCE_WORKERS, budget) : [];
  if (workersTop.includes(CUT)) more = true;
  if (isGit(workersTop)) workersTop.push(GIT_WHY);
  if (workersTop.length) shared.push({ where: 'workers', label: '(the workers folder itself)', runs: workersTop });
  const scan = (parent, from, names) => {
    for (const folder of names) {
      if (full()) return;
      const at = path.join(parent, folder);
      const label = labelOf(folder);
      if (from === 'workers' && !isTopFolder(parent, folder)) {
        if (folder.startsWith('.')) continue;   // named in the "(the workers folder itself)" row
        shared.push({ where: 'workers', label, runs: [] });
        continue;
      }
      let st;
      try { st = fs.lstatSync(at); } catch { continue; }
      if (st.isSymbolicLink()) { agents.push({ folder, label, from, name: null, dir: at, brief: null, runs: [], because: 'it is a link to somewhere else, so it was not opened' }); continue; }
      if (!st.isDirectory()) continue;
      const runs = runsIn(at, budget);
      const brief = briefsIn(at).plain[0] || null;
      let because = null, name = null;
      if (from === 'elsewhere') because = 'its folder was kept outside the workers folder, so it cannot be started from where it is';
      else if (!nameOk(folder)) because = 'its folder name cannot be used to start it here';
      else name = folder;
      if (!because && !brief) because = 'it has no instructions file, so it may not be an agent';
      // NTFS aliases of .git (a trailing dot or space, an 8.3 short name) are refused by restoresink.js plainSegments
      // for anything the restore wrote; gitIn's lstat answers for what else is there.
      if (!because && isGit(runs)) because = 'it holds a git folder, whose settings can run commands as soon as it starts';
      if (!because && runs.includes(UNREADABLE)) because = 'its folder could not be read, so what it loads at start could not be seen';
      if (runs.includes(CUT)) {
        more = true;
        if (!because) because = 'it holds more entries than were checked, so what it loads at start could not all be seen';
      }
      agents.push({ folder, label, from, name, dir: at, brief, runs, because });
    }
  };
  const pr = roots.AGENT_WORKFORCE_PROJECTS;
  const projectsTop = pr && realDir(pr) ? runsIn(pr, budget) : [];
  if (projectsTop.includes(CUT)) more = true;
  if (isGit(projectsTop)) projectsTop.push(GIT_WHY);
  if (projectsTop.length) shared.push({ where: 'projects', label: '(the projects folder itself)', runs: projectsTop });
  scan(roots.AGENT_WORKFORCE_WORKERS, 'workers', workersNames);
  if (opts.restoreDir === path.join(worldDir, RESTORE_DIR) && realDir(opts.restoreDir)) {
    const agentsDir = path.join(opts.restoreDir, 'agents');
    scan(agentsDir, 'elsewhere', entriesOf(agentsDir));
  }
  for (const n of entriesOf(pr)) {
    if (full() || n.startsWith('.')) continue;   // dot-entries are named in the "(the projects folder itself)" row
    if (!isTopFolder(pr, n)) { shared.push({ where: 'projects', label: labelOf(n), runs: [] }); continue; }
    const runs = realDir(path.join(pr, n)) ? runsIn(path.join(pr, n), budget) : ['it is a link'];
    if (runs.includes(CUT)) more = true;
    if (isGit(runs)) runs.push(GIT_WHY);
    if (runs.length) shared.push({ where: 'projects', label: labelOf(n), runs });
  }
  if (gitAbove) {   // folded: APFS and NTFS read .GIT as .git
    for (const a of agents) if (!a.because) a.because = 'the restored workers folder holds a git folder, whose settings can run commands for every agent in it';
  }
  return { agents, shared, more };
}

module.exports = { prepareRestoreWorld, finishRestoreWorld, listRestoredAgents, worldName, RESTORE_DIR };
