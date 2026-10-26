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
 *   finishRestoreWorld    after a restore that succeeded: moves the restored `workers` and `projects` into the world's
 *                         own (a rename inside one folder, so one volume), and says what stayed behind
 *   listRestoredAgents    the agent folders the review screen offers, each with why it cannot be enabled if it cannot
 *
 * A stopped restore is never finished: it stays in the restore folder and continues there (slice 3's record).
 * ⚠️ NOT REQUIRED BY worlds.js, and create.js only lazily, for the same reason as engine/worldimport.js: create freezes
 * store.ROOT at require.
 */

const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');
const worlds = require('./worlds');
const { RECORD_NAME, LOCK_NAME } = require('./restoresink');

const RESTORE_DIR = 'restored';                  // inside the world folder; what was not moved stays here, and is shown
const MOVED = ['workers', 'projects'];           // the roots that become the world's own
const MAX_NAME_TRIES = 9;                        // "Restored: Ann, 2026-10-26 (9)" is the last tried
const MAX_MEMBER_CHARS = 60;
const MAX_LISTED = 1000;                         // bounds one listing; a Kosmos holds a few dozen agents
const BRIEFS = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md'];

/* The member's name as a world name can carry it: control, format and bidi characters dropped (a name that reorders
   or hides the date would mislabel the world), spaces collapsed, at most MAX_MEMBER_CHARS code points. */
function cleanMember(member) {
  const s = String(member == null ? '' : member)
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '')
    .replace(/\s+/g, ' ').trim();
  const cut = Array.from(s).slice(0, MAX_MEMBER_CHARS).join('').trim();
  return cut || 'a member';
}

function dayOf(now) {
  const d = new Date(Number.isFinite(now) ? now : Date.now());
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* The world's name, `try` 1 bare and 2.. with " (n)". */
function worldName(member, now, attempt = 1) {
  const base = `Restored: ${cleanMember(member)}, ${dayOf(now)}`;
  return attempt > 1 ? `${base} (${attempt})` : base;
}

/* opts: { member, now?, createWorld?, hideWorld? } (the two world calls injectable for tests).
   { ok: true, world, dir, restoreDir } or { ok: false, because }. */
function prepareRestoreWorld(base, opts = {}) {
  const create = opts.createWorld || worlds.createWorld;
  const hide = opts.hideWorld || worlds.hideWorld;
  if (typeof base !== 'string' || !path.isAbsolute(base)) return { ok: false, because: 'the restore was asked without a place for its Kosmos' };
  let taken;
  try { taken = new Set(worlds.readRegistry(base).worlds.map((w) => w.id)); } catch { taken = new Set(); }
  let world = null;
  for (let n = 1; n <= MAX_NAME_TRIES && !world; n++) {
    const name = worldName(opts.member, opts.now, n);
    // A hidden Kosmos keeps its id (worlds.createWorld refuses it too), so the registry is the list to avoid.
    if (taken.has(store.safeKey(name))) continue;
    try { world = create(base, name); } catch { return { ok: false, because: 'the Kosmos for the restore could not be made' }; }
  }
  if (!world) return { ok: false, because: `there are already ${MAX_NAME_TRIES} restored Kosmoses for this member today; hide one and try again` };
  const dir = worlds.worldBaseDir(base, world);
  const restoreDir = path.join(dir, RESTORE_DIR);
  try {
    fs.mkdirSync(restoreDir, { mode: 0o700 });   // not recursive: it must be new, and the sink refuses a non-empty root
  } catch {
    // Taken back off the list (its files stay, as hiding promises), so an empty Kosmos is not left offered.
    try { hide(base, world.id); } catch { /* the refusal is the news */ }
    return { ok: false, because: 'the folder for the restore could not be made, so the new Kosmos was hidden again' };
  }
  return { ok: true, world, dir, restoreDir };
}

function realDir(p) {
  try { const st = fs.lstatSync(p); return st.isDirectory() ? st : null; } catch { return null; }
}

/* After a restore that SUCCEEDED, and after its sink is closed. opts: { base, world, restoreDir }.
   { ok, moved: [name], kept: [entry], because? }. Every check runs before anything moves, so a refusal moves nothing;
   only a rename failing part way leaves one root moved, and `moved` says which. */
function finishRestoreWorld(opts = {}) {
  const { base, world, restoreDir } = opts;
  let dir;
  try { dir = worlds.worldBaseDir(base, world); } catch { dir = null; }
  if (!dir) return { ok: false, moved: [], kept: [], because: 'the restore did not name its Kosmos' };
  // Only the folder prepareRestoreWorld made is moved from: a caller cannot point this at any other tree.
  if (restoreDir !== path.join(dir, RESTORE_DIR) || !realDir(restoreDir)) {
    return { ok: false, moved: [], kept: [], because: 'the restore folder is not the one made for this Kosmos' };
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
  const moved = [];
  for (const { name, src, dst } of plan) {
    try {
      fs.rmdirSync(dst);   // empty, checked above; rmdir refuses anything else
      fs.renameSync(src, dst);
      moved.push(name);
    } catch {
      try { fs.mkdirSync(dst); } catch { /* it may still be there */ }
      return { ok: false, moved, kept: keptIn(restoreDir), because: `the restored ${name} could not be moved into the new Kosmos` };
    }
  }
  return { ok: true, moved, kept: keptIn(restoreDir) };
}

/* What stayed in the restore folder, for the screen: projects and agent folders kept elsewhere, transcripts. The
   sink's own record and lock are not the person's files. */
function keptIn(restoreDir) {
  let names = [];
  try { names = fs.readdirSync(restoreDir); } catch { return []; }
  return names.filter((n) => n !== RECORD_NAME && n !== LOCK_NAME).sort();
}

function briefIn(dir) {
  for (const b of BRIEFS) {
    try { if (fs.lstatSync(path.join(dir, b)).isFile()) return b; } catch { /* next */ }
  }
  return null;
}

/* opts: { base, world, restoreDir, nameOk? }. { agents: [{ folder, from, name, dir, brief, because }], more }.
   `because` null means the screen may offer to enable it (create.installJob on that name, under this world's roots);
   otherwise it is the plain reason it cannot be. Nothing is registered, started or written. */
function listRestoredAgents(opts = {}) {
  const nameOk = opts.nameOk || ((n) => require('./create').NAME_RE.test(n));
  let roots = {}, dir = null;
  try { roots = worlds.envOverridesFor(opts.base, opts.world); dir = worlds.worldBaseDir(opts.base, opts.world); } catch { roots = {}; }
  const agents = [];
  let more = false;
  const scan = (parent, from) => {
    if (!parent || !realDir(parent)) return;
    let entries = [];
    try { entries = fs.readdirSync(parent).sort(); } catch { return; }
    for (const folder of entries) {
      if (agents.length >= MAX_LISTED) { more = true; return; }
      const dir = path.join(parent, folder);
      let st;
      try { st = fs.lstatSync(dir); } catch { continue; }
      if (st.isSymbolicLink()) { agents.push({ folder, from, name: null, dir, brief: null, because: 'it is a link to somewhere else, so it was not opened' }); continue; }
      if (!st.isDirectory()) continue;
      const brief = briefIn(dir);
      let because = null, name = null;
      if (from === 'elsewhere') because = 'its folder was kept outside the workers folder, so it cannot be started from where it is';
      else if (!nameOk(folder)) because = 'its folder name cannot be used to start it here';
      else name = folder;
      if (!because && !brief) because = 'it has no instructions file, so it may not be an agent';
      agents.push({ folder, from, name, dir, brief, because });
    }
  };
  scan(roots.AGENT_WORKFORCE_WORKERS, 'workers');
  // Only the restore folder made for this world is read (as finishRestoreWorld moves only from it).
  if (dir && opts.restoreDir === path.join(dir, RESTORE_DIR)) scan(path.join(opts.restoreDir, 'agents'), 'elsewhere');
  return { agents, more };
}

module.exports = { prepareRestoreWorld, finishRestoreWorld, listRestoredAgents, worldName, RESTORE_DIR };
