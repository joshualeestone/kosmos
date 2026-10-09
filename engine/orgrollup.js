'use strict';
/**
 * kosmos#5532 (Enterprise E0.3, umbrella #5529): the rollup a work Kosmos sends its company, daily and on change.
 * The contract is PigeonPete's (kosmos-relay `.claude/plans/rollup3-5532.md`): `POST /v1/mac/org/rollup`, Mac-signed.
 *
 * 🔑 NO CONTENT, BY CONSTRUCTION. build() takes plain fields (names, provider, model, a status word, token counts) and
 * nothing else: it is never handed a task, a chat, a file, a folder or a path, so it cannot send one. Every string is
 * cleaned and bounded by engine/externalname.js (the coordinator REFUSES a string over 200 characters, so 120 here is
 * the contract with room to spare).
 *
 * 🔑 BOUNDED SO IT ALWAYS ARRIVES. mac-request refuses a body over 64 KB and the coordinator refuses over 60 KB, and
 * then nothing arrives at all. So: at most AGENTS_MAX agents, PROJECTS_MAX projects (NAMES_MAX names each),
 * USAGE_DAYS days of USAGE_ROWS_PER_DAY rows, and the serialized body is measured and trimmed to BODY_MAX bytes.
 * Anything left out sets `truncated: true`; nothing is ever refused here.
 *
 * build() is pure (no file, no network). gather() reads the board; tick() keeps a small state file and sends.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { externalName } = require('./externalname');
const usageprice = require('./usageprice');

const ROUTE = '/v1/mac/org/rollup';
const VERSION = 1;
const NAME_MAX = 120;
const AGENTS_MAX = 200;
const PROJECTS_MAX = 200;
const NAMES_MAX = 50;
const USAGE_DAYS = 7;
const USAGE_ROWS_PER_DAY = 40;
/** Bytes, measured on the serialized body: under the coordinator's 60 KB refusal with room for the signature. */
const BODY_MAX = 56 * 1024;

/* The board's agent states (engine/status.js STATE, plus the route's needs_trust) in the THREE words the consent names:
   "whether each is working, waiting or stopped" (rollup review 6). Fewer words than the board has, on purpose: the
   company is not told that an agent hit a rate limit, lost its account or connection, or could not be read. Anything
   on the board that is not working and not ended is waiting. */
const STATUS = Object.freeze({
  working: 'working', restarting: 'working',
  needs_you: 'waiting', needs_trust: 'waiting', blocked: 'waiting', rate_limited: 'waiting', auth_failed: 'waiting',
  connection_lost: 'waiting', idle: 'waiting', unknown: 'waiting',
  stopped: 'stopped',
});
function statusWord(state) {
  return Object.prototype.hasOwnProperty.call(STATUS, state) ? STATUS[state] : 'waiting';
}

/* A model id is one token: lower-case letters, digits and . _ : - , at most NAME_MAX. Anything with a space, a slash or
   other text after it (a pane line) is not one and is sent as null (rollup review 4). A known family, then at most six
   short dash-separated parts (claude-opus-5-5, gpt-5.1-codex, gemini-2.5-flash, claude-haiku-4-5-20251001). */
/* A family, then parts that are each a version number (5, 5.1, 2.5, 4o), a known tier word, or an 8-digit date: nothing
   a person could have named after a client or a project (review 7). */
const MODEL_PART = '(\\d+(\\.\\d+)*[a-z]?|opus|sonnet|haiku|fable|mini|nano|flash|pro|lite|codex|turbo|preview|latest|exp|\\d{8})';
const MODEL_ID = new RegExp('^(claude|gpt|o[134]|codex|gemini|grok|llama)(-' + MODEL_PART + '){0,6}$');
const PROVIDERS = new Set(['anthropic', 'openai', 'google', 'xai', 'meta', 'antigravity']);
/* The whole tag block too (rollup review 24): the coordinator refuses U+E0000 to U+E007F, and externalName leaves the
   unassigned ones; one such name would lose the whole rollup. */
const clean = (v) => externalName(typeof v === 'string' ? v.replace(/[\u{E0000}-\u{E007F}]/gu, '') : v, NAME_MAX) || null;
const iso = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
const day = (v) => { const t = iso(v); return t ? t.slice(0, 10) + 'T00:00:00.000Z' : null; };
/* A day after tomorrow (UTC) is a wrong clock, and the coordinator refuses the whole rollup for it: send no day instead. */
const notAfterTomorrow = (d, now = Date.now()) => {
  if (!d) return null;
  const t = new Date(now); const limit = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + 1);
  return Date.parse(d) > limit ? null : d;
};
const count = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : 0);

/* Which provider a model id belongs to, for a usage row (the usage files key by model only). */
function providerOfModel(model) {
  const m = String(model || '').toLowerCase();
  if (m.startsWith('claude')) return 'anthropic';
  if (m.startsWith('gpt') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4') || m.startsWith('codex')) return 'openai';
  if (m.startsWith('gemini')) return 'google';
  if (m.startsWith('grok')) return 'xai';
  if (m.startsWith('llama')) return 'meta';
  return null;
}

/**
 * The body. Inputs, all plain:
 *   world        this world's opaque id (orgenroll)
 *   at, reason   when, and 'daily' | 'change'
 *   agents       [{ name, provider, model, state }]
 *   projects     [{ name, agents: [agent name] }]
 *   usageByDay   { 'YYYY-MM-DD': { model: { input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens } } }
 *   lastActive, backupLastOk, policyVersion
 */
function build(input) {
  const i = input || {};
  // The clock the body is checked against: the tick's own (review 20), so build() is a pure function of its input.
  const nowMs = Number.isFinite(i.nowMs) ? i.nowMs : Date.now();
  let truncated = false;

  const agentsIn = Array.isArray(i.agents) ? i.agents : [];
  if (agentsIn.length > AGENTS_MAX) truncated = true;
  const agents = [];
  /* Once each by name, AFTER cleaning (rollup review 10): the coordinator refuses the WHOLE rollup when an agent is
     listed twice, and two different names can clean to one (two long names sharing their first characters). The first
     wins and the body says it was trimmed. */
  const change = i.reason === 'change';
  const agentSeen = new Set();
  for (const a of agentsIn.slice(0, AGENTS_MAX)) {
    const name = clean(a && a.name);
    if (!name) continue;
    if (agentSeen.has(name)) { truncated = true; continue; }
    agentSeen.add(name);
    const provider = PROVIDERS.has(a.provider) ? a.provider : null;
    /* A model is sent only when it names a known provider's family: the running model is read off a pane, so any
       other string is not a model id we can vouch for (rollup review 2). */
    const model = MODEL_ID.test(String(a.model || '')) && providerOfModel(a.model) ? a.model : null;
    /* A change send carries no status and no model (rollup review 10, as the contract says): those ride on the daily
       send only, so a change is not a record of when this person's agents run. */
    /* The provider goes on every send (rollup review 16: the company keeps only model and status across sends, so a
       change send without it would blank every provider until the next daily). gather() reads it from the record
       whether the agent runs or not, so it shows nothing about when agents run (review 14's concern). */
    agents.push({ name, provider, model: change ? null : model, status: change ? null : statusWord(a.state) });
  }

  const projectsIn = Array.isArray(i.projects) ? i.projects : [];
  if (projectsIn.length > PROJECTS_MAX) truncated = true;
  const projects = [];
  /* Once each by name too (rollup review 10): two projects may share a name on the board (two sub-projects called
     "Docs" under different parents), and the coordinator refuses a rollup listing a project twice. Same-named projects
     are sent as one, with their agents together. */
  const byName = new Map();
  for (const p of projectsIn.slice(0, PROJECTS_MAX)) {
    const name = clean(p && p.name);
    if (!name) continue;
    // Once each, after cleaning (two spellings can clean to one name): the coordinator refuses a project listing an agent twice.
    const names = (Array.isArray(p.agents) ? p.agents : []).map(clean).filter(Boolean);
    const into = byName.get(name);
    if (into) { into.agents.push(...names); continue; }
    const row = { name, agents: names };
    byName.set(name, row);
    projects.push(row);
  }
  for (const row of projects) {
    row.agents = [...new Set(row.agents)];
    if (row.agents.length > NAMES_MAX) { truncated = true; row.agents = row.agents.slice(0, NAMES_MAX); }
  }

  /* The last USAGE_DAYS days present, newest first; within a day the costliest rows first, so a trim drops the least. */
  const byDay = !i.usageWithheld && i.usageByDay && typeof i.usageByDay === 'object' ? i.usageByDay : {};
  // A real calendar day, not after tomorrow (review 18): the company refuses the WHOLE rollup for any other.
  const realDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d + 'T00:00:00Z')) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d && notAfterTomorrow(d, nowMs) === d;
  const days = Object.keys(byDay).filter(realDay).sort().reverse();
  if (days.length > USAGE_DAYS) truncated = true;
  const usage = [];
  for (const day of days.slice(0, USAGE_DAYS)) {
    const models = byDay[day] && typeof byDay[day] === 'object' ? byDay[day] : {};
    let rows = Object.keys(models).map((model) => {
      const b = models[model] || {};
      const row = {
        // The same rule as an agent's model (review 8): a usage key that is not a model id is dropped below.
        day, provider: providerOfModel(model), model: MODEL_ID.test(String(model)) && providerOfModel(model) ? model : null,
        input: count(b.input_tokens), output: count(b.output_tokens),
        cacheWrite: count(b.cache_creation_input_tokens), cacheRead: count(b.cache_read_input_tokens),
        costUsd: usageprice.costOf(model, b),   // null when the model has no published price, never 0
      };
      if (row.costUsd != null) row.costUsd = Math.round(row.costUsd * 1e6) / 1e6;
      return row;
    });
    /* A row with tokens but no model id we can vouch for is dropped (a null model would collide on the company's
       day/provider/model key), and the body says it was trimmed, so the company never reads an undercount as whole
       (rollup review 13). */
    if (rows.some((r) => !r.model && (r.input || r.output || r.cacheWrite || r.cacheRead))) truncated = true;
    rows = rows.filter((r) => r.model && (r.input || r.output || r.cacheWrite || r.cacheRead));
    rows.sort((x, y) => (y.costUsd || 0) - (x.costUsd || 0) || (y.input + y.output) - (x.input + x.output));
    if (rows.length > USAGE_ROWS_PER_DAY) truncated = true;
    usage.push(...rows.slice(0, USAGE_ROWS_PER_DAY));
  }

  const body = {
    v: VERSION,
    world: typeof i.world === 'string' ? i.world : null,
    at: iso(i.at) || new Date().toISOString(),
    reason: i.reason === 'change' ? 'change' : 'daily',
    policyVersion: clean(i.policyVersion),
    lastActive: notAfterTomorrow(day(i.lastActive), nowMs),   // the day only: "when you were last active", not a timeline (review 5)
    backup: { lastOk: iso(i.backupLastOk) },
    agents, projects, usage,
    /* Contract v1.1 (PigeonPete): while this board has no reader scoped to this world, usage is [] and usageWithheld
       says so, and the console shows "usage not reported yet", never 0. truncated means only a real trim or a partial
       read. */
    usageWithheld: i.usageWithheld === true,
    truncated: truncated || i.partial === true,   // a partial read is said, never sent as the whole picture
  };
  return fit(body);
}

/* Trim until the serialized body fits BODY_MAX: the oldest usage day's rows first, then projects from the end, then
   agents from the end. Each trim sets truncated. */
function fit(body) {
  const size = () => Buffer.byteLength(JSON.stringify(body), 'utf8');
  while (size() > BODY_MAX) {
    body.truncated = true;
    if (body.usage.length) {
      const oldest = body.usage[body.usage.length - 1].day;
      body.usage = body.usage.filter((r) => r.day !== oldest);
    } else if (body.projects.length) body.projects.pop();
    else if (body.agents.length) body.agents.pop();
    else break;
  }
  return body;
}

/* The real sources, behind one seam so tests can hand plain records instead. */
const KNOWN_RUNNERS = new Set(['claude', 'codex', 'gemini', 'grok', 'antigravity', 'muse']);
const KNOWN_PROVIDERS = new Set(['anthropic', 'openai', 'google', 'xai', 'antigravity', 'meta']);
function defaultSources() {
  const status = require('./status');
  const register = require('./register');
  const removal = require('./remove');
  const projects = require('./projects');
  const activity = require('./activity');
  const create = require('./create');
  return {
    snapshot: () => status.snapshot(),
    survey: () => register.survey(),
    removed: () => removal.removedAgents().filter((x) => removal.hidesCard(x)).map((x) => x.name),
    projects: () => projects.readAll(),
    /* A project linked from another Kosmos (federation: someone else's project joined here, or one from another computer
       of this account, which may be a personal Kosmos) is not this work Kosmos's to report (rollup review 7). */
    linkedProject: (id) => { try { return !!require('./federation').linkFor(id); } catch { return true; } },
    /* 🛑 NO usageByDay HERE (rollup review 1, a BLOCKER). engine/usage.js reads every Claude config folder on this
       computer (status.configRoots: ~/.claude, ~/.claude-*, CLAUDE_CONFIG_DIR), with no filter by world or agent, so
       its numbers include the person's other Kosmoses and their own sessions outside Kosmos. Sending them would break
       the one rule this whole feature rests on. Usage is withheld (an empty list, and usageWithheld says so) until a reader scoped to
       this world's own agents exists. */
    lastActiveOf: (sessionName) => { const r = activity.read(sessionName, 'working'); return r.found ? r.at : null; },
    /* Known runners and providers only (rollup review 22): create's maps fall back to claude/anthropic for anything else,
       which would send a guess as the provider. */
    providerOf: (runner) => (KNOWN_RUNNERS.has(runner) ? create.runnerProvider(runner) : null),
    /* The recorded runner, or NULL when neither the launch job nor the profile names one: create.recordedRunner falls
       back to claude, which would report a guess as the provider (rollup review 7). */
    recordedRunner: (sessionName) => {
      const fromJob = (create.readJob(sessionName) || {}).runner;
      if (fromJob) return KNOWN_RUNNERS.has(fromJob) ? fromJob : null;
      let provider = null;
      try { provider = require('./store').readProfile(sessionName).provider; } catch { provider = null; }
      return KNOWN_PROVIDERS.has(provider) ? create.providerRunner(provider) : null;
    },
  };
}

/**
 * The plain inputs for build(), read from this board. The same agents the board shows: running cards from the status
 * snapshot, plus the agents that are on this computer but not running (the /api/status offline list's own filter:
 * not removed, with a folder or a job, not already seen), minus any whose removal hides the card.
 *
 * Decided: an offline agent is sent as 'stopped' with no model (a stopped agent has no current model; the transcript
 * holds yesterday's, Mona Lisa's ruling on the board). When the snapshot could not read every pane line the offline
 * list is withheld, exactly as /api/status withholds it, and the body says truncated.
 */
async function gather(src) {
  const s = src || defaultSources();
  const out = { agents: [], projects: [], usageByDay: {}, lastActive: null, partial: false };
  let snap = { agents: [], counts: {} };
  let snapFailed = false;
  try { snap = s.snapshot() || snap; } catch { out.partial = true; snapFailed = true; }
  let gone = new Set();
  try { gone = new Set(s.removed() || []); } catch { /* none hidden */ }
  const nameOf = new Map();   // sessionName -> the name the board shows
  const seen = new Set();
  let latest = null;
  const touch = (sessionName) => {
    let at = null;
    try { at = s.lastActiveOf(sessionName); } catch { at = null; }
    if (at && (!latest || Date.parse(at) > Date.parse(latest))) latest = at;
  };
  for (const a of (snap.agents || [])) {
    if (!a) continue;
    /* Every card's session name is seen, kept or not (review 27), as /api/status builds its own list from every card,
       so a running agent is never listed again below as stopped. */
    if (a.sessionName) seen.add(a.sessionName);
    if (a.isNamedOurs === false || gone.has(a.sessionName)) continue;
    /* The name the board shows (review 27): the recorded display name, or the agent's own name when none was recorded
       (nameDerived false), which is the name the offline list below sends for the same agent stopped. Review 26 had
       skipped those on the premise of an internal session name; no such name exists (the fallback is the agent's own
       name), and the skip leaked through the offline list and made every send partial. A card with no name at all
       stays defensive: never sent, and the send says it is partial (review 4). */
    if (!a.name) { out.partial = true; continue; }
    nameOf.set(a.sessionName, a.name);
    /* The RECORDED runner, as the offline path reads it, never the pane's (rollup review 16): one source whether the agent
       runs or not, so its provider does not change when it starts or stops, and every send can carry it (the company
       keeps no provider across sends). A paneless card has no pane runner anyway (review 3). */
    let runner = null;
    try { runner = s.recordedRunner(a.sessionName); } catch { runner = null; }
    // An unknown runner sends provider null, never a guess (review 5). The model goes only in the daily body, and only
    // for an agent that is running when it is built: a stopped agent has no current model.
    out.agents.push({ name: a.name, provider: runner ? s.providerOf(runner) : null, model: a.model || null, state: a.state });
    touch(a.sessionName);
  }
  /* No offline list without a whole pane read (rollup review 22): a snapshot that FAILED leaves no running agent seen, so
     every running agent would be listed as stopped. /api/status gives no list at all then; nor does this. */
  if (snapFailed || (snap.counts && snap.counts.unreadableLines > 0)) out.partial = true;
  else {
    let known = { ok: false };
    try { known = s.survey() || known; } catch { /* withheld */ }
    if (!known.ok) out.partial = true;
    else {
      for (const k of known.agents || []) {
        /* profile === true (rollup review 2): a stray row is a folder in the shared workers root that no profile in
           THIS world accounts for, which can be another Kosmos's agent or any folder someone made. Never sent. */
        if (!k || k.profile !== true || k.removed || !(k.folder || k.job) || seen.has(k.name) || gone.has(k.name)) continue;
        const name = k.shownAs || k.name;
        nameOf.set(k.name, name);
        let runner = null;
        try { runner = s.recordedRunner(k.name); } catch { runner = null; }
        out.agents.push({ name, provider: runner ? s.providerOf(runner) : null, model: null, state: 'stopped' });
        touch(k.name);
      }
    }
  }
  try {
    for (const p of (s.projects() || [])) {
      if (!p || typeof p.name !== 'string' || p.archived === true) continue;   // an archived project is not reported (review 3)
      let linked = false;
      try { linked = typeof s.linkedProject === 'function' && s.linkedProject(p.id) === true; } catch { linked = true; }
      if (linked) continue;   // another Kosmos's project, joined here (review 7)
      const members = (Array.isArray(p.agents) ? p.agents : []).filter((n) => nameOf.has(n)).map((n) => nameOf.get(n));
      out.projects.push({ name: p.name, agents: members });
    }
  } catch { out.partial = true; }   // projects unreadable: say so rather than send "no projects"
  if (typeof s.usageByDay === 'function') {
    try { out.usageByDay = (await s.usageByDay()) || {}; } catch { out.partial = true; }
  } else out.usageWithheld = true;   // no reader scoped to this world: say so, never send the whole computer's
  out.lastActive = latest;
  return out;
}

/* ------------------------------------------------------------------------------------------------------------------
   The sender. Daily, and on a change to the agents or projects (at most once per CHANGE_MIN_MS). After a failure it
   waits RETRY_AFTER_FAIL_MS before asking again, so a coordinator or a connector that cannot take the route yet is
   not asked every tick. State is kept in this world's own data root.
   ------------------------------------------------------------------------------------------------------------------ */
const DAILY_MS = 24 * 60 * 60 * 1000;
const CHANGE_MIN_MS = 10 * 60 * 1000;
const RETRY_AFTER_FAIL_MS = 60 * 60 * 1000;
const STATE_FILE = 'org-rollup-state.json';

function readState(root) {
  try { const j = JSON.parse(fs.readFileSync(path.join(root, STATE_FILE), 'utf8')); return j && typeof j === 'object' ? j : {}; }
  catch { return {}; }
}
function writeState(root, st) {   // whole or not at all: temp, then rename, owner-only. True when it was written.
  const file = path.join(root, STATE_FILE);
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try { fs.writeFileSync(tmp, JSON.stringify(st) + '\n', { mode: 0o600 }); fs.renameSync(tmp, file); return true; }
  catch { try { fs.rmSync(tmp, { force: true }); } catch { /* nothing to remove */ } return false; }
}
/* What counts as a change: WHICH agents there are (name and provider) and the projects, sorted, and nothing that moves
   when an agent starts, stops, works or waits. Not the status words, and not the model, which a running agent carries
   and a stopped one does not (rollup review 5 measured four sends in 33 minutes from one agent starting and stopping):
   either would give the company a ten-minute record of when this person's agents run, which no consent line names.
   Status and model ride on the daily send only. Not usage either. */
function signature(body) {
  /* Names only, not providers (rollup review 9): a running card's provider comes from its pane and a stopped agent's
     from its record, and the two can differ (null when nothing is recorded), so a provider here moved on start/stop. */
  const agents = body.agents.map((a) => a.name).sort();
  const projects = body.projects.map((p) => [p.name, [...p.agents].sort()]).sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  return crypto.createHash('sha256').update(JSON.stringify([agents, projects])).digest('hex');
}

/**
 * One tick: send if this world is the enrolled one AND (a day has passed OR the agents or projects changed and the
 * last send is CHANGE_MIN_MS old), unless a failure was within RETRY_AFTER_FAIL_MS. Never throws.
 * opts: { root, remote, sources, now } (tests); the board passes nothing.
 */
async function tick(opts) {
  const o = opts || {};
  const oe = require('./orgenroll');
  const eo = { root: o.root, remote: o.remote };
  /* THE gate (#5531): the work Kosmos with the consent recorded on this computer (mayReport), never merely enrolled. */
  if (!oe.mayReport(eo)) return { sent: false, because: 'not the enrolled Kosmos, or no accepted words recorded here' };
  const rec = oe.readEnrollment(eo);
  if (!rec || typeof rec.world !== 'string') return { sent: false, because: 'not the enrolled Kosmos' };   // left meanwhile
  /* Sent only under a consent that said reports happen (rollup review 3): the report lines the person accepted, found
     by the hash on this record (engine/orgenroll.js acceptedConsent). None found sends NOTHING: a missing consent is
     never read as a yes. */
  const accepted = oe.acceptedConsent(eo);
  if (!accepted || accepted.reports.length === 0) return { sent: false, because: 'no accepted report lines on this enrollment' };
  const root = o.root || require('./store').ROOT;
  const now = o.now || Date.now();
  /* The timing belongs to ONE enrollment: a new one (another company, or joined again) starts fresh (review 4). */
  const enrolledAs = rec.world + '|' + ((rec.org && rec.org.id) || '') + '|' + (rec.enrolledAt || '');
  let st = readState(root);
  if (st.enrolledAs !== enrolledAs) st = { enrolledAs };
  /* A time after now (a clock that was wrong once, then corrected) counts as never (rollup review 15): kept, it would hold
     "waiting after a failure" or "nothing due" until the clock caught up, days of silence with no signal. */
  /* And anything that is not a sane time at all (rollup review 19): a string, NaN, or a number outside [0, now] from a
     cut-off or hand-edited file would make toISOString() throw on every tick, silently and for good. */
  for (const k of ['failAt', 'lastAt', 'dailyAt', 'printWaitAt', 'partialSince']) if (k in st && !(Number.isFinite(st[k]) && st[k] >= 0 && st[k] <= now)) delete st[k];
  /* A failure's wait belongs to the words it was sent under (rollup review 31): once the person accepts new words (a
     review's Accept keeps the enrollment), the wait no longer applies, so the screen's "reports to it" is true at once. */
  if (st.failAt && st.failHash !== (rec.consentHash || null)) delete st.failAt;
  if (st.failAt && now - st.failAt < RETRY_AFTER_FAIL_MS) return { sent: false, because: 'waiting after a failure' };
  /* The daily send has its own clock (rollup review 11): a change send carries no status or model, so it must not push
     the next daily (the only send that does) further out on a board that changes every day. Older state without it
     falls back to lastAt once. It is also due on a new UTC day (review 15): the company takes statuses from the first
     daily send of each UTC day, and a rolling 24 hours would drift past a whole day. */
  const dailyAt = st.dailyAt || st.lastAt;
  const utcDay = (t) => new Date(t).toISOString().slice(0, 10);
  /* Each world turns its day over at its own minute within the first hour after UTC midnight (rollup review 20), so the
     whole fleet does not send, and retry, in the same five minutes. Fixed per world: the first daily of the day stays
     the first. */
  const sinceMidnight = now - Date.parse(utcDay(now) + 'T00:00:00Z');
  const offset = parseInt(crypto.createHash('sha256').update(String(rec.world)).digest('hex').slice(0, 8), 16) % (60 * 60 * 1000);
  const due = !dailyAt || now - dailyAt >= DAILY_MS || (utcDay(dailyAt) !== utcDay(now) && sinceMidnight >= offset);
  /* The company takes the day's statuses from its FIRST daily (rollup review 22), so a partial read is not sent as the
     daily at once: it is held for up to an hour of ticks, and sent partial only if the board stays unreadable that long. */
  const PARTIAL_HOLD_MS = 60 * 60 * 1000;
  /* Nothing can go yet (not due, and too soon after the last send for a change): the board is not read at all
     (review 15). Reading it takes a pane capture per agent, synchronously, every five minutes. */
  if (!due && st.lastAt && now - st.lastAt < CHANGE_MIN_MS) return { sent: false, because: 'nothing due' };
  /* The print first (rollup review 16): while it must wait, nothing can go, so the board is not read either. */
  const pf = oe.reportPrint(eo);
  if (pf.send === 'later' || pf.send === 'error') {
    // Said where the joined view reads it (review 18): it must not claim this Kosmos reports while it waits for a print.
    // Tied to the words it waits under too (rollup review 32), as a failure's wait is: new words accepted start afresh.
    // Rewritten when the words changed too (rollup review 33): a note kept from other words would read as no wait.
    // And why (rollup review 34): a read that will retry ('later') is not a print that cannot be made at all ('error').
    const why = pf.send === 'error' ? 'error' : 'later';
    // A partial hold belongs to one day's daily (review 24); one kept across a long print wait would skip the next hold (review 35).
    if (!st.printWaitAt || st.printWaitHash !== (rec.consentHash || null) || st.printWaitWhy !== why) { const w = Object.assign({}, st, { enrolledAs, printWaitAt: now, printWaitHash: rec.consentHash || null, printWaitWhy: why }); delete w.partialSince; writeState(root, w); }
    return { sent: false, because: 'this computer could not be read yet' };
  }
  if (st.printWaitAt) { delete st.printWaitAt; delete st.printWaitWhy; writeState(root, Object.assign({}, st, { enrolledAs })); }   // readable again
  const g = await gather(o.sources);
  /* Usage leaves only under a consent that named it (review 8): a reader added to the sources later cannot turn it on
     by itself. Until the enrollment records `usageConsented` (set by the consent follow-up when the accepted words name
     usage), any usage read is dropped and the body says usageWithheld. */
  if (accepted.usageConsented !== true) { g.usageByDay = {}; g.usageWithheld = true; }
  if (due && g.partial) {
    const since = Number.isFinite(st.partialSince) && st.partialSince <= now ? st.partialSince : null;
    if (since === null) { writeState(root, Object.assign({}, st, { enrolledAs, partialSince: now })); return { sent: false, because: 'the board could not be read in full; waiting before the daily' }; }
    if (now - since < PARTIAL_HOLD_MS) return { sent: false, because: 'the board could not be read in full; waiting before the daily' };
  }
  // A partial read is never a change (review 5): only the daily send may carry an incomplete body.
  /* From a CHANGE-shaped body (rollup review 24): model and status are null there, so on a board over the size cap the
     trim cannot keep more or fewer rows depending on which agents are running. */
  const sig = signature(build(Object.assign({ world: rec.world, nowMs: now, reason: 'change' }, g)));
  const changed = !g.partial && st.lastSig && sig !== st.lastSig;
  if (!due && !(changed && (!st.lastAt || now - st.lastAt >= CHANGE_MIN_MS)))   // no last send on record: long ago (review 16)
    return { sent: false, because: 'nothing due' };
  const body = build(Object.assign({ world: rec.world, at: new Date(now).toISOString(), reason: due ? 'daily' : 'change', nowMs: now }, g));
  /* #5532 (v1.5): the computer print pinned at enroll, made from this world's own record. Once a print is pinned the
     company refuses a rollup without it (a copy would just leave it out), so a read still retrying waits for the next
     tick instead of sending; that is not a failure, so it starts no hour of quiet. */
  Object.assign(body, pf.fields);
  /* Again, right before the send: a leave may have landed while gather() read the board (rollup review 3). The person
     has been told this Kosmos stopped reporting; nothing may go after that. */
  const now2 = oe.readEnrollment(eo);
  if (!oe.mayReport(eo) || !now2 || now2.world !== rec.world || now2.consentHash !== rec.consentHash) return { sent: false, because: 'left while the rollup was read' };
  /* Record the attempt BEFORE sending (review 5): a data folder that cannot keep the timing would otherwise send a
     full daily body on every tick. No record, no send. */
  // tryAt is not read back: writing it proves the timing can be kept. A crash between this send and the success write
  // means one resend on the next tick, which is the safe direction for a once-a-day report.
  if (!writeState(root, Object.assign({}, st, { enrolledAs, tryAt: now }))) return { sent: false, because: 'this Kosmos cannot record when it reported' };
  const remote = o.remote || require('./remote');
  let r;
  try { r = await remote.macRequest('POST', ROUTE, body); } catch (e) { r = { ok: false, because: String((e && e.message) || e) }; }
  if (r && r.ok) {
    writeState(root, { enrolledAs, lastAt: now, dailyAt: body.reason === 'daily' ? now : (st.dailyAt || st.lastAt || null), lastSig: g.partial ? (st.lastSig || null) : sig });
    return { sent: true, reason: body.reason };
  }
  const failed = Object.assign({}, st, { failAt: now, failHash: rec.consentHash || null }); delete failed.partialSince;   // a hold belongs to one day's daily (review 24)
  writeState(root, failed);
  /* Said once per failure (review 18): a refusal every hour must leave a trace. Only the code: never the body or a print. */
  const code = (String((r && r.because) || '').match(/\borg_[a-z_]+\b/) || [])[0] || 'no answer';
  console.error('orgrollup: the company did not take the rollup (' + code + ')');
  /* The company holds other words for this member than the ones accepted here (contract v1.5, 409 org_consent_changed):
     stop reporting until the person accepts the new words (the joined view then says it sends nothing). */
  // Taken as the company's final word, with no confirming retry: the coordinator answers it only when the words it
  // serves now differ from the ones on record for this member (v1.4), which a transient fault does not change.
  if (r && /\borg_consent_changed\b/.test(String(r.because || ''))) {
    await oe.consentWithdrawn(eo, rec.consentHash);   // only the words this report was sent under (review 11)
    return { sent: false, because: 'the company\'s words changed; nothing more is sent until they are accepted here' };
  }
  /* The company no longer takes this world's reports: ask it at once (refresh stops this world on a clear answer). */
  if (r && /\borg_not_enrolled\b|\borg_not_member\b/.test(String(r.because || ''))) {
    try { await oe.refresh(eo); } catch { /* the daily refresh tries again */ }
  }
  return { sent: false, because: 'the company did not take it' };
}

/* Whether the last tick waited for this computer's print (review 18), so the joined view does not claim it reports.
   Read from the rollup's own state, never by reading the hardware in a request. */
function waitingForPrint(root) {
  const st = readState(root || require('./store').ROOT);
  // Only this enrollment's (review 19): a note left by an earlier one does not belong to a Kosmos that joined again.
  const rec = require('./orgenroll').readEnrollment(root ? { root } : undefined);
  const enrolledAs = rec ? rec.world + '|' + ((rec.org && rec.org.id) || '') + '|' + (rec.enrolledAt || '') : null;
  const waits = !!st.printWaitAt && st.enrolledAs === enrolledAs && (st.printWaitHash === undefined || st.printWaitHash === ((rec && rec.consentHash) || null));
  // Rollup review 34: false, 'later' (a read that will retry) or 'error' (a print that cannot be made: a bug, said as such).
  return waits ? (st.printWaitWhy === 'error' ? 'error' : 'later') : false;
}

module.exports = {
  waitingForPrint, KNOWN_RUNNERS, KNOWN_PROVIDERS,
  DAILY_MS, CHANGE_MIN_MS, RETRY_AFTER_FAIL_MS, STATE_FILE, signature, tick,
  ROUTE, VERSION, NAME_MAX, AGENTS_MAX, PROJECTS_MAX, NAMES_MAX, USAGE_DAYS, USAGE_ROWS_PER_DAY, BODY_MAX,
  STATUS, statusWord, providerOfModel, build, gather, defaultSources,
};
