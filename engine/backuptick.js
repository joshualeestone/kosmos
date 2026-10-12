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
 *   sessions/<id>/... each agent's transcripts, from backupsessions.sessionsFor (optional, `only` lists); input.sessions
 *                     is called (dir, rootSegment, the agent's stored name). These sit
 *                     INSIDE a protected provider home by design, so they are not put through the protection check:
 *                     their safety is backupsessions' file lists (session files only, never the sign-ins beside them).
 * Names never nest (backupsnapshot refuses `projects` beside `projects/x`), hence `elsewhere/`. A folder inside one
 * already covered is not added again. Every root but `workers` is optional, so one folder that cannot be read is left
 * out and named in the snapshot's skipped list rather than failing the backup.
 * NOT covered, on purpose: the data root (keys, the backup state itself, pairing, codex-homes). Its credentials are what
 * the card says never to take, and what is left is Kosmos's own state, not the person's work.
 * Transcripts are read from each agent's OWN Codex or Gemini home, from its launch job (kosmos#5883 slice 1: named
 * accounts and Codex runtime homes). KNOWN GAP still open on #5883: backupsessions has no Grok case, so Grok agents'
 * transcripts are NOT backed up. Their agent FOLDERS are (under workers or agents/<id>).
 * `left` names what was not added and why (an id or slug a root name cannot carry), never a path.
 *
 * startTick(deps) -> stop(). Every `everyMs` (an hour): only while deps.enrolled() is true (the board passes mayBackUp:
 * enrolled with a company AND its words accepted here), and never while a run is still going (a tick then is skipped, not queued). Pauses:
 *   backup_off (Kosmos+ answers 404 backup_off while company backup is off) -> no request for a day;
 *   overAllowance -> none until the next week starts (the allowance is per week).
 * A reason a person must act on (refusedState, missing, unreadableKeyFile, overAllowance) is said once (deps.say) until
 * it changes or a run succeeds, never every hour. Never throws.
 */
const path = require('path');
const fs = require('fs');

const SEGMENT = /^[a-z0-9][a-z0-9-]{0,31}$/;
/* The root-name segment for an agent's name or a project's id (review 9). Kosmos names allow `_` and project ids run to
   64 characters, so refusing every id the root-name rule cannot carry dropped real agents and projects. An id that is
   already a good segment (and one the snapshot accepts as agents/<id>) is kept as is; any other becomes its cleaned
   form plus 8 hex of its SHA-256: stable across snapshots, and two ids that clean alike (a_b, a-b) never share one. */
function rootSegment(id) {
  if (typeof id !== 'string' || !id) return null;
  if (SEGMENT.test(id) && !snapshotNameProblem(`agents/${id}`)) return id;
  const base = id.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'x';
  const seg = `${base}-${require('crypto').createHash('sha256').update(id).digest('hex').slice(0, 8)}`;
  return SEGMENT.test(seg) ? seg : null;
}
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/* The folder as the disk spells it (review 3): plain realpathSync keeps the case it was given, and macOS volumes are
   case-insensitive, so /users/me/library and /Users/me/Library are one folder that a string comparison calls two. The
   native form returns the true spelling, so every comparison here (protection, nesting) is between true spellings. */
function real(p) { try { return fs.realpathSync.native(p); } catch { return null; } }
function inside(child, parent) {
  if (!child || !parent) return false;
  const rel = path.relative(parent, child);
  // '..' as a path PART, never a name that starts with it (review 8: ~/.ssh/..x is inside ~/.ssh).
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}

/* input: { workersDir, agents: [{ id, dir }], projectsDir?, projects: [{ slug, folder }], sessions: (dir, rootSegment, storedName) -> roots,
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
  // Fails closed when protection is incomplete (review 8): a protected folder that exists but cannot be resolved, or a
  // home folder inputsHere could not list. One that does not exist protects nothing and is dropped.
  const protect = [];
  for (const x of input.protect || []) {
    try { protect.push(fs.realpathSync.native(x)); } catch (err) {
      if (!err || err.code !== 'ENOENT') return { roots, left: [{ what: 'everything', why: 'a folder that must never be backed up could not be checked' }] };
    }
  }
  if (input.protectIncomplete) return { roots, left: [{ what: 'everything', why: 'a folder that must never be backed up could not be checked' }] };
  const guarded = (p) => protect.some((q) => inside(p, q) || inside(q, p));
  const GUARDED = 'it holds, or is inside, Kosmos\'s own data, a provider\'s sign-in folder, or a hidden folder in the home folder';
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
    const seg = rootSegment(p.slug);
    if (!seg) { left.push({ what: 'a project', why: 'it has no name' }); continue; }
    add(`elsewhere/${seg}`, f, 'a project');
  }
  for (const a of input.agents || []) {
    const d = a && typeof a.dir === 'string' && path.isAbsolute(a.dir) ? real(a.dir) : null;
    if (!d) continue;
    const seg = rootSegment(a.id);
    const idOk = !!seg;
    if (!roots.some((r) => !r.only && inside(d, r.path))) {
      if (!idOk) left.push({ what: 'an agent folder', why: 'it has no name' });
      else add(`agents/${seg}`, d, 'an agent folder');
    }
    if (!idOk) { left.push({ what: 'an agent\'s transcripts', why: 'it has no name' }); continue; }
    let s = [];
    // As Kosmos recorded the folder, not its true spelling (review 4): a transcript records the folder its agent was
    // started in, and backupsessions matches by that.
    try { s = input.sessions ? input.sessions(a.dir, seg, a.id) : []; } catch { s = []; }
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
      // Cleared by any run that ends without a reason a person acts on (review 7), so one that comes back is said again.
      if (r.ok || !act) state.said = null;
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
   status.configRoots' order is readdir's). A source that cannot be read gives nothing; never throws.
   deps (tests): readJob(name), sessionsFor(dir, opts). */
function inputsHere(deps = {}) {
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
  // The homes AGENTS are launched against (review 3): `sessions/<id>/codex` and `.../gemini` name these for EVERY agent,
  // so the folder behind those names never depends on the agent's runner or on the board's own CODEX_HOME or
  // GEMINI_CLI_HOME. The board's homes above stay in `protect`.
  let agentCodexHome = codexHome, agentGeminiHome = geminiHome;
  try { agentCodexHome = create.defaultAgentCodexHome(); } catch { /* the board's */ }
  try { agentGeminiHome = create.geminiStorageHome(null); } catch { /* the board's */ }
  // Each agent's OWN provider homes (kosmos#5883), from its launch job. The board reads ONE home (the current session);
  // a backup owes EVERY conversation (review 1), so it reads each home the agent's sessions can be in. Each root is
  // named for its FOLDER, never its role (review 2: a role name moved to another folder when the agent changed account,
  // and the same files were stored again under the new name): the default home is `codex` / `gemini` (as before this
  // change), the runtime home (#4592) `codex-runtime`, and a named account's home `codex-a<8 hex of its path>` /
  // `gemini-a<...>`. Every one is filtered to this agent's own files (backupsessions). The homes come from the helpers
  // the board's readers use (create.defaultAgentCodexHome, create.geminiStorageHome). An agent whose job cannot be
  // read keeps the plain defaults. NOT covered: a move between two NAMED accounts leaves the first account's sessions
  // unread (#5883).
  // Hashed on the folder's TRUE path (review 4): a job naming the account through a link or another spelling gets the
  // same name, so its rollouts are not stored again. A folder that does not resolve hashes as given.
  const acctTag = (home) => {
    let p = path.resolve(home);
    try { p = fs.realpathSync.native(p); } catch { /* as given */ }
    return '-a' + require('crypto').createHash('sha256').update(p).digest('hex').slice(0, 8);
  };
  const sessions = (dir, id, name) => {
    let job = null;
    try { job = (deps.readJob || create.readJob)(name); } catch { job = null; }
    const cx = agentCodexHome, gm = agentGeminiHome;
    const moreHomes = [];
    // Each lookup on its own (review 3): one that throws must not take the others with it.
    if (job && job.runner === 'codex') {
      if (job.configDir) { try { moreHomes.push({ provider: 'codex', home: job.configDir, tag: acctTag(job.configDir) }); } catch { /* left */ } }
      try {
        const runtime = require('./codexruntime').forAgent(name);
        if (fs.existsSync(runtime)) moreHomes.push({ provider: 'codex', home: runtime, tag: '-runtime' });
      } catch { /* left */ }
    } else if (job && job.runner === 'gemini' && job.configDir) {
      try { moreHomes.push({ provider: 'gemini', home: create.geminiStorageHome(job.configDir), tag: acctTag(job.configDir) }); } catch { /* left */ }
    }
    return (deps.sessionsFor || require('./backupsessions').sessionsFor)(dir, { id, claudeRoots, geminiHome: gm, codexHome: cx, moreHomes });
  };
  // Never inside a root, never holding one (reviews 1 and 5): Kosmos's own data, every provider's config home and every
  // ACCOUNT folder (~/.codex-<label>, ~/.gemini-<label>, ~/.grok and its accounts), and every hidden entry directly in
  // the home folder (~/.ssh, ~/.aws, ~/.config, a provider not listed here yet). The last makes any root that holds the
  // home folder refused, whatever lives there: the provider lists are best effort, the home rule is not.
  const accountDirs = [];
  for (const m of ['openaiaccounts', 'geminiaccounts', 'grokaccounts']) {
    try { for (const row of require(`./${m}`).list()) if (row && typeof row.dir === 'string') accountDirs.push(row.dir); } catch { /* the home rule still holds */ }
  }
  try { accountDirs.push(require('./grokaccounts').defaultDir()); } catch { /* the home rule still holds */ }
  // Both homes when they differ (review 6): the providers and workers use AGENT_WORKFORCE_HOME, projectsRoot the real one.
  const hidden = [];
  let protectIncomplete = false;
  for (const home of new Set([process.env.AGENT_WORKFORCE_HOME, require('os').homedir()].filter(Boolean))) {
    try { for (const n of fs.readdirSync(home)) if (n.startsWith('.') && n !== '.' && n !== '..') hidden.push(path.join(home, n)); } catch (err) {
      if (!err || err.code !== 'ENOENT') protectIncomplete = true;   // fail closed in rootsFor (review 8)
    }
  }
  // Windows keeps browser password stores and Credential Manager files under %USERPROFILE%\\AppData, which is not
  // dot-named (review 9): protected whole.
  const winAppData = process.platform === 'win32' ? [path.join(process.env.USERPROFILE || require('os').homedir(), 'AppData')] : [];
  const protect = [store.ROOT, ...claudeRoots, geminiHome, codexHome, agentGeminiHome, agentCodexHome, ...accountDirs, ...hidden, ...winAppData]
    .filter((x) => typeof x === 'string' && x).map((x) => path.resolve(x));
  return { workersDir: create.WORKERS_DIR, projectsDir, agents, projects, sessions, protect, protectIncomplete };
}

/* May this computer back up to its company now? orgenroll.mayReport, the gate orgenroll names for EVERY sender, E0.6
   backup included (review 7): enrolled here AND the company's words accepted here (a consentHash on the record). NOT
   isEnrolledHere: a record re-adopted after a move that could not be written, or rebuilt after a last-admin refusal,
   is enrolled with no consent, and nothing may be sent under it. */
function mayBackUp() {
  try { return require('./orgenroll').mayReport() === true; } catch { return false; }
}

/* The board's own tick: mayBackUp, the roots of this world, the real run. say: one console line, which reaches the
   board's log. RESIDUAL: the gate is asked when a run starts; a Leave during a run does not stop that run's uploads (a
   rollup re-asks per batch). A run is bounded by the week's allowance and is one an hour at most. */
function startHere() {
  return startTick({
    runBackup: (input) => require('./backuprun').runBackup(input),
    roots: () => rootsFor(inputsHere()),
    enrolled: mayBackUp,
    say: (text) => console.error(text),
  });
}

module.exports = { rootsFor, startTick, nextWeekStart, inputsHere, startHere, mayBackUp };
