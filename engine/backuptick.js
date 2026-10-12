'use strict';
/**
 * kosmos#5535 E0.6 slice (d): what a company backup covers, and the hourly tick that runs it.
 *
 * rootsFor(input) -> { roots, left } builds backupsnapshot's `roots` for the active world. The card's scope is "agent
 * folders and their files, transcripts, projects, work products; never credentials":
 *   workers           the workers root, every agent folder in it. REQUIRED: a snapshot without it is not a backup.
 *   projects          the projects root, when it is not inside the workers root (optional).
 *   elsewhere/<slug>  a project whose folder is outside both (optional).
 *   agents/<id>       an agent folder outside the workers root (optional).
 *   sessions/<id>/... each agent's transcripts, from backupsessions.sessionsFor (optional, `only` lists).
 * Names never nest (backupsnapshot refuses `projects` beside `projects/x`), hence `elsewhere/`. A folder inside one
 * already covered is not added again. Every root but `workers` is optional, so one folder that cannot be read is left
 * out and named in the snapshot's skipped list rather than failing the backup.
 * NOT covered, on purpose: the data root (keys, the backup state itself, pairing, codex-homes). Its credentials are what
 * the card says never to take, and what is left is Kosmos's own state, not the person's work.
 * Known gap: per-session Codex homes (<data root>/codex-homes/<session>) are not transcript roots; sessionsFor takes
 * one codexHome. `left` names what was not added and why (an id or slug a root name cannot carry), never a path.
 *
 * startTick(deps) -> stop(). Every `everyMs` (an hour): only while deps.enrolled() is true (this Kosmos is enrolled
 * with a company), and never while a run is still going (a tick then is skipped, not queued). Pauses:
 *   backup_off (Kosmos+ answers 404 backup_off while company backup is off) -> no request for a day;
 *   overAllowance -> none until the next week starts (the allowance is per week).
 * A reason a person must act on (refusedState, missing, unreadableKeyFile) is said once (deps.say) until it changes or
 * a run succeeds, never every hour. Never throws.
 */
const path = require('path');
const fs = require('fs');

const SEGMENT = /^[a-z0-9][a-z0-9-]{0,31}$/;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function real(p) { try { return fs.realpathSync(p); } catch { return null; } }
function inside(child, parent) {
  if (!child || !parent) return false;
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/* input: { workersDir, agents: [{ id, dir }], projectsDir?, projects: [{ slug, folder }], sessions: (dir, id) -> roots } */
function rootsFor(input) {
  const roots = [], left = [];
  const workers = real(input.workersDir);
  if (!workers) return { roots, left: [{ what: 'workers', why: 'the workers folder could not be found' }] };
  roots.push({ name: 'workers', path: workers });
  const covered = [workers];
  const isCovered = (p) => covered.some((c) => inside(p, c));
  const projectsDir = input.projectsDir ? real(input.projectsDir) : null;
  if (projectsDir && !isCovered(projectsDir)) { roots.push({ name: 'projects', path: projectsDir, optional: true }); covered.push(projectsDir); }
  for (const p of input.projects || []) {
    const f = p && typeof p.folder === 'string' && path.isAbsolute(p.folder) ? real(p.folder) : null;
    if (!f || isCovered(f)) continue;
    if (typeof p.slug !== 'string' || !SEGMENT.test(p.slug)) { left.push({ what: 'a project', why: 'its name cannot be a backup root name' }); continue; }
    roots.push({ name: `elsewhere/${p.slug}`, path: f, optional: true }); covered.push(f);
  }
  for (const a of input.agents || []) {
    const d = a && typeof a.dir === 'string' && path.isAbsolute(a.dir) ? real(a.dir) : null;
    if (!d) continue;
    const idOk = typeof a.id === 'string' && SEGMENT.test(a.id);
    if (!isCovered(d)) {
      if (!idOk) { left.push({ what: 'an agent folder', why: 'its name cannot be a backup root name' }); continue; }
      roots.push({ name: `agents/${a.id}`, path: d, optional: true }); covered.push(d);
    }
    if (!idOk) { left.push({ what: 'an agent\'s transcripts', why: 'its name cannot be a backup root name' }); continue; }
    let s = [];
    try { s = input.sessions ? input.sessions(d, a.id) : []; } catch { s = []; }
    for (const r of s) roots.push(r);
  }
  return { roots, left };
}

/* The start of the ISO week after `ms` (Monday 00:00 UTC), when a week's allowance is new again. */
function nextWeekStart(ms) {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7;   // Monday 0
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 7);
}

/* deps: { runBackup, roots: () => roots, enrolled: () => bool, say?: (text) => void, now?, everyMs?, setInterval?, clearInterval? } */
function startTick(deps) {
  const now = deps.now || Date.now;
  const every = Number.isSafeInteger(deps.everyMs) && deps.everyMs > 0 ? deps.everyMs : HOUR;
  const state = { running: false, pausedUntil: 0, said: null };
  async function tick() {
    try {
      if (state.running || now() < state.pausedUntil || !deps.enrolled()) return;
      state.running = true;
      let r;
      try { r = await deps.runBackup({ roots: deps.roots() }); } finally { state.running = false; }
      if (!r || typeof r !== 'object') return;
      if (r.refusal && r.refusal.code === 'backup_off') state.pausedUntil = now() + DAY;
      else if (r.overAllowance) state.pausedUntil = nextWeekStart(now());
      const act = r.refusedState ? 'refusedState' : r.missing ? 'missing' : r.unreadableKeyFile ? 'unreadableKeyFile' : null;
      if (r.ok) state.said = null;
      else if (act && state.said !== act) { state.said = act; if (deps.say) deps.say(`company backup: ${r.because}`); }
    } catch { /* never throws; the next tick tries again */ }
  }
  const t = (deps.setInterval || setInterval)(tick, every);
  if (t && typeof t.unref === 'function') t.unref();
  return Object.assign(() => (deps.clearInterval || clearInterval)(t), { tick, state });
}

/* The inputs for rootsFor on this computer's active world. Agents: every profile, and every folder in the workers root
   (an agent whose profile write failed still has transcripts), each resolved with create.workerDir. Projects: the
   stored list, each by its id. Claude config roots SORTED by folder name (backupsessions numbers them by position, and
   status.configRoots' order is readdir's). A source that cannot be read gives nothing; never throws. */
function inputsHere() {
  const store = require('./store');
  const create = require('./create');
  const names = new Set();
  try { for (const f of fs.readdirSync(store.PROFILES)) if (f.endsWith('.json')) names.add(f.slice(0, -5)); } catch { /* none yet */ }
  try { for (const e of fs.readdirSync(create.WORKERS_DIR, { withFileTypes: true })) if (e.isDirectory() && !e.name.startsWith('.')) names.add(e.name); } catch { /* none yet */ }
  const agents = [];
  for (const id of names) { try { agents.push({ id, dir: create.workerDir(id) }); } catch { /* left out */ } }
  let projects = [];
  try { projects = require('./projects').readAll().map((p) => ({ slug: p && p.id, folder: p && p.folder })); } catch { /* unreadable: none */ }
  let projectsDir = null;
  try { projectsDir = require('./projects').projectsRoot(); } catch { /* none */ }
  let claudeRoots = [];
  try { claudeRoots = [...require('./status').configRoots()].sort((x, y) => path.basename(x).localeCompare(path.basename(y))); } catch { /* none */ }
  let geminiHome, codexHome;
  try { geminiHome = require('./geminisession').HOME(); } catch { /* none */ }
  try { codexHome = require('./codexupdate').defaultHome(); } catch { /* none */ }
  const sessions = (dir, id) => require('./backupsessions').sessionsFor(dir, { id, claudeRoots, geminiHome, codexHome });
  return { workersDir: create.WORKERS_DIR, projectsDir, agents, projects, sessions };
}

/* The board's own tick: enrolled here (orgenroll.isEnrolledHere, the check /api/org uses), the roots of this world, the
   real run. say: one console line, which reaches the board's log. */
function startHere() {
  return startTick({
    runBackup: (input) => require('./backuprun').runBackup(input),
    roots: () => rootsFor(inputsHere()).roots,
    enrolled: () => { try { return require('./orgenroll').isEnrolledHere() === true; } catch { return false; } },
    say: (text) => console.error(text),
  });
}

module.exports = { rootsFor, startTick, nextWeekStart, inputsHere, startHere };
