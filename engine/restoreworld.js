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
 *                         `projects` into the world's own (a rename inside one folder, so one volume)
 *   listRestoredAgents    the agent folders the review screen offers, each with why it cannot be enabled if it cannot,
 *                         and the files in it that run or load something when the agent starts
 *
 * ⚠️ NOT REQUIRED BY worlds.js, and create.js only lazily, for the same reason as engine/worldimport.js: create freezes
 * store.ROOT at require.
 */

const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');
const worlds = require('./worlds');
const { TEMP_PREFIX } = require('./restoresink');

const RESTORE_DIR = 'restored';                  // inside the world folder; what was not moved stays here, and is shown
const MOVED = ['workers', 'projects'];           // the roots that become the world's own
const MAX_NAME_TRIES = 9;
const MAX_MEMBER_CHARS = 60;
const MAX_LISTED = 1000;
const BRIEFS = ['CLAUDE.md', 'AGENTS.md', 'AGENTS.override.md', 'GEMINI.md'];
const MAX_BRIEF_BYTES = 512 * 1024;
const MAX_ENTRIES_READ = 4 * MAX_LISTED;          // entries read from any one folder; past it the listing says `more`
const MAX_BRIEF_TOTAL = 32 * 1024 * 1024;         // brief bytes read across one listing, so a hostile backup cannot stall it
const RENAME_RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);   // Windows: a scanner holding a just-written file
/* What in a folder a provider may read or run when it starts there: every dot-entry at its top (settings, hooks,
   skills, MCP servers, an environment file, any provider's own folder, git) except HARMLESS, and these plain names. */
const PLAIN_AT_START = ['CLAUDE.local.md', 'opencode.json', 'opencode.jsonc'];   // compared folded, as APFS and NTFS open them
/* A git folder's config (core.fsmonitor, core.hooksPath) runs commands when git runs there, which a provider does as
   soon as an agent starts. So an agent folder holding one is not offered, and one in the workers folder blocks all. */
const GIT = '.git';
const HARMLESS = new Set(['.DS_Store']);
/* Git also reads a folder holding HEAD, objects and refs as a repository (a bare layout, accepted by default), with no
   .git at all. */
const BARE = 'HEAD, objects and refs (git reads a folder holding them as a repository)';   // Finder's own metadata, which no provider reads
/* Fillers and blanks that draw nothing, beside the Cc/Cf/Zl/Zp and private-use classes: braille blank, Hangul fillers. */
const BLANKS = new RegExp(`[${[0x2800, 0x3164, 0xffa0, 0x115f, 0x1160].map((c) => String.fromCodePoint(c)).join('')}]`, 'gu');

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

/* opts: { member, now?, createWorld?, hideWorld? } (the two world calls injectable for tests).
   { ok: true, world, dir, restoreDir } or { ok: false, because }. */
function prepareRestoreWorld(base, opts = {}) {
  const create = opts.createWorld || worlds.createWorld;
  const hide = opts.hideWorld || worlds.hideWorld;
  if (typeof base !== 'string' || !path.isAbsolute(base)) return { ok: false, because: 'the restore was asked without a place for its Kosmos' };
  let world = null;
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
      try { hide(base, world.id); } catch { return { ok: false, because: 'a Kosmos folder already on this computer under that name could not be set aside' }; }
      world = null;
    }
  }
  if (!world) return { ok: false, because: `there are already ${MAX_NAME_TRIES} restored Kosmoses for this member today; hide one and try again` };
  const dir = worlds.worldBaseDir(base, world);
  const restoreDir = path.join(dir, RESTORE_DIR);
  try {
    fs.mkdirSync(restoreDir, { mode: 0o700 });   // not recursive: it must be new, and the sink refuses a non-empty root
  } catch {
    try { hide(base, world.id); } catch { /* the refusal is the news */ }
    return { ok: false, because: 'the folder for the restore could not be made, so the new Kosmos was hidden again' };
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
   `result` is engine/restorerun.js runRestore's answer, which must be ok. { ok, moved: [name], kept: [label],
   failedFiles, because? }: `failedFiles` counts the files runRestore listed as failed (it answers ok with some failed,
   since one damaged file does not fail the rest), for the screen to say. Every check runs before anything moves, so a refusal moves nothing;
   only a rename failing part way leaves one root moved, and `moved` says which. */
function finishRestoreWorld(opts = {}) {
  const { base, world, restoreDir } = opts;
  const dir = worldDirOf(base, world);
  if (!dir || !realDir(dir)) return { ok: false, moved: [], kept: [], because: 'the restore did not name its Kosmos' };
  if (!opts.result || opts.result.ok !== true) return { ok: false, moved: [], kept: [], because: 'the restore did not succeed, so its files stay where it can continue' };
  if (!takenIds(base).has(world.id)) return { ok: false, moved: [], kept: [], because: 'the restore did not name its Kosmos' };
  const inner = opts.result.result;
  const notListed = inner && Number.isSafeInteger(inner.failedNotListed) && inner.failedNotListed > 0 ? inner.failedNotListed : 0;
  const failedFiles = (inner && Array.isArray(inner.failed) ? inner.failed.length : 0) + notListed;
  if (restoreDir !== path.join(dir, RESTORE_DIR) || !realDir(restoreDir)) {
    return { ok: false, moved: [], kept: [], because: 'the restore folder is not the one made for this Kosmos' };
  }
  // A stopped restore keeps its record, an open sink holds its lock, and a crashed one leaves its temp folder: any of
  // the sink's own entries means the restore is not finished, and it continues in this folder (slice 3).
  let names;
  try { names = fs.readdirSync(restoreDir); } catch { names = null; }
  if (!names) return { ok: false, moved: [], kept: [], because: 'the restore folder could not be read' };
  if (names.some((n) => n.toLowerCase().startsWith(TEMP_PREFIX))) {   // folded, as the sink reserves them
    return { ok: false, moved: [], kept: [], because: 'this restore has not finished, so its files stay where it can continue' };
  }
  const roots = worlds.envOverridesFor(base, world);
  const target = { workers: roots.AGENT_WORKFORCE_WORKERS, projects: roots.AGENT_WORKFORCE_PROJECTS };
  const plan = [];
  for (const name of MOVED) {
    const src = path.join(restoreDir, name);
    let st = null;
    try { st = fs.lstatSync(src); } catch { continue; }   // a snapshot without projects has nothing to move
    if (!st.isDirectory()) return { ok: false, moved: [], kept: [], because: `the restored ${name} is not a folder` };
    const dst = target[name];
    if (!realDir(dst)) return { ok: false, moved: [], kept: [], because: `the new Kosmos has no ${name} folder to receive it` };
    let inside;
    try { inside = fs.readdirSync(dst); } catch { inside = null; }
    if (!inside || inside.length) return { ok: false, moved: [], kept: [], because: `the new Kosmos already has files in its ${name} folder` };
    plan.push({ name, src, dst });
  }
  // Between the checks and the rename only this user's own processes can change these folders (the sink assumes the
  // same: the restore folder is private to the person).
  const moved = [];
  for (const { name, src, dst } of plan) {
    try {
      fs.rmdirSync(dst);
      renameRetrying(src, dst);
      moved.push(name);
    } catch (e) {
      let back = true;
      try { if (!realDir(dst)) fs.mkdirSync(dst); } catch { back = false; }
      const code = e && typeof e.code === 'string' ? ` (${e.code})` : '';
      return { ok: false, moved, kept: keptIn(restoreDir), failedFiles,
        because: `the restored ${name} could not be moved into the new Kosmos${code}${back ? '' : `, and its empty ${name} folder could not be put back`}` };
    }
  }
  return { ok: true, moved, kept: keptIn(restoreDir), failedFiles };
}

function keptIn(restoreDir) {
  let names = [];
  try { names = fs.readdirSync(restoreDir); } catch { return []; }
  return names.sort().map((n) => cleanText(n, MAX_MEMBER_CHARS, '(a name that cannot be shown)'));
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

/* What makes git treat `folder` itself as a repository: a .git entry, or the bare layout. Asked by lstat on exact
   names, so the filesystem's own case rule decides, as it does for git. */
function gitIn(folder) {
  const has = (n) => { try { fs.lstatSync(path.join(folder, n)); return true; } catch { return false; } };
  const out = [];
  if (has(GIT)) out.push(GIT);
  if (has('HEAD') && has('objects') && has('refs')) out.push(BARE);
  return out;
}
const isGit = (runs) => runs.some((r) => r === BARE || r.toLowerCase() === GIT);

/* What in a folder runs or loads something when a provider starts there: its dot-entries and PLAIN_AT_START names (a
   link counts, unopened), a git repository in either form, linked briefs, briefs that are not plain UTF-8 text, and
   `@` imports in any brief. `budget.left` is the brief bytes the whole listing may still read. */
function runsIn(folder, budget) {
  const listed = namesIn(folder, MAX_ENTRIES_READ);
  if (!listed) return ['(the folder could not be read)'];
  const out = [];
  for (const n of listed.names.filter((x) => x.startsWith('.') && !HARMLESS.has(x))) out.push(labelOf(n));
  if (listed.cut) out.push('(the folder holds more entries than were checked)');
  for (const g of gitIn(folder)) if (!out.includes(g)) out.push(g);
  const folded = new Set(listed.names.map((x) => x.toLowerCase()));
  for (const n of PLAIN_AT_START) if (folded.has(n.toLowerCase())) out.push(n);
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
    else if (/(^|[^\p{L}\p{N}_@.])@[^\s@]/u.test(head.toString('utf8'))) out.push(`${brief} imports`);
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
   Contract for the screen (slice 4c): show `label`, never `folder`; show `runs` and `shared`; enable an agent whose
   `runs` is not empty, or while `shared` is not empty, only after the person acknowledges them, since a hook or an MCP
   server there runs the moment the agent starts; and enable nothing while `more` is true, since the list is then cut
   short. An empty `runs` means only that nothing at the folder's top was flagged, not that the agent is safe: 4a's
   review list is what shows every file. Labels can look alike (homoglyphs), so rows are told apart by `folder`. A
   git repository (a .git, or HEAD, objects and refs) in a project or at the top of projects is shared, not refused
   (projects are usually repositories; one at the top reaches every project without its own); one in an agent folder
   or at the top of workers refuses. A backup can force `more` with enough empty folders, so the screen should let the
   person review past the cap rather than stop. Nothing is registered, started or written.
   opts.maxListed lowers MAX_LISTED (tests). */
function listRestoredAgents(opts = {}) {
  const nameOk = opts.nameOk || ((n) => require('./create').NAME_RE.test(n));
  const worldDir = worldDirOf(opts.base, opts.world);
  const listable = worldDir && realDir(worldDir) && takenIds(opts.base).has(opts.world.id);
  const roots = listable ? worlds.envOverridesFor(opts.base, opts.world) : {};
  const budget = { left: MAX_BRIEF_TOTAL };
  const cap = Number.isSafeInteger(opts.maxListed) && opts.maxListed > 0 ? Math.min(opts.maxListed, MAX_LISTED) : MAX_LISTED;
  const agents = [], shared = [];
  let more = false;
  const full = () => { if (agents.length + shared.length >= cap) { more = true; return true; } return false; };
  const entriesOf = (parent) => {
    if (!parent || !realDir(parent)) return [];
    const listed = namesIn(parent, MAX_ENTRIES_READ);
    if (!listed) return [];
    if (listed.cut) more = true;
    return listed.names;
  };
  const gitRow = (n) => (n.toLowerCase() === GIT ? [GIT] : []);
  const isTopFolder = (parent, n) => {
    if (n.startsWith('.')) return false;
    try { const st = fs.lstatSync(path.join(parent, n)); return st.isDirectory() || st.isSymbolicLink(); } catch { return false; }
  };
  // Asked before any capped loop, so no number of entries can hide it.
  const workersGit = roots.AGENT_WORKFORCE_WORKERS && realDir(roots.AGENT_WORKFORCE_WORKERS) ? gitIn(roots.AGENT_WORKFORCE_WORKERS) : [];
  const workersNames = entriesOf(roots.AGENT_WORKFORCE_WORKERS);
  const gitAbove = workersGit.length > 0 || workersNames.some((n) => n.toLowerCase() === GIT);
  if (workersGit.length) shared.push({ where: 'workers', label: '(the workers folder itself)', runs: workersGit });
  const scan = (parent, from, names) => {
    for (const folder of names) {
      if (full()) return;
      const at = path.join(parent, folder);
      const label = labelOf(folder);
      if (from === 'workers' && !isTopFolder(parent, folder)) {
        if (HARMLESS.has(folder)) continue;
        shared.push({ where: 'workers', label, runs: gitRow(folder) });
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
      // NTFS aliases of .git (a trailing dot or space, an 8.3 short name) never get this far: restoresink.js
      // plainSegments refuses them.
      if (!because && isGit(runs)) because = 'it holds a git folder, whose settings can run commands as soon as it starts';
      agents.push({ folder, label, from, name, dir: at, brief, runs, because });
    }
  };
  const pr = roots.AGENT_WORKFORCE_PROJECTS;
  const projectsGit = pr && realDir(pr) ? gitIn(pr) : [];
  if (projectsGit.length) shared.push({ where: 'projects', label: '(the projects folder itself)', runs: projectsGit });
  scan(roots.AGENT_WORKFORCE_WORKERS, 'workers', workersNames);
  if (listable && opts.restoreDir === path.join(worldDir, RESTORE_DIR)) {
    const agentsDir = path.join(opts.restoreDir, 'agents');
    scan(agentsDir, 'elsewhere', entriesOf(agentsDir));
  }
  for (const n of entriesOf(pr)) {
    if (full() || HARMLESS.has(n)) continue;
    if (!isTopFolder(pr, n)) { shared.push({ where: 'projects', label: labelOf(n), runs: gitRow(n) }); continue; }
    const runs = realDir(path.join(pr, n)) ? runsIn(path.join(pr, n), budget) : ['it is a link'];
    if (runs.length) shared.push({ where: 'projects', label: labelOf(n), runs });
  }
  if (gitAbove) {   // folded: APFS and NTFS read .GIT as .git
    for (const a of agents) if (!a.because) a.because = 'the restored workers folder holds a git folder, whose settings can run commands for every agent in it';
  }
  return { agents, shared, more };
}

module.exports = { prepareRestoreWorld, finishRestoreWorld, listRestoredAgents, worldName, RESTORE_DIR };
