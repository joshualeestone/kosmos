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
const BRIEFS = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md'];
const MAX_BRIEF_BYTES = 512 * 1024;
const RENAME_RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);   // Windows: a scanner holding a just-written file
/* Paths in an agent folder a provider reads when the agent starts (settings, hooks, skills, commands, MCP servers,
   local memory, an environment file, another provider's settings). Written by whoever made the backup, so the screen
   shows them. A starting point, not a complete list of what a provider may read. */
const RUNS_AT_START = ['.claude', 'CLAUDE.local.md', '.mcp.json', '.envrc', '.codex', '.gemini'];
/* Fillers and blanks that draw nothing, beside the Cc/Cf/Zl/Zp and private-use classes: braille blank, Hangul fillers. */
const BLANKS = new RegExp(`[${[0x2800, 0x3164, 0xffa0, 0x115f, 0x1160].map((c) => String.fromCodePoint(c)).join('')}]`, 'gu');

/* Attacker-written text made safe to show: control, format, bidi, private-use and blank characters dropped, at most
   two combining marks per character, spaces collapsed, cut at `max` code points; `fallback` when nothing visible is
   left. */
function cleanText(text, max, fallback) {
  const s = String(text == null ? '' : text).normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}]/gu, '')
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
    try { world = create(base, name); } catch {
      // Taken (a hidden Kosmos keeps its id too): try the next name. Anything else is a failure.
      if (takenIds(base).has(store.safeKey(name))) continue;
      return { ok: false, because: 'the Kosmos for the restore could not be made' };
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
   because? }. Every check runs before anything moves, so a refusal moves nothing;
   only a rename failing part way leaves one root moved, and `moved` says which. */
function finishRestoreWorld(opts = {}) {
  const { base, world, restoreDir } = opts;
  const dir = worldDirOf(base, world);
  if (!dir) return { ok: false, moved: [], kept: [], because: 'the restore did not name its Kosmos' };
  if (!opts.result || opts.result.ok !== true) return { ok: false, moved: [], kept: [], because: 'the restore did not succeed, so its files stay where it can continue' };
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
      return { ok: false, moved, kept: keptIn(restoreDir),
        because: `the restored ${name} could not be moved into the new Kosmos${code}${back ? '' : `, and its empty ${name} folder could not be put back`}` };
    }
  }
  return { ok: true, moved, kept: keptIn(restoreDir) };
}

function keptIn(restoreDir) {
  let names = [];
  try { names = fs.readdirSync(restoreDir); } catch { return []; }
  return names.sort().map((n) => cleanText(n, MAX_MEMBER_CHARS, '(a name that cannot be shown)'));
}

/* Every brief in the folder that is a plain file (a link is not one), in BRIEFS order. */
function briefsIn(folder) {
  return BRIEFS.filter((b) => { try { return fs.lstatSync(path.join(folder, b)).isFile(); } catch { return false; } });
}

/* What in an agent folder runs or loads something at start: RUNS_AT_START paths that exist (a link counts, unopened),
   and `@` imports (at a line start or after a space) in any brief. */
function runsIn(folder, briefs) {
  const out = [];
  for (const rel of RUNS_AT_START) {
    try { fs.lstatSync(path.join(folder, rel)); out.push(rel); } catch { /* absent */ }
  }
  for (const brief of briefs) {
    try {
      const fd = fs.openSync(path.join(folder, brief), 'r');   // briefsIn found it a plain file with lstat
      try {
        const buf = Buffer.alloc(MAX_BRIEF_BYTES + 1);
        const n = fs.readSync(fd, buf, 0, MAX_BRIEF_BYTES + 1, 0);
        if (/(^|\s)@[^\s@]/.test(buf.subarray(0, Math.min(n, MAX_BRIEF_BYTES)).toString('utf8'))) out.push(`${brief} imports`);
        if (n > MAX_BRIEF_BYTES) out.push(`${brief} (too large to check in full)`);
      } finally { fs.closeSync(fd); }
    } catch { out.push(`${brief} (could not be read)`); }
  }
  return out;
}

/* opts: { base, world, restoreDir, nameOk? }. { agents: [{ folder, label, from, name, dir, brief, runs, because }],
   more }. `folder` is the name on disk, as written by whoever made the backup; `label` is it made safe to show.
   `because` null means the screen may offer to enable it (create.installJob on that name, under this world's roots);
   otherwise it is the plain reason it cannot be. `runs` lists what would run or load at start, for the screen to show
   before any enable. Nothing is registered, started or written. */
function listRestoredAgents(opts = {}) {
  const nameOk = opts.nameOk || ((n) => require('./create').NAME_RE.test(n));
  const worldDir = worldDirOf(opts.base, opts.world);
  const roots = worldDir ? worlds.envOverridesFor(opts.base, opts.world) : {};
  const agents = [];
  let more = false;
  const scan = (parent, from) => {
    if (!parent || !realDir(parent)) return;
    let entries = [];
    try { entries = fs.readdirSync(parent).sort(); } catch { return; }
    for (const folder of entries) {
      if (agents.length >= MAX_LISTED) { more = true; return; }
      const at = path.join(parent, folder);
      let st;
      try { st = fs.lstatSync(at); } catch { continue; }
      const label = cleanText(folder, MAX_MEMBER_CHARS, '(a name that cannot be shown)');
      if (st.isSymbolicLink()) { agents.push({ folder, label, from, name: null, dir: at, brief: null, runs: [], because: 'it is a link to somewhere else, so it was not opened' }); continue; }
      if (!st.isDirectory()) continue;
      const briefs = briefsIn(at);
      const brief = briefs[0] || null;
      let because = null, name = null;
      if (from === 'elsewhere') because = 'its folder was kept outside the workers folder, so it cannot be started from where it is';
      else if (!nameOk(folder)) because = 'its folder name cannot be used to start it here';
      else name = folder;
      if (!because && !brief) because = 'it has no instructions file, so it may not be an agent';
      agents.push({ folder, label, from, name, dir: at, brief, runs: runsIn(at, briefs), because });
    }
  };
  scan(roots.AGENT_WORKFORCE_WORKERS, 'workers');
  if (worldDir && opts.restoreDir === path.join(worldDir, RESTORE_DIR)) scan(path.join(opts.restoreDir, 'agents'), 'elsewhere');
  return { agents, more };
}

module.exports = { prepareRestoreWorld, finishRestoreWorld, listRestoredAgents, worldName, RESTORE_DIR };
