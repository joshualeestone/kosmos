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
/* kosmos#5532: about the longest a usage read is waited for in the board's own tick (the timer fires only between the
   scan's synchronous steps); past it, usage is withheld for that body, or a recent finished scan goes instead (lastScan).
   It bounds the wait, not the scan; a send's total also includes its pane reads. */
const USAGE_READ_MS = 60 * 1000;
/* Another Kosmos's child has GATHER_TIMEOUT_MS for everything, so its usage wait is shorter, leaving its pane reads room.
   A slow pane read plus a slow usage read can still cross the bound and lose that Kosmos's report for the send. The
   child exits after its run, so a scan it gave up on is lost and that body is withheld. */
const CHILD_USAGE_READ_MS = 30 * 1000;
const SLOW = Symbol('slow');   // the timeout's own answer, which no reader can return
/* One live scan at a time (plus at most one given-up scan, see below): a read the wait gave up on keeps running (it is not cancelled),
   so a later send shares it rather than starting another beside it; a scan pending past the limit is left running in
   the background and a fresh one starts (a hung read cannot be stopped, only stopped from blocking). */
let pendingScan = null;
let pendingSince = 0;
let scanGeneration = 0;
/* A scan pending longer than this is given up on: a later send starts a fresh one rather than sharing a scan that may
   never settle, which would otherwise withhold usage for the rest of the process's life. At most ONE given-up scan may
   still be running: a truly hung scan is a stuck filesystem call holding one of the few shared worker threads, and a
   fresh scan on the same stuck mount would hang too, so starting one every hour would take the board's threads one by
   one. While one given-up scan is still running, no further give-up happens: at most one given-up scan and one live
   scan run at once, and later sends use the last finished scan or say usage is withheld. */
let abandoned = new Set();   // the generations of given-up scans still running (a set: a reset or a late settle cannot drift it)
const PENDING_SCAN_MAX_MS = 60 * 60 * 1000;
/* The last scan that finished, and when: a scan the wait gave up on still finishes, and a later send whose own wait gives
   up uses it (under a day old), marked incomplete. Module state: it lives as long as the process does. In the board's
   own tick that is the board's life; when the enrolled Kosmos's tick runs in a child (orgrollup-child.js tick, when the
   board serves another Kosmos), it is that one run, so a scan that always outlasts the wait there is always withheld. */
let lastScan = null;
let slowSaid = false;
function scanUsageOnce() {
  const stale = pendingScan && Date.now() - pendingSince > PENDING_SCAN_MAX_MS;
  if (stale && abandoned.size > 0) return pendingScan;   // one given-up scan is still running: start nothing more
  if (!pendingScan || stale) {
    if (stale) {
      const given = scanGeneration;
      abandoned.add(given);
      pendingScan.then(() => {}, () => {}).finally(() => { abandoned.delete(given); });
    }
    const gen = ++scanGeneration;
    pendingSince = Date.now();
    pendingScan = Promise.resolve().then(() => require('./usage').worldUsageByModel(USAGE_DAYS))
      .then((v) => { if (gen === scanGeneration) lastScan = { v, at: Date.now() }; return v; })
      .finally(() => { if (gen === scanGeneration) pendingScan = null; });   // a superseded scan touches nothing
  }
  return pendingScan;
}
const USAGE_ROWS_PER_DAY = 40;
/* kosmos#6842 slice 3: per-project token use, from the receipts of tasks closed in the last USAGE_DAYS days (the same
   receipts the task pages show). At most PROJECT_USAGE_ROWS rows, costliest first; the read is waited for at most
   PROJECT_USAGE_READ_MS, and a read that does not finish sends no projectUsage at all (not reported), never [] (none). */
const PROJECT_USAGE_ROWS = 200;
const PROJECT_USAGE_READ_MS = 60 * 1000;
/* The most tasks read per tick, newest first; more marks the read incomplete (the body's truncated). */
const PROJECT_USAGE_TASKS = 200;
/**
 * kosmos#6842 slice 3: tokens per (project name, close day, model), summed over every agent on every task of `projects`
 * ([{ id, name }]) closed in the last `days` UTC days. Answers { byProject: { name: { day: { model: buckets } } }, complete }:
 * complete is false when any receipt failed, was read in part, or names an agent whose work could not be read, and the
 * body then says truncated. A few receipts at a time, as engine/receipt.js forAgent works them out.
 */
async function projectUsageByDay(projects, { days = USAGE_DAYS, now = Date.now(), receiptOf, readAll } = {}) {
  const receipt = require('./receipt');
  const workOut = receiptOf || receipt.forTask;
  const t = new Date(now);
  const from = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() - (days - 1));
  const byId = new Map((Array.isArray(projects) ? projects : []).filter((p) => p && p.id && p.name).map((p) => [p.id, p.name]));
  const all = (readAll || (() => require('./projects').readAll()))() || [];
  const jobs = [];
  let complete = true;
  for (const proj of all) {
    if (!proj || !byId.has(proj.id)) continue;
    for (const task of proj.tasks || []) {
      // A task whose close cannot be read is left out and marks the read incomplete, never fails the whole read.
      let at = NaN;
      try { at = Date.parse(receipt.closedAtOf(task) || ''); } catch { complete = false; continue; }
      if (Number.isFinite(at) && at >= from && at <= now) jobs.push({ id: proj.id, name: byId.get(proj.id), task, at, day: new Date(at).toISOString().slice(0, 10) });
    }
  }
  const byProject = {};
  jobs.sort((x, y) => y.at - x.at);
  if (jobs.length > PROJECT_USAGE_TASKS) { complete = false; jobs.length = PROJECT_USAGE_TASKS; }
  const AT_ONCE = 3;
  for (let i = 0; i < jobs.length; i += AT_ONCE) {
    await Promise.all(jobs.slice(i, i + AT_ONCE).map(async (j) => {
      let r = null;
      try { r = await workOut(j.id, j.task, { now }); } catch { r = null; }
      if (!r || !Array.isArray(r.agents)) { complete = false; return; }
      for (const a of r.agents) {
        if (!a || typeof a !== 'object') continue;
        // A provider with no receipt (Grok, Antigravity, Muse) is not counted, by design, as on the task page: it is not
        // an incomplete read, which would mark every daily body truncated for as long as such tasks keep closing.
        if (a.available === false && a.because === 'provider') continue;
        if (!a.available || a.complete === false) complete = false;
        for (const [m, b] of Object.entries((a.available && a.models) || {})) {
          if (!b || typeof b !== 'object') continue;
          const day = ((byProject[j.name] || (byProject[j.name] = {}))[j.day] || (byProject[j.name][j.day] = {}));
          const into = day[m] || (day[m] = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 });
          for (const f of ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']) into[f] += Number(b[f]) || 0;
        }
      }
    }));
  }
  return { byProject, complete };
}
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
const PROVIDERS = new Set(['anthropic', 'openai', 'google', 'xai', 'meta', 'antigravity', 'alibaba', 'deepseek']);   // #7206: the coordinator stores any name
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

/* Whether `g` reports the policy last sent (same version, same refusal). */
function samePolicy(st, g) {
  const lp = st && st.lastPolicy;
  return !!lp && typeof lp === 'object' && lp.version === g.policyVersion && (lp.refused === true) === (g.policyRefused === true);
}
/* #5534 review 3, kosmos#6309: what was last sent, sent again (a read that failed, or a cap's count not known yet),
   so the signature does not move and nothing reported is cleared: the policy fields, and the month's count with them
   (the coordinator reads the version without a count as "no cap"). Nothing when nothing was sent. */
function repeatLastPolicy(g, st) {
  const lp = st && st.lastPolicy;
  if (!lp || typeof lp !== 'object' || !('version' in lp)) return;
  g.policyVersion = lp.version;
  g.policyRefused = lp.refused === true;
  if (usageOk(lp.usage)) g.policyUsage = lp.usage;
}
/* kosmos#6309: a policyUsage build() may send: whole numbers and booleans only. */
function usageOk(u) {
  return !!u && typeof u === 'object' && Number.isSafeInteger(u.used) && u.used >= 0 && Number.isSafeInteger(u.cap) && u.cap >= 1
    && typeof u.warn === 'boolean' && typeof u.over === 'boolean' && typeof u.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(u.month);
}
/**
 * The body. Inputs, all plain:
 *   world        this world's opaque id (orgenroll)
 *   at, reason   when, and 'daily' | 'change'
 *   agents       [{ name, provider, model, state }]
 *   projects     [{ name, agents: [agent name] }]
 *   usageByDay   { 'YYYY-MM-DD': { model: { input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens } } }
 *   lastActive, backupLastOk, policyVersion, policyRefused, policyUsage ({ used, cap, warn, over, month }, kosmos#6309)
 *   partial, usageWithheld, usageIncomplete (kosmos#5532: a short usage count, which marks the body truncated)
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

  /* kosmos#6842 slice 3: per-project rows, only when the tick read them (under words naming them, daily sends only).
     A project's name is cleaned as the projects list cleans it, and a row goes only for a project that list sends, so
     the company never holds usage for a name it was not told about. Rows that clean to one key are added together. */
  let projectUsage = null;
  if (i.projectUsage && plainMap(i.projectUsage)) {
    const sent = new Set(projects.map((p) => p.name));
    const keyed = new Map();
    for (const [rawName, perDay] of Object.entries(i.projectUsage)) {
      const project = clean(rawName);
      if (!project || !sent.has(project) || !plainMap(perDay)) { if (plainMap(perDay) && Object.keys(perDay).length) truncated = true; continue; }
      for (const [d, models] of Object.entries(perDay)) {
        if (!realDay(d) || !plainMap(models)) { truncated = true; continue; }
        for (const [model, b] of Object.entries(models)) {
          if (!MODEL_ID.test(String(model)) || !providerOfModel(model)) {
            // As the per-day rows: an unnamed model with tokens is a real trim; one with none drops nothing.
            if (count(b && b.input_tokens) || count(b && b.output_tokens) || count(b && b.cache_creation_input_tokens) || count(b && b.cache_read_input_tokens)) truncated = true;
            continue;
          }
          const k = project + '\0' + d + '\0' + model;
          const row = keyed.get(k) || { project, day: d, provider: providerOfModel(model), model, input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
          row.input += count(b && b.input_tokens); row.output += count(b && b.output_tokens);
          row.cacheWrite += count(b && b.cache_creation_input_tokens); row.cacheRead += count(b && b.cache_read_input_tokens);
          keyed.set(k, row);
        }
      }
    }
    projectUsage = [...keyed.values()].filter((r) => r.input || r.output || r.cacheWrite || r.cacheRead).map((r) => {
      let costUsd = usageprice.costOf(r.model, { input_tokens: r.input, output_tokens: r.output, cache_creation_input_tokens: r.cacheWrite, cache_read_input_tokens: r.cacheRead });
      if (costUsd != null) costUsd = Math.round(costUsd * 1e6) / 1e6;
      return { project: r.project, day: r.day, provider: r.provider, model: r.model, input: r.input, output: r.output, cacheWrite: r.cacheWrite, cacheRead: r.cacheRead, costUsd };
    });
    projectUsage.sort((x, y) => (y.costUsd || 0) - (x.costUsd || 0) || (y.input + y.output) - (x.input + x.output));
    if (projectUsage.length > PROJECT_USAGE_ROWS) { truncated = true; projectUsage = projectUsage.slice(0, PROJECT_USAGE_ROWS); }
  }

  const body = {
    v: VERSION,
    world: typeof i.world === 'string' ? i.world : null,
    at: iso(i.at) || new Date().toISOString(),
    reason: i.reason === 'change' ? 'change' : 'daily',
    /* #5534: the company policy version this Kosmos applied (a whole number the company saved, else none) and whether
       it refused one the company sent. Both only when the tick read them under words naming the policy; otherwise the
       fields are left out, and the company keeps what it had. */
    ...('policyVersion' in i ? {
      policyVersion: Number.isSafeInteger(i.policyVersion) && i.policyVersion >= 1 ? i.policyVersion : null,
      policyRefused: i.policyRefused === true,
    } : {}),
    /* kosmos#6309: this month's tokens against the policy's usage cap, so the parent's console row shows used / cap and
       whether the heads-up or the cap is reached. Whole numbers and booleans only; anything else leaves it out. */
    ...(usageOk(i.policyUsage) ? { policyUsage: { used: i.policyUsage.used, cap: i.policyUsage.cap, warn: i.policyUsage.warn, over: i.policyUsage.over, month: i.policyUsage.month } } : {}),
    lastActive: notAfterTomorrow(day(i.lastActive), nowMs),   // the day only: "when you were last active", not a timeline (review 5)
    backup: { lastOk: iso(i.backupLastOk) },
    agents, projects, usage,
    ...(projectUsage ? { projectUsage } : {}),   // kosmos#6842: absent means not reported, [] means none
    /* Contract v1.1 (PigeonPete): while usage is not read (the words do not name it, or no reader scoped to this world),
       usage is [] and usageWithheld says so, and the console shows "usage not reported yet", never 0. truncated means a
       real trim, a partial read, or a usage count the reader said was incomplete (usageIncomplete, kosmos#5532). */
    usageWithheld: i.usageWithheld === true,
    truncated: truncated || i.partial === true || i.usageIncomplete === true || (projectUsage !== null && i.projectUsageIncomplete === true),   // a partial read is said, never sent as the whole picture
  };
  return fit(body);
}

/* Trim until the serialized body fits BODY_MAX: per-project rows from the end (the cheapest) first (kosmos#6842), then
   the oldest usage day's rows, then projects from the end, then agents from the end. Each trim sets truncated. */
function fit(body) {
  const size = () => Buffer.byteLength(JSON.stringify(body), 'utf8');
  while (size() > BODY_MAX) {
    body.truncated = true;
    if (body.projectUsage && body.projectUsage.length) {
      body.projectUsage.pop();
      // Trimmed to nothing is not reported, never [] (none): [] would replace the company's stored week with none.
      if (!body.projectUsage.length) delete body.projectUsage;
    } else if (body.usage.length) {
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
// #5975: the same set build() sends, so the two cannot drift (a second copy is how alibaba was first missed).
const KNOWN_PROVIDERS = PROVIDERS;
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
    /* kosmos#5532: usage of sessions launched in THIS Kosmos's own roster's agent folders (engine/usage.js
       worldUsageByModel, #5571; its residual: in the default world, where Kosmoses share the workers folder, two
       Kosmoses' same-named agents, or a person's own session started in an agent's exact folder, count as this one's), never the computer-wide readers beside it, which include the person's other
       Kosmoses and their own sessions (rollup review 1, a BLOCKER). It leaves only under accepted words that name it
       (usageConsented), and the company's words say "sessions launched in your agents' folders", which is what this
       counts. Answers { byDay, complete }; an incomplete count marks the body truncated (usageIncomplete), not
       partial. */
    usageByDay: scanUsageOnce,
    /* kosmos#6842 slice 3: per-project token use from task receipts, for the records gather kept. */
    projectUsage: (records) => projectUsageByDay(records),
    lastActiveOf: (sessionName) => { const r = activity.read(sessionName, 'working'); return r.found ? r.at : null; },
    /* Known runners and providers only (rollup review 22): create's maps fall back to claude/anthropic for anything else,
       which would send a guess as the provider. */
    /* #5977 review 2: a Qwen agent (codex on a Qwen home) never goes as openai. #5975: codex is the one runner two
       providers share, so its provider follows accountproblem's rule: the job decides, and the profile only when there
       is no job (a stopped agent whose runner recordedRunner read off an alibaba profile). */
    providerOf: (runner, sessionName) => {
      if (!KNOWN_RUNNERS.has(runner)) return null;
      if (runner === 'codex' && sessionName) {
        let fromJob = null;
        try { fromJob = create.codexJobProvider(sessionName); } catch { fromJob = null; }
        if (!fromJob) {
          let fromProfile = null;
          try { fromProfile = require('./store').readProfile(sessionName).provider; } catch { fromProfile = null; }
          if (fromProfile === 'alibaba') return 'alibaba';
        }
      }
      const p = create.agentProvider(sessionName, runner);
      return KNOWN_PROVIDERS.has(p) ? p : null;
    },
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

/* Tests only: forget the last finished scan and drop any pending one (a scan still running from an earlier test can
   then change nothing), so a test starts from none; module state outlives a test. */
function _resetUsageScanForTests() { lastScan = null; slowSaid = false; pendingScan = null; scanGeneration += 1; abandoned = new Set(); }
function plainMap(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
/* kosmos#6842 slice 3: fills out.projectUsage (and projectUsageIncomplete) from the sources' reader, waited for at most
   PROJECT_USAGE_READ_MS. A reader that is missing, throws, answers the wrong shape or is too slow leaves projectUsage out
   of the body (not reported); it is never sent as [] (none). Never throws. */
async function readProjectUsage(s, out, waitMs) {
  delete out.projectUsage; delete out.projectUsageIncomplete;
  // Projects that could not be listed leave nothing to sum: not reported, never [] (none), which would clear the week.
  if (out.projectsUnreadable === true) return;
  if (typeof s.projectUsage !== 'function') return;
  let timer = null;
  const slow = new Promise((res) => { timer = setTimeout(() => res(SLOW), Number.isFinite(waitMs) ? waitMs : PROJECT_USAGE_READ_MS); });
  try {
    const u = await Promise.race([Promise.resolve(s.projectUsage(out.projectRecords || [])), slow]);
    if (u === SLOW || !u || !plainMap(u.byProject) || typeof u.complete !== 'boolean') return;
    out.projectUsage = u.byProject;
    if (!u.complete) out.projectUsageIncomplete = true;
  } catch { /* not reported */ } finally { clearTimeout(timer); }
}

/* kosmos#5532: fills out.usageByDay from the sources' scoped reader, or says usageWithheld when there is none. The
   board's reader answers { byDay, complete }; a plain day map is also taken (test sources). A short count sets
   usageIncomplete (the body's truncated), never `partial`: partial holds the daily and blocks change sends, and a count
   can stay incomplete for good (usage.js). A late count reused from an earlier scan (lastScan) can be up to a day
   old; it too is only marked truncated, so the console reads it as short, not as stale. A read that throws, takes longer than its wait (USAGE_READ_MS, or the child's CHILD_USAGE_READ_MS), or answers an
   empty count it says is not complete (which cannot be told from a read that found nothing) says usageWithheld ("not reported yet", contract v1.1), never 0. The bound is the wait only: the scan is not
   cancelled, and the pane reads before it are not bounded by it. */
async function readUsage(s, out, waitMs) {
  if (typeof s.usageByDay !== 'function') { out.usageWithheld = true; return; }
  const wait = Number.isFinite(waitMs) && waitMs > 0 ? waitMs : USAGE_READ_MS;   // the child's own, or a test's
  let timer;
  try {
    const slow = new Promise((resolve) => { timer = setTimeout(() => resolve(SLOW), wait); });
    const u = await Promise.race([Promise.resolve(s.usageByDay()), slow]);
    if (u === SLOW) {
      // The board's own reader: the last scan that finished, under a day old, goes as a short count rather than none.
      const late = s.usageByDay === scanUsageOnce && lastScan && Date.now() - lastScan.at >= 0 && Date.now() - lastScan.at < DAILY_MS ? lastScan.v : null;
      if (late && plainMap(late.byDay) && Object.keys(late.byDay).length > 0) { out.usageByDay = late.byDay; out.usageIncomplete = true; return; }
      if (!slowSaid) { slowSaid = true; console.error('orgrollup: reading this Kosmos\'s usage took longer than the wait, so it is withheld until a read finishes; a later send uses that read, marked incomplete (said once)'); }
      out.usageByDay = {}; out.usageWithheld = true; return;
    }
    if (plainMap(u) && Object.prototype.hasOwnProperty.call(u, 'byDay')) {
      // The board's reader's shape: a day map and a boolean. Anything else is not a count: withheld, never sent as 0.
      if (!plainMap(u.byDay) || typeof u.complete !== 'boolean') { out.usageByDay = {}; out.usageWithheld = true; return; }
      // An empty count that is not complete cannot tell "read nothing" from "a quiet week with part unread" (usage.js
      // answers it for both), so it is withheld rather than sent as a zero; an empty COMPLETE count is a real zero.
      if (!u.complete && Object.keys(u.byDay).length === 0) { out.usageByDay = {}; out.usageWithheld = true; return; }
      out.usageByDay = u.byDay;
      if (!u.complete) out.usageIncomplete = true;
    } else if (plainMap(u) && Object.keys(u).length > 0 && Object.keys(u).every((k) => /^\d{4}-\d{2}-\d{2}$/.test(k))) out.usageByDay = u;   // a plain day map (test sources)
    else { out.usageByDay = {}; out.usageWithheld = true; }
  } catch { out.usageByDay = {}; out.usageWithheld = true; } finally { clearTimeout(timer); }
}
/**
 * The plain inputs for build(), read from this board. The same agents the board shows: running cards from the status
 * snapshot, plus the agents that are on this computer but not running (the /api/status offline list's own filter:
 * not removed, with a folder or a job, not already seen), minus any whose removal hides the card.
 *
 * Decided: an offline agent is sent as 'stopped' with no model (a stopped agent has no current model; the transcript
 * holds yesterday's, Mona Lisa's ruling on the board). When the snapshot could not read every pane line the offline
 * list is withheld, exactly as /api/status withholds it, and the body says truncated.
 *
 * `opts.usage === true` (kosmos#5532): read usage too; only a caller under words naming it asks. Without it, usage is not
 * read at all (a scan of a week of transcripts) and the body says usageWithheld. `opts.usageReadMs` sets the
 * usage wait (another Kosmos's child uses CHILD_USAGE_READ_MS; tests use a few milliseconds).
 */
async function gather(src, opts) {
  const s = src || defaultSources();
  const wantUsage = !!(opts && opts.usage === true);   // opt-in: a caller that does not ask scans nothing
  const out = { agents: [], projects: [], usageByDay: {}, lastActive: null, partial: false, projectRecords: [] };
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
    out.agents.push({ name: a.name, provider: runner ? s.providerOf(runner, a.sessionName) : null, model: a.model || null, state: a.state });
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
        out.agents.push({ name, provider: runner ? s.providerOf(runner, k.name) : null, model: null, state: 'stopped' });
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
      out.projectRecords.push({ id: p.id, name: p.name });   // kosmos#6842: which records the usage read may sum (never sent)
    }
  } catch { out.partial = true; out.projectsUnreadable = true; }   // projects unreadable: say so rather than send "no projects"
  if (wantUsage) await readUsage(s, out, opts && opts.usageReadMs);
  else out.usageWithheld = true;   // not consented: say so, never read it
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
/* #5791: how often a work Kosmos with no company terms on record asks for them again (tick, above). */
const RETAKE_EVERY_MS = 15 * 60 * 1000;
/* #5791 review 1: how often a work Kosmos whose company's terms ask for no reports checks whether they changed. */
const RECHECK_NO_REPORTS_MS = 24 * 60 * 60 * 1000;
const STATE_FILE = 'org-rollup-state.json';
/* #5791 review 4: when the board last asked its company for its current terms (tick). Its own file, not a field in
   STATE_FILE: the ask runs before the run lock, and a read-modify-write of the shared state there could drop another
   run's fields. A lost stamp here costs at most one extra ask. */
const RETAKE_FILE = 'org-rollup-retake.json';
function readRetake(root, now) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(root, RETAKE_FILE), 'utf8'));
    const t = j && j.at; const m = j && j.misses;
    return { at: Number.isFinite(t) && t >= 0 && t <= now ? t : 0, misses: Number.isInteger(m) && m >= 0 ? m : 0 };
  } catch { return { at: 0, misses: 0 }; }
}
// misses: asks in a row that left no terms on record here (the window doubles with each, up to a day).
function writeRetake(root, at, misses) {
  try { require('./securewrite').writeSecret(path.join(root, RETAKE_FILE), JSON.stringify({ at, misses }) + '\n', 0o600, { atomicOnly: true }); return true; }
  catch { return false; }
}

function readState(root) {
  try { const j = JSON.parse(fs.readFileSync(path.join(root, STATE_FILE), 'utf8')); return j && typeof j === 'object' ? j : {}; }
  catch { return {}; }
}
function writeState(root, st) {   // whole or not at all: temp, then rename, owner-only. True when it was written.
  const file = path.join(root, STATE_FILE);
  // #5434 slice 20: flushed before the rename, exact 0600; a failed save removes its own temp.
  try { require('./securewrite').writeSecret(file, JSON.stringify(st) + '\n', 0o600, { atomicOnly: true }); return true; }
  catch { return false; }
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
  /* #5534: a policy newly applied (or refused) is a change, so the company sees it within minutes, not at the next
     daily. Added only when the body carries it, so a board under words not naming the policy keeps its signature. */
  const parts = [agents, projects];
  if ('policyVersion' in body) parts.push([body.policyVersion, body.policyRefused === true]);
  /* kosmos#6309: reaching the heads-up or the cap is a change, so the parent hears within minutes; the count itself is
     not (it moves with every message, and would send every few minutes). Added only when the body carries it. */
  if (body.policyUsage) parts.push(['usage', body.policyUsage.warn, body.policyUsage.over]);
  return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

/* The print-wait note, where the joined view reads it (review 18): /api/org must not say this Kosmos reports while its
   rollup waits for a print. It belongs to:
   - this enrollment (enrolledAs, review 19);
   - the words it waits under (printWaitHash, review 32), so new words accepted start afresh, and it is rewritten when
     the words changed (review 33);
   - its reason (printWaitWhy, review 34): 'later' is a read that will retry, 'error' a print that cannot be made.
   Writing it drops a partial-read hold, which belongs to one day's daily (reviews 24, 35). */
function notePrintWait(root, st, enrolledAs, rec, why, now) {
  const hash = rec.consentHash || null;
  if (st.printWaitAt && st.printWaitHash === hash && st.printWaitWhy === why) return;
  const w = Object.assign({}, st, { enrolledAs, printWaitAt: now, printWaitHash: hash, printWaitWhy: why });
  delete w.partialSince;
  writeState(root, w);
}

/* ------------------------------------------------------------------------------------------------------------------
   kosmos#5532 widening (Josh, #admin 2026-10-09 08:43: everything on a work computer is company property). The
   enrolled Kosmos reports, and with each of its sends so does every other Kosmos on this computer, each under its own
   opaque id, read in a child process with that Kosmos's own folders (engine/orgrollup-child.js), so no reader changes.
   Decided (#5532 design): the others follow the enrolled Kosmos's schedule, so a change in another Kosmos alone
   reaches the company with the enrolled one's next send (at most a day later). The coordinator takes 16 Kosmoses a
   member (ORG_ROLLUP_WORLDS_MAX), so at most 15 others. */
const OTHERS_MAX = 15;
const GATHER_TIMEOUT_MS = 2 * 60 * 1000;
/* The board's bound on a whole tick run in a child (server.js, a board serving another Kosmos): the enrolled Kosmos's
   own read and send, every other Kosmos's read, and the sends, with room to spare (board review 1: 30 minutes was
   less than the worst case). */
const TICK_CHILD_TIMEOUT_MS = (OTHERS_MAX + 2) * GATHER_TIMEOUT_MS + 10 * 60 * 1000;
/* What a child may print: a gather's one line holds a Kosmos's inventory (bounded by build's 56 KB body, plus names
   before trimming), so 8 MB; a tick's one line is its small result. Past these execFile kills the child, which reads
   as no report, never as a wrong one. */
const GATHER_STDOUT_MAX = 8 * 1024 * 1024;
const TICK_STDOUT_MAX = 1024 * 1024;

/* Every other Kosmos on this computer (hidden ones too: hiding stops agents, the Kosmos is still there), each with
   the environment its own board would run in. [] when the registry cannot be read. At most OTHERS_MAX, the ones that
   may send; `all` lifts that for a search (board review 1: the server's search for the enrolled Kosmos must see every
   Kosmos, not the first fifteen). */
function otherWorlds(root, opts) {
  const worlds = require('./worlds');
  let base;
  try { base = require('./worldenv').bootedBaseDir() || worlds.baseRoot(worlds.preWorldEnv(process.env)); } catch { return []; }
  const me = path.resolve(root);
  const all = [];
  for (const w of worlds.readRegistry(base).worlds) {
    try { all.push({ w, wroot: worlds.worldStoreRoot(base, w) }); } catch { /* an unsafe id: not a Kosmos to read */ }
  }
  /* Only a Kosmos of THIS registry has others: a data folder that is none of its Kosmoses (a sandbox, a folder given
     by hand) cannot say which Kosmoses share its computer, so it reports alone. */
  if (!all.some((x) => path.resolve(x.wroot) === me)) return [];
  const out = [];
  for (const { w, wroot } of all) {
    if (path.resolve(wroot) === me) continue;
    /* That Kosmos's environment as an agent of it gets one (#2827): the pre-world roots, its id, and the roots derived
       from that id. The default Kosmos sets no roots. */
    const env = worlds.preWorldEnv(process.env);
    if (w.id !== worlds.DEFAULT_ID) {
      env[require('./launchidentity').WORLD_ENV_VAR] = w.id;
      try { worlds.applyAgentWorldEnv(env); } catch { continue; }
    }
    out.push({ id: w.id, root: wroot, env });
    if (!(opts && opts.all) && out.length >= OTHERS_MAX) break;
  }
  return out;
}

/* kosmos#5532 widening: the enrolled Kosmos on this computer when the board on screen serves ANOTHER Kosmos, searched
   in the whole registry (board review 1), or null. deps: { otherWorlds, oe } (tests). */
function enrolledElsewhere(root, deps) {
  const d = deps || {};
  const oe = d.oe || require('./orgenroll');
  let list = [];
  try { list = (d.otherWorlds || otherWorlds)(root, { all: true }) || []; } catch { return null; }
  return list.find((w) => { try { return oe.isEnrolledHere({ root: w.root }); } catch { return false; } }) || null;
}

/* Runs that enrolled Kosmos's own tick in a child with its folders, so its words, timing, print and key are its own.
   `done(err)` when the child ends; a failed or timed-out child is said (board review 2). Returns the child, so the
   board can stop it when it exits (board review 5). deps: { execFile } (tests). */
function spawnEnrolledTick(w, done, deps) {
  const execFile = (deps && deps.execFile) || require('child_process').execFile;
  return execFile(process.execPath, [path.join(__dirname, 'orgrollup-child.js'), 'tick'],
    { env: w.env, timeout: TICK_CHILD_TIMEOUT_MS, maxBuffer: TICK_STDOUT_MAX }, (err) => {
      if (err) console.error('orgrollup: the enrolled Kosmos\'s rollup, run for it from this board, failed (' + String(err.signal || err.code || err.message) + ')');
      done(err || null);
    });
}

/* The board side of "the enrolled Kosmos is elsewhere" (board review 11: testable by behaviour, not only by the source
   guard). Holds what server.js held: a search at most once per CHANGE_MIN_MS (no send can be due sooner), one child at
   a time, kept whichever order its callback runs in, and stopped with the board. deps: { now, find, spawn } (tests). */
function elsewhereRunner(deps) {
  const d = deps || {};
  const now = d.now || Date.now;
  let searchedAt = -Infinity;
  let child = null;
  let running = false;
  return {
    get running() { return running; },
    tick(root) {
      if (running) return 'running';
      const t = now();
      if (t - searchedAt < CHANGE_MIN_MS) return 'throttled';
      searchedAt = t;   // the search counts too (board review 8)
      const w = (d.find || enrolledElsewhere)(root);
      if (!w) return 'none';
      running = true;
      let ended = false;
      try {
        const c = (d.spawn || spawnEnrolledTick)(w, () => { ended = true; running = false; child = null; });
        if (!ended) child = c;
      } catch (e) {
        // A spawn that throws must not leave the board busy for good (board review 12): said, and tried again later.
        running = false; child = null;
        console.error('orgrollup: the enrolled Kosmos\'s rollup could not be started (' + String((e && e.message) || e) + ')');
        return 'failed';
      }
      return 'spawned';
    },
    // Free again at once (board review 15): a later tick does not wait for the killed child's callback.
    stop() { try { if (child) child.kill(); } catch { /* gone */ } child = null; running = false; },
  };
}

/* One other Kosmos's inventory, read by a child process in its environment: { world, gathered } or null.
   `usage` (kosmos#5532): whether the accepted words name usage for every Kosmos; only then is the child told 'usage'. */
function gatherIn(env, usage) {
  return new Promise((resolve) => {
    require('child_process').execFile(process.execPath, [path.join(__dirname, 'orgrollup-child.js'), 'gather'].concat(usage === true ? ['usage'] : []),
      { env, timeout: GATHER_TIMEOUT_MS, maxBuffer: GATHER_STDOUT_MAX }, (err, stdout) => {
        if (err) return resolve(null);
        try {
          const j = JSON.parse(String(stdout).trim().split('\n').pop());
          // A Kosmos that may belong to a company answers only that (board review 9): never its id or its inventory.
          if (j && j.ok === true && j.enrolled === true) return resolve({ enrolled: true });
          resolve(j && j.ok === true && typeof j.world === 'string' && j.gathered && typeof j.gathered === 'object' ? j : null);
        } catch { resolve(null); }
      });
  });
}

/* With a successful send of the enrolled Kosmos (`reason` its reason), each other Kosmos's rollup, under the same
   accepted words and computer print. A change send of a Kosmos whose signature did not move is skipped. Returns the
   signatures to keep, by world id. Never throws. */
async function sendOthers(c) {
  const next = {};
  const prev = c.prev && typeof c.prev === 'object' ? c.prev : {};
  /* The Kosmoses whose partial daily is being held (one daily's hold). Carried as they are unless a DAILY reads that
     Kosmos (board review 4: a change send, an early stop or an unreadable registry wiped the hold, so a Kosmos always
     partial on a busy computer was never sent). The caller writes c.heldNext. */
  const heldPrev = new Set(Array.isArray(c.held) ? c.held : []);
  const held = new Set(heldPrev);
  c.heldNext = held;
  /* The Kosmoses whose last DAILY did not land (board review 5): the next send of any kind sends them as a daily, so a
     failed daily waits for the enrolled Kosmos's next send, not a whole day. Carried like the holds. */
  const missedPrev = new Set(Array.isArray(c.missed) ? c.missed : []);
  const missed = new Set(missedPrev);
  c.missedNext = missed;
  // Only under words that name every Kosmos on this computer (the coordinator refuses the rest): none read, none sent.
  // Words that do not name every Kosmos keep no signatures (board review 2, decided): words naming them again resend
  // every Kosmos at once, the safe direction (the enrolled Kosmos's own signature, by contrast, survives new words).
  if (!c.accepted || c.accepted.everyKosmosConsented !== true) return next;
  // kosmos#5532: another Kosmos's usage only under words naming usage for every Kosmos, not this one's alone.
  const otherUsage = c.accepted.usageConsented === true && c.accepted.everyKosmosUsageConsented === true;
  let list = [];
  const seen = new Set();
  /* Every other Kosmos, not the first fifteen in registry order (board review 15): one enrolled itself, or unreadable,
     must not take a slot, so the fifteen are counted in SENDS below. */
  try { list = (c.o.otherWorlds || otherWorlds)(c.root, { all: true }) || []; } catch { return prev; }
  let tried = 0;
  let complete = true;   // every Kosmos read, and no stop: only then may the holds forget an id (board review 6)
  for (const w of list) {
    if (!c.oe.mayReport(c.eo)) { complete = false; break; }   // left meanwhile: nothing more goes
    /* Inside the run lock's bound (board review 14): an in-process tick has no other bound, and a run past it could
       have its live lock taken over. Checked before each read; each send after it is bounded by macRequest's own 20 s
       (remote.js MAC_REQUEST_TIMEOUT_MS). Kosmoses not reached are resent by a later send. */
    // The company takes OTHERS_MAX besides the enrolled Kosmos: past that, said once, and the rest wait.
    if (tried >= OTHERS_MAX) {
      console.error('orgrollup: this computer has more Kosmoses than the company takes; the rest are not sent');
      complete = false;
      break;
    }
    if (Number.isFinite(c.deadline) && Date.now() > c.deadline) {
      console.error('orgrollup: the other Kosmoses\' rollups stopped at the run\'s time bound; the rest go next time');
      complete = false;
      break;
    }
    let got = null;
    try { got = await (c.o.gatherIn || gatherIn)(w.env, otherUsage); } catch { got = null; }
    // A Kosmos that may belong to a company was not read at all (board review 9): skipped, and its old marks pruned.
    if (got && got.enrolled === true) continue;
    const idOk = !!got && require('./orgenroll').WORLD_ID.test(got.world);
    if (!idOk) complete = false;   // a malformed id is a failed read (board review 7)
    // A read that failed drops its signature, so the next change send sends it again (the safe direction), except
    // after a cap refusal later in the pass, which keeps the last signature that landed (board review 15). Two
    // entries that resolve to one id are one Kosmos: it goes once (board review 1).
    if (!idOk || got.world === c.rec.world || seen.has(got.world)) continue;
    seen.add(got.world);
    /* A fail-closed backstop (board review 11): the real gatherIn answers `{ enrolled: true }` above for a Kosmos that
       may belong to a company, so this catches only an answer that does not say `enrolled: false`. Such a Kosmos is
       never sent under this enrollment (board review 3). */
    if (got.enrolled !== false) { held.delete(got.world); missed.delete(got.world); continue; }
    if (Object.prototype.hasOwnProperty.call(prev, got.world)) next[got.world] = prev[got.world];
    const g = got.gathered;
    if (!otherUsage) { g.usageByDay = {}; g.usageWithheld = true; delete g.usageIncomplete; }
    // The company's policy is the computer's, reported by the enrolled Kosmos. Stripped BEFORE the signature below, so
    // the signature is of what is sent (board review 12: moving this after it would change every other Kosmos's).
    delete g.policyVersion; delete g.policyRefused; delete g.policyUsage;
    const sig = signature(build(Object.assign({ world: got.world, nowMs: c.now, reason: 'change' }, g)));
    const reason = c.reason === 'daily' || missedPrev.has(got.world) ? 'daily' : c.reason;
    /* A partial read (board reviews 1 and 3): the company takes a Kosmos's statuses from its first daily of the day,
       so a partial daily is held once, as the enrolled Kosmos holds its own for an hour. The others send only with the
       enrolled Kosmos, so the hold is one daily: a Kosmos partial again at the next daily is sent, marked truncated,
       rather than never reaching the company, and stays marked while it stays partial, so it is sent every day after
       the first (board review 5: dropping the mark after a send held it every other day). A partial read is never a
       change. */
    if (g.partial) {
      // A hold begins and ends only at a REAL daily (board reviews 7 and 12): a missed daily riding a change send, read
      // in part, waits for the next real daily, its missed mark kept.
      if (c.reason !== 'daily') continue;
      if (!heldPrev.has(got.world)) {
        held.add(got.world);
        console.error('orgrollup: another Kosmos on this computer could not be read in full; its daily waits a day');
        continue;
      }
    } else {
      if (reason === 'daily') held.delete(got.world);   // read in full: no hold
      if (reason === 'change' && prev[got.world] === sig) continue;
    }
    const body = build(Object.assign({ world: got.world, at: new Date(c.now).toISOString(), reason, nowMs: c.now }, g));
    Object.assign(body, c.pf.fields);
    /* Re-checked just before this send (board review 1), as the enrolled tick re-checks after its read: a read can take
       minutes, and a Leave, or new words (which may no longer name every Kosmos), in that time stops every later send. */
    const now2 = c.oe.mayReport(c.eo) ? c.oe.readEnrollment(c.eo) : null;
    if (!now2 || now2.world !== c.rec.world || now2.consentHash !== c.rec.consentHash) { complete = false; break; }
    let r;
    tried += 1;
    try { r = await c.remote.macRequest('POST', ROUTE, body); } catch (e) { r = { ok: false, because: String((e && e.message) || e) }; }
    if (r && r.ok) { if (reason === 'daily') missed.delete(got.world); if (!g.partial) next[got.world] = sig; continue; }
    if (reason === 'daily') missed.add(got.world);
    const code = (String((r && r.because) || '').match(/\borg_[a-z_]+\b/) || [])[0] || 'no answer';
    console.error('orgrollup: the company did not take another Kosmos\'s rollup (' + code + ')');
    // Refused for the member, not the Kosmos (board review 5): every later one would be refused too, after its read.
    if (code === 'org_consent_changed' || code === 'org_not_enrolled' || code === 'org_not_member') { complete = false; break; }
    if (code === 'org_rollup_too_many_worlds') {
      /* The company is full (board review 2): the Kosmoses not reached this time keep their signatures, so the next
         change send does not resend them all and hit the cap again at once. A Leave or new words drop them instead
         (the breaks above), the safe direction: those Kosmoses are resent in full. */
      for (const k of Object.keys(prev)) if (!seen.has(k)) next[k] = prev[k];
      complete = false;
      break;
    }
  }
  /* A Kosmos deleted, or one past the fifteen, would otherwise stay held or missed for good (board review 6). Pruned
     only after a pass that read every Kosmos: a failed read must not cost a held or missed daily. */
  if (complete) for (const set of [held, missed]) for (const id of [...set]) if (!seen.has(id)) set.delete(id);
  return next;
}

/**
 * One tick: send if this world is the enrolled one AND (a day has passed OR the agents or projects changed and the
 * last send is CHANGE_MIN_MS old), unless a failure was within RETRY_AFTER_FAIL_MS. Never throws.
 * opts: { root, remote, sources, now, usageReadMs (tests only) } (tests); the board passes nothing.
 */
async function tick(opts) {
  const startedReal = Date.now();
  const o = opts || {};
  const oe = require('./orgenroll');
  const eo = { root: o.root, remote: o.remote };
  /* #5791: with no screen any more, the board keeps its company's terms current by itself (reacceptWords):
     - no terms on record here (a re-accept after a change that could not reach the company, or a record from before
       terms were kept): at most once per RETAKE_EVERY_MS, since it sends nothing at all until then;
     - terms that ask for no reports (review 1): such a Kosmos never sends, so the company never refuses a report
       for changed terms and it would never learn of new ones. Checked once per RECHECK_NO_REPORTS_MS; terms still
       the same are left as they are (nothing is sent). */
  // One read (review 5): two could straddle another process's change and dereference a null, and tick never throws.
  const acc0 = oe.isEnrolledHere(eo) ? oe.acceptedConsent(eo) : undefined;
  const termsGone = acc0 !== undefined && (!oe.mayReport(eo) || !acc0);
  const quietTerms = !termsGone && !!acc0 && acc0.reports.length === 0;
  if (termsGone || quietTerms) {
    const rroot = o.root || require('./store').ROOT;
    const rnow = o.now || Date.now();
    const { at: last, misses } = readRetake(rroot, rnow);
    // Review 5: a company that keeps answering without terms this board can record (a print it will not pin, say)
    // is asked half as often after each miss, never less than once a day.
    const every = termsGone ? Math.min(RETAKE_EVERY_MS * 2 ** Math.min(misses, 10), RECHECK_NO_REPORTS_MS) : RECHECK_NO_REPORTS_MS;
    if (rnow - last < every) {
      return { sent: false, because: termsGone ? 'no company terms on record here; taking them on again later' : 'the company\'s terms ask for no reports' };
    }
    /* Stamped before the try, so a company that never answers is asked once per window, not on every tick. Before the
       run lock on purpose (review 3): two runs at once can both ask, which costs one extra status read and at most one
       repeated codeless enroll, and accepting the same words twice changes nothing on either side. */
    if (!writeRetake(rroot, rnow, misses)) return { sent: false, because: 'the company\'s terms could not be checked: the rollup state could not be saved' };
    let a = null;
    try { a = await oe.reacceptWords(eo); } catch (e) { a = { ok: false, because: (e && e.message) || String(e) }; }
    const recorded = !!a && a.ok === true && oe.mayReport(eo) && !!oe.acceptedConsent(eo);
    writeRetake(rroot, rnow, termsGone && !recorded ? misses + 1 : 0);
    if (!a || !a.ok) return { sent: false, because: 'the company\'s terms could not be taken on yet: ' + ((a && a.because) || 'no answer') };
  }
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
  // As read, before any cleaning (board review 11): what was on disk is never "another run" (anotherRunAdvanced).
  const stRead = JSON.parse(JSON.stringify(st || {}));
  if (st.enrolledAs !== enrolledAs) st = { enrolledAs };
  /* A time after now (a clock that was wrong once, then corrected) counts as never (rollup review 15): kept, it would hold
     "waiting after a failure" or "nothing due" until the clock caught up, days of silence with no signal. */
  /* And anything that is not a sane time at all (rollup review 19): a string, NaN, or a number outside [0, now] from a
     cut-off or hand-edited file would make toISOString() throw on every tick, silently and for good. */
  for (const k of ['failAt', 'lastAt', 'dailyAt', 'printWaitAt', 'partialSince', 'tryAt']) if (k in st && !(Number.isFinite(st[k]) && st[k] >= 0 && st[k] <= now)) delete st[k];
  /* A failure's wait belongs to the words it was sent under (rollup review 31): once the person accepts new words (a
     review's Accept keeps the enrollment), the wait no longer applies, so the screen's "reports to it" is true at once. */
  if (st.failAt && st.failHash !== (rec.consentHash || null)) delete st.failAt;
  if (st.failAt && now - st.failAt < RETRY_AFTER_FAIL_MS) return { sent: false, because: 'waiting after a failure' };
  // A run holding the lock: no read now (board review 9), it is checked again, and taken, before the send.
  if (runLockHeld(root, now)) return { sent: false, because: 'another rollup of this Kosmos is still running' };
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
    notePrintWait(root, st, enrolledAs, rec, pf.send === 'error' ? 'error' : 'later', now);
    return { sent: false, because: 'this computer could not be read yet' };
  }
  if (st.printWaitAt) {   // readable again
    delete st.printWaitAt; delete st.printWaitWhy; delete st.printWaitHash;
    writeState(root, Object.assign({}, st, { enrolledAs }));
  }
  /* kosmos#5532: read without usage first. The signature never includes usage, so whether anything is due is decided
     without it, and the scan (a week of transcripts, uncached) runs only for a send, below. */
  const src = o.sources || defaultSources();
  const g = await gather(src, { usage: false });
  /* Usage leaves only under a consent that named it (review 8): a reader added to the sources later cannot turn it on
     by itself. The read above takes none; this is the backstop, and usage is read only for a send, below, when the
     accepted words name it (usageConsented, recorded from NAMES_USAGE). */
  if (accepted.usageConsented !== true) { g.usageByDay = {}; g.usageWithheld = true; delete g.usageIncomplete; }   // backstop: gather above read none
  /* #5534: the policy version, and whether a bundle was refused, leave only under words that name the policy. Read as a
     create reads it (orgpolicy.refresh: the bundle on disk verified, the last good one kept; it may apply a newer
     bundle, as a create would, and reads the shared data folder, not o.root). Only this company's: a policy another
     company left behind is not reported as this one's. A refusal counts unless it is the policy in force merely
     expired (orgpolicy `stale`, signature checked) or a fault on this computer (`local`: a failed save, no pinned
     key). A read that throws sends what was last sent (review 3: leaving them out would change the signature and
     send twice for a passing fault), or nothing when none was; the company keeps what it had. Never throws. Not reported, decided: refusals
     applyPolicy makes before saving, a bundle over 64 KB or naming another company, which a working coordinator never
     sends (it caps a policy at 16 KB and signs each company's own) and which never reach the disk. Known limit
     (review 5): a newer bundle left unapplied by a failed save, then expired a week later, reads as a refusal. */
  delete g.policyVersion; delete g.policyRefused; delete g.policyUsage;
  if (accepted.policyConsented === true) {
    try {
      const op = o.orgpolicy || require('./orgpolicy');
      const pr = op.refresh();
      const mine = pr.applied && rec.org && pr.applied.org === rec.org.id ? pr.applied : null;
      g.policyVersion = mine ? mine.version : null;
      g.policyRefused = !!pr.refused && pr.local !== true && pr.stale !== true;
      /* kosmos#6309: the cap's count, only under words that name it (capConsented: the policy line does not), and only
         for this company's policy. */
      // usagecap.capReport, never an inline count: the enrolled board runs this tick in its own process (server.js).
      const u = mine && accepted.capConsented === true ? (o.usagecap || require('./usagecap')).capReport(mine.policy, now) : { capped: false };
      if (u.capped && u.known === true) g.policyUsage = { used: u.used, cap: u.cap, warn: u.warn, over: u.over, month: u.month };
      /* A cap whose count is not known yet (a new board still counting the month): the coordinator reads the policy
         without a count as "no cap", so what was last sent goes again, as for a failed read below. Only while it is
         still the policy in force: a policy (or refusal) not yet reported goes now, without a count, and the count
         follows when it is known. */
      else if (u.capped && samePolicy(st, g)) { delete g.policyVersion; delete g.policyRefused; repeatLastPolicy(g, st); }
    } catch {
      delete g.policyVersion; delete g.policyRefused; delete g.policyUsage;
      repeatLastPolicy(g, st);
    }
  }
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
  if (accepted.usageConsented === true) { delete g.usageWithheld; await readUsage(src, g, o.usageReadMs); }   // usageReadMs: tests only
  /* kosmos#6842 slice 3: per-project use, on the daily send only (a change send would say when work finished), under words
     naming it. */
  if (due && accepted.projectUsageConsented === true) await readProjectUsage(src, g, o.projectUsageReadMs);
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
  /* One run of this Kosmos's rollup at a time, across processes (board reviews 7 and 8): a board stopped with SIGTERM
     cannot stop the tick child it started, and the next board would run the same tick beside it. An exclusively created
     lock file in this Kosmos's root, taken here (after the read that took minutes) and always released below. */
  // Stamped with the time it is taken, not when this tick began (board review 10: the read can take minutes).
  const lockToken = takeRunLock(root, now + (Date.now() - startedReal));
  if (!lockToken) return { sent: false, because: 'another rollup of this Kosmos is still running' };
  try {
    /* Another run may have sent between this run's read and its lock (board review 9: the lock stops overlap, not two
       runs in a row). Anything it changed means this read is stale: stand down; the next tick decides afresh. */
    if (anotherRunAdvanced(readState(root), stRead, st, now)) {
      return { sent: false, because: 'another rollup of this Kosmos ran meanwhile' };
    }
    if (!writeState(root, Object.assign({}, st, { enrolledAs, tryAt: now }))) return { sent: false, because: 'this Kosmos cannot record when it reported' };
    const remote = o.remote || require('./remote');
    let r;
    try { r = await remote.macRequest('POST', ROUTE, body); } catch (e) { r = { ok: false, because: String((e && e.message) || e) }; }
    if (r && r.ok) {
      const done = Object.assign({ enrolledAs, lastAt: now, dailyAt: body.reason === 'daily' ? now : (st.dailyAt || st.lastAt || null), lastSig: g.partial ? (st.lastSig || null) : sig },
        // #5534: what was reported, so a read that fails next time sends the same (review 3).
        'policyVersion' in body ? { lastPolicy: { version: body.policyVersion, refused: body.policyRefused === true, ...(body.policyUsage ? { usage: body.policyUsage } : {}) } } : {},
        st.others && typeof st.others === 'object' ? { others: st.others } : {},
        // Board review 5: the holds and missed dailies survive a board stopped while the others are read.
        Array.isArray(st.othersHeld) ? { othersHeld: st.othersHeld } : {}, Array.isArray(st.othersMissed) ? { othersMissed: st.othersMissed } : {});
      writeState(root, done);
      // #5532 widening: then every other Kosmos on this computer, recorded once they are sent.
      const oc = { o, oe, eo, rec, accepted, pf, root, now, reason: body.reason, remote, prev: st.others, held: st.othersHeld, missed: st.othersMissed,
      // Ten minutes inside the lock's bound, from when this tick began (board review 14).
      deadline: startedReal + TICK_CHILD_TIMEOUT_MS - 10 * 60 * 1000 };
      /* Never lets a throw past (board review 8): the enrolled send has landed, so a fault in another Kosmos's rollup keeps
         what was recorded before it and is said, and the lock is released below either way. */
      let others = st.others && typeof st.others === 'object' ? st.others : {};
      try { others = await sendOthers(oc); } catch (e) { console.error('orgrollup: the other Kosmoses\' rollups stopped (' + String((e && e.message) || e) + ')'); }
      writeState(root, Object.assign({}, done, { others, othersHeld: [...(oc.heldNext || st.othersHeld || [])], othersMissed: [...(oc.missedNext || st.othersMissed || [])] }));
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
      const withdrawn = await oe.consentWithdrawn(eo, rec.consentHash);   // only the words this report was sent under (review 11)
      // #5791: the company decided, so the board accepts its current words itself (no screen), and reports resume.
      if (withdrawn) { try { const a = await oe.reacceptWords(eo); if (!a.ok) console.error('orgrollup: the company\'s new terms could not be taken on yet: ' + (a.because || 'no answer')); } catch (e) { console.error('orgrollup: taking on the company\'s new terms failed: ' + ((e && e.message) || e)); } }
      return { sent: false, because: 'the company\'s words changed; Kosmos takes them on and reports again' };
    }
    /* The company no longer takes this world's reports: ask it at once (refresh stops this world on a clear answer). */
    if (r && /\borg_not_enrolled\b|\borg_not_member\b/.test(String(r.because || ''))) {
      try { await oe.refresh(eo); } catch { /* the hourly refresh tries again (#6232) */ }
    }
    return { sent: false, because: 'the company did not take it' };
  } finally { releaseRunLock(root, lockToken); }
}

/* The run lock (board review 8): created with O_EXCL, so of two runs that reach it together exactly one takes it. It
   holds when it was taken and a token of its own; a lock older than TICK_CHILD_TIMEOUT_MS belongs to a run that died,
   and is taken over. A run releases only its OWN lock (board review 9: one that outlived the bound must not remove the
   lock of the run that took over). Known residual (board review 11): THREE runs meeting a dead run's lock in the same
   instant can still leave two running, if the third creates a lock between the second moving a live one aside and
   linking it back; it needs a dead run and three ticks at once. */
const RUN_LOCK_FILE = 'org-rollup.lock';
/* Whether another run sent, tried or failed after this run read the state (board reviews 9 and 11): one of those times
   is now something this run neither read (`read`, as on disk) nor wrote itself (`own`, its cleaned copy, which its own
   cleanup writes), and later than what it read. One rule, so a field cannot drift between two copies of it. A time far
   in the future is damage, not a run; damage that was already there is what this run read. */
function anotherRunAdvanced(fresh, read, own, now) {
  if (!fresh) return false;
  const num = (o, k) => (o && Number.isFinite(o[k]) ? o[k] : null);
  return ['lastAt', 'tryAt', 'failAt'].some((k) => {
    const v = num(fresh, k);
    return v !== null && v <= now + TICK_CHILD_TIMEOUT_MS && v !== num(read, k) && v !== num(own, k)
      && v > (num(read, k) === null ? -Infinity : num(read, k));
  });
}
function readRunLock(file) {
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return j && typeof j === 'object' ? j : {}; } catch (e) { return e && e.code === 'ENOENT' ? null : {}; }
}
/* Held: a lock taken within the bound. One that cannot be read or has no time (being written, or damaged) is held
   until the FILE is older than the bound (board review 10): a half-written lock is a live one. */
function lockIsLive(file, j, now) {
  if (!j) return false;
  // Either side of now (a lock is stamped when taken, which can be after another run's tick began), within the bound.
  if (Number.isFinite(j.at)) return Math.abs(now - j.at) < TICK_CHILD_TIMEOUT_MS;
  try { return Date.now() - fs.statSync(file).mtimeMs < TICK_CHILD_TIMEOUT_MS; } catch { return false; }
}
function runLockHeld(root, now) {
  const file = path.join(root, RUN_LOCK_FILE);
  return lockIsLive(file, readRunLock(file), now);
}
function takeRunLock(root, now) {
  const file = path.join(root, RUN_LOCK_FILE);
  const token = now + '.' + process.pid + '.' + require('crypto').randomBytes(8).toString('hex');
  for (let i = 0; i < 2; i++) {
    try {
      const fd = fs.openSync(file, 'wx', 0o600);
      try { fs.writeSync(fd, JSON.stringify({ at: now, token })); } catch (w) {
        // Created but not written (a full disk): removed, so it does not hold every run for the bound (board review 13).
        try { fs.closeSync(fd); } catch { /* closed */ }
        try { fs.unlinkSync(file); } catch { /* gone */ }
        throw w;
      }
      fs.closeSync(fd);
      return token;
    } catch (e) {
      if (!e || e.code !== 'EEXIST') return null;   // cannot be taken: never send unlocked
      if (runLockHeld(root, now)) return null;
      /* Taken over by moving it aside first (board review 10): a rename is atomic, so of two runs that both judged it
         stale one moves it. What was moved is read again: if another run had replaced it with a live lock meanwhile,
         it goes back (a link, which never overwrites) and this run stands down. */
      const aside = file + '.' + token;
      try { fs.renameSync(file, aside); } catch { continue; }
      const moved = readRunLock(aside);
      if (lockIsLive(aside, moved, now)) {
        try { fs.linkSync(aside, file); } catch { /* a third run holds it now */ }
        try { fs.unlinkSync(aside); } catch { /* gone */ }
        return null;
      }
      try { fs.unlinkSync(aside); } catch { /* gone */ }
    }
  }
  return null;
}
function releaseRunLock(root, token) {
  const file = path.join(root, RUN_LOCK_FILE);
  const j = readRunLock(file);
  if (j && j.token === token) { try { fs.unlinkSync(file); } catch { /* gone */ } }
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
  _resetUsageScanForTests, CHILD_USAGE_READ_MS,
  projectUsageByDay, readProjectUsage, PROJECT_USAGE_ROWS, PROJECT_USAGE_READ_MS, PROJECT_USAGE_TASKS,   // kosmos#6842
  waitingForPrint, KNOWN_RUNNERS, KNOWN_PROVIDERS,
  DAILY_MS, CHANGE_MIN_MS, RETRY_AFTER_FAIL_MS, RETAKE_EVERY_MS, RECHECK_NO_REPORTS_MS, STATE_FILE, RETAKE_FILE, signature, tick,
  ROUTE, VERSION, NAME_MAX, AGENTS_MAX, PROJECTS_MAX, NAMES_MAX, USAGE_DAYS, USAGE_ROWS_PER_DAY, BODY_MAX,
  STATUS, statusWord, providerOfModel, build, gather, defaultSources, otherWorlds, gatherIn, sendOthers, OTHERS_MAX,
  TICK_CHILD_TIMEOUT_MS, GATHER_TIMEOUT_MS, RUN_LOCK_FILE, elsewhereRunner, enrolledElsewhere, spawnEnrolledTick,
};
