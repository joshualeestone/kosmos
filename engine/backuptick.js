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
 * KNOWN GAP in transcripts (review 5), kosmos#5883: backupsessions takes ONE Codex home and ONE Gemini home
 * and has no Grok case, so these transcripts are NOT backed up: agents on a ~/.codex-<label> or ~/.gemini-<label>
 * account, per-session Codex homes (<data root>/codex-homes/<session>), and every Grok agent. Their agent FOLDERS are
 * backed up (under workers or agents/<id>); only the provider's record of the conversation is missing.
 * `left` names what was not added and why (an id or slug a root name cannot carry), never a path.
 *
 * startTick(deps) -> stop(). Every `everyMs` (an hour): only while deps.enrolled() is true (this Kosmos is enrolled
 * with a company), and never while a run is still going (a tick then is skipped, not queued). Pauses:
 *   backup_off (Kosmos+ answers 404 backup_off while company backup is off) -> no request for a day;
 *   overAllowance -> none until the next week starts (the allowance is per week).
 * A reason a person must act on (refusedState, missing, unreadableKeyFile, overAllowance) is said once (deps.say) until
 * it changes or a run succeeds, never every hour. Never throws.
 */
const path = require('path');
const fs = require('fs');

const SEGMENT = /^[a-z0-9][a-z0-9-]{0,31}$/;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/* The folder as the disk spells it (review 3): plain realpathSync keeps the case it was given, and macOS volumes are
   case-insensitive, so /users/me/library and /Users/me/Library are one folder that a string comparison calls two. The
   native form returns the true spelling, so every comparison here (protection, nesting) is between true spellings. */
function real(p) { try { return fs.realpathSync.native(p); } catch { return null; } }
function inside(child, parent) {
  if (!child || !parent) return false;
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/* input: { workersDir, agents: [{ id, dir }], projectsDir?, projects: [{ slug, folder }], sessions: (dir, id) -> roots,
   protect?: [folders] }. protect: the data root and each provider's config home. A root that holds one, or sits inside
   one, is refused (review 1): the card says never credentials, and backupscan's name rules alone are the wrong place to
   rely on for a whole folder of them (the backup state itself has no name rule).
   Nesting, both ways (review 1): backupsnapshot drops BOTH optional roots of a nested pair, so a root that holds roots
   already added replaces them (it covers their files), and one inside a root already added is not added. A root that
   would hold the workers folder is refused instead: workers is the one required root. */
function rootsFor(input) {
  const roots = [], left = [];
  const workers = real(input.workersDir);
  if (!workers) return { roots, left: [{ what: 'workers', why: 'the workers folder could not be found' }] };
  // A protected entry that is not a full path fails CLOSED (review 2): no roots, said. One that does not exist protects
  // nothing, since there is nothing there to take.
  if ((input.protect || []).some((x) => typeof x !== 'string' || !path.isAbsolute(x))) {
    return { roots, left: [{ what: 'everything', why: 'a folder that must never be backed up was not given as a full path' }] };
  }
  const protect = (input.protect || []).map(real).filter(Boolean);
  const guarded = (p) => protect.some((q) => inside(p, q) || inside(q, p));
  const GUARDED = 'it holds, or is inside, Kosmos\'s own data or a provider\'s sign-in folder';
  if (guarded(workers)) return { roots, left: [{ what: 'workers', why: GUARDED }] };
  roots.push({ name: 'workers', path: workers });
  const add = (name, p, what) => {
    if (roots.some((r) => !r.only && inside(p, r.path))) return;
    if (inside(workers, p)) { left.push({ what, why: 'it holds the workers folder' }); return; }
    if (guarded(p)) { left.push({ what, why: GUARDED }); return; }
    // The snapshot's own name rule (review 2): `secrets` or `aux` passes SEGMENT and is refused there, silently.
    if (snapshotNameProblem(name)) { left.push({ what, why: 'its name cannot be a backup root name' }); return; }
    for (let i = roots.length - 1; i >= 1; i--) if (!roots[i].only && inside(roots[i].path, p)) roots.splice(i, 1);
    roots.push({ name, path: p, optional: true });
  };
  const projectsDir = input.projectsDir ? real(input.projectsDir) : null;
  if (projectsDir) add('projects', projectsDir, 'the projects folder');
  for (const p of input.projects || []) {
    const f = p && typeof p.folder === 'string' && path.isAbsolute(p.folder) ? real(p.folder) : null;
    if (!f) continue;
    if (roots.some((r) => !r.only && inside(f, r.path))) continue;
    if (typeof p.slug !== 'string' || !SEGMENT.test(p.slug)) { left.push({ what: 'a project', why: 'its name cannot be a backup root name' }); continue; }
    add(`elsewhere/${p.slug}`, f, 'a project');
  }
  for (const a of input.agents || []) {
    const d = a && typeof a.dir === 'string' && path.isAbsolute(a.dir) ? real(a.dir) : null;
    if (!d) continue;
    const idOk = typeof a.id === 'string' && SEGMENT.test(a.id);
    if (!roots.some((r) => !r.only && inside(d, r.path))) {
      if (!idOk) left.push({ what: 'an agent folder', why: 'its name cannot be a backup root name' });
      else add(`agents/${a.id}`, d, 'an agent folder');
    }
    if (!idOk) { left.push({ what: 'an agent\'s transcripts', why: 'its name cannot be a backup root name' }); continue; }
    let s = [];
    // As Kosmos recorded the folder, not its true spelling (review 4): a transcript records the folder its agent was
    // started in, and backupsessions matches by that.
    try { s = input.sessions ? input.sessions(a.dir, a.id) : []; } catch { s = []; }
    for (const r of s) roots.push(r);
  }
  // Transcript roots (`only` lists) last, against every folder root (review 2): a provider folder may be a link, so its
  // real path can sit inside, or hold, a root added after it was listed, and the snapshot would drop both. Inside one:
  // its files are already covered there. Holding one: left out, and said.
  // Their `path` stays as backupsessions gave it (the snapshot requires it to equal its plain realpath); compared here
  // by its true spelling, as everything else is.
  for (let i = roots.length - 1; i >= 0; i--) {
    const r = roots[i];
    if (!r.only) continue;
    const rp = real(r.path) || r.path;
    const outer = roots.find((o) => !o.only && inside(rp, o.path));
    const holds = roots.find((o) => !o.only && inside(o.path, rp));
    if (outer) roots.splice(i, 1);
    else if (holds) { roots.splice(i, 1); left.push({ what: 'an agent\'s transcripts', why: 'their folder holds another folder being backed up' }); }
  }
  return { roots, left };
}
function snapshotNameProblem(name) { try { return require('./backupsnapshot').rootNameProblem(name); } catch { return 'unknown'; } }

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
  const state = { running: false, pausedUntil: 0, said: null, saidLeft: '', blind: 0 };
  const say = (text) => { try { if (deps.say) deps.say(`company backup: ${text}`); } catch { /* a log line */ } };
  async function tick() {
    try {
      if (state.running || now() < state.pausedUntil || !deps.enrolled()) return;
      // roots() gives rootsFor's { roots, left } (or a bare list). What was left out is said once per change (review 1).
      let plan;
      try { plan = deps.roots(); } catch {
        // Said once (review 2): otherwise no backup, every hour, and nothing said.
        if (state.saidLeft !== 'threw') say('the folders to back up could not be listed on this computer');
        state.saidLeft = 'threw';
        return;
      }
      const roots = Array.isArray(plan) ? plan : (plan && plan.roots) || [];
      const leftKey = JSON.stringify((plan && plan.left) || []);
      if (leftKey !== '[]' && leftKey !== state.saidLeft) say(`left out: ${plan.left.map((l) => `${l.what} (${l.why})`).join('; ')}`);
      state.saidLeft = leftKey;
      // No workers root, no backup and no request: the run would only ask Kosmos+ for a key to refuse afterwards.
      if (!roots.some((r) => r && r.name === 'workers')) return;
      state.running = true;
      let r;
      try { r = await deps.runBackup({ roots }); } catch {
        // runBackup never throws by contract; one that does is said once (review 4), not swallowed every hour.
        if (state.said !== 'threw') { state.said = 'threw'; say('the backup stopped on an unexpected error on this computer'); }
        return;
      } finally { state.running = false; }
      if (!r || typeof r !== 'object') return;
      // Refused before Kosmos+ named the company (no pair): Kosmos+ is unreachable, refuses, or an older connector will
      // not sign and so gives no refusal code (review 1). Backed off, doubling to a day, so an enrolled Mac does not
      // send a request every hour for as long as it lasts. backup_off and overAllowance have their own pauses.
      if (!r.ok && !r.pair && !(r.refusal && r.refusal.code === 'backup_off') && !r.missing) {
        state.blind += 1;
        state.pausedUntil = now() + Math.min(HOUR * 2 ** Math.min(state.blind - 1, 5), DAY);
      } else state.blind = 0;
      if (r.refusal && r.refusal.code === 'backup_off') state.pausedUntil = now() + DAY;
      else if (r.overAllowance) state.pausedUntil = nextWeekStart(now());
      const act = r.refusedState ? 'refusedState' : r.missing ? 'missing' : r.unreadableKeyFile ? 'unreadableKeyFile' : r.overAllowance ? 'overAllowance' : null;
      if (r.ok) state.said = null;
      else if (act && state.said !== act) { state.said = act; say(typeof r.because === 'string' && r.because ? r.because : 'it did not run, and did not say why'); }
    } catch { /* never throws; the next tick tries again */ }
  }
  const t = (deps.setInterval || setInterval)(tick, every);
  if (t && typeof t.unref === 'function') t.unref();
  return Object.assign(() => (deps.clearInterval || clearInterval)(t), { tick, state });
}

/* The inputs for rootsFor on this computer's active world. Agents: every profile, and every folder in the workers root
   (an agent whose profile write failed still has transcripts), each resolved with create.workerDir. Projects: the
   stored list, each by its id. Claude config roots SORTED by full path (backupsessions numbers them by position, and
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
  // By full path (review 2): two roots with one basename would tie, and the -<n> names would swap between snapshots.
  try { claudeRoots = [...require('./status').configRoots()].sort(); } catch { /* none */ }
  let geminiHome, codexHome;
  try { geminiHome = require('./geminisession').HOME(); } catch { /* none */ }
  try { codexHome = require('./codexupdate').defaultHome(); } catch { /* none */ }
  const sessions = (dir, id) => require('./backupsessions').sessionsFor(dir, { id, claudeRoots, geminiHome, codexHome });
  // Never inside a root, never holding one (reviews 1 and 5): Kosmos's own data, every provider's config home and every
  // ACCOUNT folder (~/.codex-<label>, ~/.gemini-<label>, ~/.grok and its accounts), and every hidden entry directly in
  // the home folder (~/.ssh, ~/.aws, ~/.config, a provider not listed here yet). The last makes any root that holds the
  // home folder refused, whatever lives there: the provider lists are best effort, the home rule is not.
  const accountDirs = [];
  for (const m of ['openaiaccounts', 'geminiaccounts', 'grokaccounts']) {
    try { for (const row of require(`./${m}`).list()) if (row && typeof row.dir === 'string') accountDirs.push(row.dir); } catch { /* the home rule still holds */ }
  }
  try { accountDirs.push(require('./grokaccounts').defaultDir()); } catch { /* the home rule still holds */ }
  const home = process.env.AGENT_WORKFORCE_HOME || require('os').homedir();
  const hidden = [];
  try { for (const n of fs.readdirSync(home)) if (n.startsWith('.') && n !== '.' && n !== '..') hidden.push(path.join(home, n)); } catch { /* none */ }
  const protect = [store.ROOT, ...claudeRoots, geminiHome, codexHome, ...accountDirs, ...hidden]
    .filter((x) => typeof x === 'string' && x).map((x) => path.resolve(x));
  return { workersDir: create.WORKERS_DIR, projectsDir, agents, projects, sessions, protect };
}

/* The board's own tick: enrolled here (orgenroll.isEnrolledHere, the check /api/org uses), the roots of this world, the
   real run. say: one console line, which reaches the board's log. */
function startHere() {
  return startTick({
    runBackup: (input) => require('./backuprun').runBackup(input),
    roots: () => rootsFor(inputsHere()),
    enrolled: () => { try { return require('./orgenroll').isEnrolledHere() === true; } catch { return false; } },
    say: (text) => console.error(text),
  });
}

module.exports = { rootsFor, startTick, nextWeekStart, inputsHere, startHere };
