'use strict';
/**
 * #5534 (Enterprise E0.5): the company policy an enrolled board applies. Design on the card (agreed with the E0.1 and
 * E0.2 owners): the coordinator signs each org's policy as a KST1 token of `typ: org_policy` with its own key, the
 * key every Kosmos+ Mac already pins; the coordinator serves it on the board's Mac-signed org-status answer, and the
 * board's enrollment refresh (engine/orgenroll.js applyPolicy, on start, hourly and right after a join) writes it to
 * `org_policy.kst` in the tunnel's state folder; this module verifies it AGAIN (the file is on disk, so it is not trusted) and
 * keeps the last good one in force when a new one is refused.
 *
 * Payload (v1): { typ: 'org_policy', v: 1, org, version, iat, exp, policy: { providers_allowed, models_allowed,
 * backup: { required, max_age_hours }, telemetry: { required }, ai_policy: { name, text } } }. A null list means "not
 * restricted". Providers are named by the board's own ids (anthropic, openai, google, xai, antigravity, meta, alibaba), the
 * ones create.js uses, and models by their Kosmos key or full id (opus or claude-opus-...); either matches. When a
 * provider has a model list, a model must be named or be the provider's known default (create.policyAllows).
 *
 * Enforced when an agent is created (the create form, connecting a folder, importing from another Kosmos) or
 * switched to another provider or model. An agent already on something the policy later drops keeps running and
 * keeps relaunching: the card says nothing is bricked, and showing it as out of policy is the console's (E0.4).
 *
 * Rollback: the applied record keeps the highest version seen for each org, so an older bundle of an org is refused
 * even after a bundle of another org came in between.
 *
 * What this is NOT trusted for, until E0.2 binds a Mac to its org and E0.3 has the coordinator check the version each
 * board reports: the person whose Mac it is can write every file involved. They can put any validly signed, unexpired
 * bundle of ANOTHER org in place (it is not older under that org's own count), edit or delete the applied record
 * (it is not signed), or replace the pinned coordinator key in the tunnel's folder. This module keeps an honest board
 * from drifting and refuses forged or tampered bundles; it does not stop the Mac's own user.
 *
 * Enrollment (engine/orgenroll.js): the policy ends when this Kosmos stops being the company's enrolled one, and a
 * policy of another company than the enrolled one is cleared before the new company's is applied. The highest version
 * seen for each org is kept across that clear. An expired bundle does not lift the policy in force: the last good one
 * stays until the company serves a newer one or the enrollment ends (fails closed).
 *
 * Reported: the applied version and whether one was refused ride the rollup under consent words naming the policy
 * (engine/orgrollup.js, #5534 slice 2). The AI policy text reaches every agent through engine/policy.js
 * (companyEntry, #5534 slice 3). The policy is per Kosmos on a Mac, as enrollment is: another Kosmos on the same Mac has its own.
 */
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');
const kst1 = require('./kst1');

const TYP = 'org_policy';
// The tunnel's state folder: the same derivation as remote.js's STATE_DIR, read live rather than frozen at load (so a
// test can point it elsewhere); remote.js is not required for it because loading it starts that module's timers.
const stateDir = () => process.env.AGENT_WORKFORCE_TUNNEL_STATE || path.join(store.ROOT, 'remote');
const BUNDLE = () => path.join(stateDir(), 'org_policy.kst');
const PINNED = () => path.join(stateDir(), 'coordinator_pubkey');
const APPLIED = () => path.join(store.ROOT, 'org-policy-applied.json');

function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

function readApplied() {
  const raw = readText(APPLIED());
  if (raw === null) return null;
  try {
    const j = JSON.parse(raw);
    return j && Number.isInteger(j.version) && j.policy && typeof j.policy === 'object' ? j : null;
  } catch { return null; }
}

/** The highest version seen for each company, kept even while no policy is in force (review 3). */
function readMarks() {
  try {
    const m = JSON.parse(readText(APPLIED()) || 'null');
    const marks = m && m.marks && typeof m.marks === 'object' && !Array.isArray(m.marks) ? m.marks : {};
    const out = {};
    for (const [k, v] of Object.entries(marks)) if (Number.isInteger(v)) out[k] = v;
    return out;
  } catch { return {}; }
}

function writeApplied(rec) {
  const file = APPLIED();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // #5434 slice 15: through securewrite.writeSecret (flushed before the rename, the folder after on POSIX; a unique `wx` temp; exact 0600), so a crash cannot leave it at full length but zero-filled (#5431). atomicOnly: a failed save leaves the old file.
  require('./securewrite').writeSecret(file, JSON.stringify(rec, null, 2) + '\n', 0o600, { atomicOnly: true });
}

const list = (v) => (v === null || v === undefined ? null : Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : undefined);

/** The policy object's shape is checked, so a signed but malformed bundle is refused rather than half-applied. */
function shapeOk(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
  if (list(p.providers_allowed) === undefined) return false;
  const m = p.models_allowed;
  if (m !== null && m !== undefined) {
    if (typeof m !== 'object' || Array.isArray(m)) return false;
    if (!Object.values(m).every((v) => list(v) !== undefined && v !== null)) return false;
  }
  /* kosmos#6239: the two keys this board enforces are held to the coordinator's exact shapes (kosmos-relay org.rs
     policy_problem), so a bundle that would stop or open contact, or set a window, other than the company meant is
     refused whole and the last good policy stays. A zone is held to its shape only, as the coordinator holds it: a
     well-formed zone this runtime cannot read must not refuse the bundle, or it would take outside_contact down with
     it (challenge round 1); quietAt keeps quiet hours all day for it instead. Other keys stay unread, as before. */
  const oc = p.outside_contact;
  if (oc !== null && oc !== undefined && !(oc && typeof oc === 'object' && !Array.isArray(oc)
    && Object.keys(oc).length === 1 && typeof oc.enabled === 'boolean')) return false;
  const q = p.quiet_hours;
  if (q !== null && q !== undefined && !quietShapeOk(q)) return false;
  const u = p.usage_cap;
  if (u !== null && u !== undefined && !capShapeOk(u)) return false;
  return true;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutesOf = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
function zoneShapeOk(tz) { return typeof tz === 'string' && /^[A-Za-z0-9_+-][A-Za-z0-9_+/-]{0,63}$/.test(tz); }
function quietShapeOk(q) {
  return !!q && typeof q === 'object' && !Array.isArray(q) && Object.keys(q).length === 4 && zoneShapeOk(q.tz)
    && typeof q.school_nights === 'boolean' && HHMM.test(q.from) && HHMM.test(q.to) && q.from !== q.to;
}

/* kosmos#6309: { monthly_tokens, warn_pct, tz }, exactly. A cap in tokens (a subscription has no per-message price, so
   a dollar figure would be invented), a whole-percent heads-up below 100, and the zone whose calendar month it counts. */
const CAP_MAX_TOKENS = 1e12;
function capShapeOk(u) {
  return !!u && typeof u === 'object' && !Array.isArray(u) && Object.keys(u).length === 3 && zoneShapeOk(u.tz)
    && Number.isInteger(u.monthly_tokens) && u.monthly_tokens > 0 && u.monthly_tokens <= CAP_MAX_TOKENS
    && Number.isInteger(u.warn_pct) && u.warn_pct >= 1 && u.warn_pct <= 99;
}

/**
 * Read the tunnel's bundle and apply it if it verifies. Never throws. Returns what is in force:
 * { applied: <record or null>, refused: <why or null>, stale?: true (the policy in force merely expired), local?: true
 * (a fault on this computer: no pinned key, or the record could not be saved) }. A missing bundle with nothing applied is "no policy".
 * `now` and `pinned` are for tests.
 */
function refresh({ now, pinned } = {}) {
  const applied = readApplied();
  const token = readText(BUNDLE());
  if (token === null) return { applied, refused: null };
  const key = pinned !== undefined ? pinned : readText(PINNED());
  const v = kst1.verify(token, key, TYP, now);
  if (!v.ok) {
    /* #5534 slice 2: `stale` when the only fault is that the bundle in force has expired (its signature verifies, and
       it is that same company, version and policy): not something new the company sent, so the rollup does not report
       it as a refusal. Any other refusal, a same-version bundle with other words included, is reported. */
    let stale = false;
    if (applied && v.why === 'the token has expired') {
      const old = kst1.verify(token, key, TYP, 0);
      stale = !!(old.ok && old.payload.org === applied.org && old.payload.version === applied.version
        && JSON.stringify(old.payload.policy) === JSON.stringify(applied.policy));
    }
    // `local` too when this computer has no coordinator key to check with: nothing the company sent was refused.
    const local = v.why === 'no pinned coordinator key';
    return { applied, refused: v.why, ...(stale ? { stale: true } : {}), ...(local ? { local: true } : {}) };
  }
  const p = v.payload;
  if (p.v !== 1 || typeof p.org !== 'string' || !p.org || !Number.isInteger(p.version) || p.version < 1 || !shapeOk(p.policy)) {
    return { applied, refused: 'the policy bundle is not one this Kosmos understands' };
  }
  const marks = readMarks();
  const mark = Math.max(Number.isInteger(marks[p.org]) ? marks[p.org] : 0, applied && applied.org === p.org ? applied.version : 0);
  if (p.version < mark) return { applied, refused: `an older policy (version ${p.version}) than one already applied (${mark})` };
  if (applied && applied.org === p.org) {
    if (p.version === applied.version) {
      // Same version, same words: nothing to do. Same version, other words: the coordinator never does that.
      return JSON.stringify(p.policy) === JSON.stringify(applied.policy)
        ? { applied, refused: null }
        : { applied, refused: `a different policy under the same version (${p.version})` };
    }
  }
  const nextMarks = { ...marks, [p.org]: Math.max(mark, p.version) };
  // A record written before marks existed has only its own org and version: keep that one as a mark too.
  if (applied && Number.isInteger(applied.version)) nextMarks[applied.org] = Math.max(nextMarks[applied.org] || 0, applied.version);
  const rec = { org: p.org, version: p.version, iat: p.iat, applied_at: Math.floor(Date.now() / 1000), policy: p.policy, marks: nextMarks };
  // `local`: this Kosmos could not keep a good bundle, which is not a refusal of what the company sent (#5534 slice 2).
  try { writeApplied(rec); } catch (e) { return { applied, refused: 'the policy could not be saved: ' + ((e && e.message) || e), local: true }; }
  return { applied: rec, refused: null };
}

/** #5534 slice 3: the applied record as it is ({ org, version, applied_at, policy }), or null. A read only: it never
 *  applies a bundle (inForce does), so composing an agent's instructions has no side effect. */
function appliedNow() { return readApplied(); }

/** The policy in force, or null when there is none. */
function current() {
  const a = readApplied();
  return a ? a.policy : null;
}

/* kosmos#6239 (challenge round 2): the same read for the two family checks, strict. Only a missing file is "no policy";
   a file that cannot be read or parsed THROWS, so each caller's own fault rule applies (contact paths refuse, quiet
   paths allow and say nothing) instead of a fault reading as no policy at all. */
function currentStrict() {
  let raw;
  try { raw = fs.readFileSync(APPLIED(), 'utf8'); } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    throw e;
  }
  const j = JSON.parse(raw);
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('the applied policy record is not one this Kosmos understands');
  /* Round 3: clear() leaves the marks alone ({ marks }) when an enrollment ends, and that is no policy, not a fault:
     reading it as one shut the community and every room on a computer that had merely left. Half a record is a fault. */
  if (!('policy' in j) && !('version' in j)) return null;
  if (!(Number.isInteger(j.version) && j.policy && typeof j.policy === 'object')) throw new Error('the applied policy record is not one this Kosmos understands');
  return j.policy;
}

/** The policy in force after applying whatever bundle the tunnel has written since (two small reads and one
 *  signature check, so it is asked fresh at every create and switch rather than on a timer). Never throws. */
function inForce() {
  try { const r = refresh(); return r.applied ? r.applied.policy : null; } catch { return current(); }
}

/* #6233: a refusal names the provider in the provider menus' words (the Add a provider menu's vendor names; google in the
   create menu's "Google Gemini (API key)", see below), never by its internal id ('openai'). Not
   create.providerLabel: that one says 'Anthropic' for any id it does not know, which here would refuse a provider by
   naming another. An id not listed reads as "this provider". */
const PROVIDER_NAMES = Object.freeze({
  anthropic: 'Anthropic Claude',
  openai: 'OpenAI',
  // The create menu's words: "Google Gemini" alone would read as all of Gemini, beside a subscription row it may allow.
  google: 'Google Gemini (API key)',
  antigravity: 'Google Gemini (Google subscription)',
  xai: 'xAI Grok',
  meta: 'Meta Muse',
  alibaba: 'Alibaba Qwen',
});
function providerName(provider) {
  return Object.prototype.hasOwnProperty.call(PROVIDER_NAMES, provider) ? PROVIDER_NAMES[provider] : 'this provider';
}

/**
 * Whether a new agent may run on this provider and model under the policy in force. No policy: allowed.
 * { ok: true } | { ok: false, because } (the sentence a person reads).
 */
function allows({ provider, model } = {}, policy = inForce()) {
  if (!policy) return { ok: true };
  // kosmos#6263: a family's policy is said as the family's (required here: orgenroll requires this file).
  const oe = require('./orgenroll');
  const say = (text) => oe.inKind(oe.kindHere(), text);
  // A model may come as several names for one model (its Kosmos key and its full id); any one listed allows it.
  const names = (Array.isArray(model) ? model : [model]).filter((x) => typeof x === 'string' && x !== '');
  const providers = policy.providers_allowed;
  if (Array.isArray(providers) && !providers.includes(provider)) {
    return { ok: false, because: say(`your company's policy does not allow ${providerName(provider)} for new agents`) };
  }
  const models = policy.models_allowed && policy.models_allowed[provider];
  if (Array.isArray(models) && !names.length) {
    // No model named and none known for it (a vendor's own default): no list can name it, so it is not allowed.
    return { ok: false, because: say(`your company's policy allows only some models on ${providerName(provider)}: choose one of them`) };
  }
  if (Array.isArray(models) && !names.some((n) => models.includes(n))) {
    return { ok: false, because: say(`your company's policy does not allow the model ${names[0]} on ${providerName(provider)}`) };
  }
  return { ok: true };
}

/* kosmos#6239: the two refusals are worded for whoever set the policy (a company, or a parent on a family account), so
   neither says "company". */
const POLICY_SETTER = 'the policy set for this Kosmos';

/** kosmos#6367: whether the company requires this computer to report to it (`telemetry: { required: true }`). Only
 *  a policy that says exactly true requires it; no policy, the key unset, or anything unreadable does not. It is said,
 *  not enforced here: a work Kosmos has no switch that turns reports off, so what the policy changes is what the person
 *  is told before they remove this computer from Kosmos+ (which stops its reports) and what the admin sees. */
function reportingRequired(policy) {
  let p = policy;
  if (p === undefined) { try { p = current(); } catch { return false; } }
  return !!(p && typeof p === 'object' && p.telemetry && typeof p.telemetry === 'object' && p.telemetry.required === true);
}

const CONTACT_STOPS = `${POLICY_SETTER} keeps agents out of the Kosmos+ community and out of projects shared with other computers`;
/** kosmos#6239: whether agents may reach anyone outside this computer (the Kosmos community, federation, rooms shared
 *  with another computer). Stopped by `outside_contact: { enabled: false }`. kosmos#6859: on a computer joined to a
 *  family it is also stopped while the key is unset or there is no policy (a parent never saved one), and only
 *  `{ enabled: true }` allows; for anyone else no policy, or the key unset, allows. The kind is read
 *  (orgenroll.kindStrict) only when the policy does not settle it and the caller gave none (undefined; null means
 *  joined to nobody); an enrollment file that is there but cannot be read then throws, as a damaged policy record
 *  does. */
function contactAllows(policy = currentStrict(), kind) {
  const oc = policy && policy.outside_contact;
  const set = oc && typeof oc === 'object' ? oc.enabled : undefined;
  if (set === false) return { ok: false, because: CONTACT_STOPS };
  if (set === true) return { ok: true };
  const k = kind === undefined ? require('./orgenroll').kindStrict() : kind;
  return k === 'family' ? { ok: false, because: FAMILY_CONTACT_STOPS, family: true } : { ok: true };
}
/* kosmos#6870: the family default's own sentence. There is no policy saying off there (none was saved, or it does not
   set outside contact), so the policy's sentence would name a policy that does not exist. About shared projects only:
   the community has its own (FAMILY_COMMUNITY_STOPS). */
const FAMILY_CONTACT_STOPS = "on a family's Kosmos, agents stay out of projects shared with other computers until a parent allows outside contact in the family's policy";
/* kosmos#6862: the same sentence's family form, for the community alone. */
const FAMILY_COMMUNITY_STOPS = "on a family's Kosmos, agents do not take part in the Kosmos+ community";
/** kosmos#6862 (Josh, 2026-10-15 10:45 #6239: an agent a kid uses "is not to participate in the community aspect"):
 *  whether agents may take part in the Kosmos+ community. On a computer joined to a family never, whatever the policy
 *  says, `{ enabled: true }` included (that still opens projects shared with other computers: contactAllows); a policy
 *  saying `{ enabled: false }` keeps its own sentence. For anyone else, the same answer as contactAllows.
 *  { ok: true } | { ok: false, because, family? }. Throws as contactAllows does. */
function communityAllows(policy = currentStrict(), kind) {
  const oc = policy && policy.outside_contact;
  if (oc && typeof oc === 'object' && oc.enabled === false) return { ok: false, because: CONTACT_STOPS };
  const k = kind === undefined ? require('./orgenroll').kindStrict() : kind;
  return k === 'family' ? { ok: false, because: FAMILY_COMMUNITY_STOPS, family: true } : { ok: true };
}

/* The local weekday (0 Sunday) and minute of the day at `ms` in `tz`. */
function localClock(ms, tz) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ms));
  const get = (t) => (parts.find((x) => x.type === t) || {}).value;
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { day, minute: (Number(get('hour')) % 24) * 60 + Number(get('minute')) };
}

/** kosmos#6239: whether `ms` falls in the policy's quiet hours. A window belongs to the day it STARTS on: 21:00 to
 *  07:00 on Sunday runs into Monday morning. With school_nights only windows starting Sunday to Thursday count, so
 *  Friday and Saturday nights are free. { quiet: false } | { quiet: true, until: 'HH:MM', tz } |
 *  { quiet: true, until: null, tz, unknownZone: true }. Never throws. A zone this computer cannot read keeps quiet
 *  hours all day (closed, and plain to whoever set it: nothing reaches an agent) rather than none (open, unnoticed). */
function quietAt(policy = currentStrict(), ms = Date.now()) {
  const q = policy && policy.quiet_hours;
  if (!quietShapeOk(q)) return { quiet: false };
  let c;
  try { c = localClock(ms, q.tz); } catch { return { quiet: true, until: null, tz: q.tz, unknownZone: true }; }
  if (c.day < 0 || !Number.isFinite(c.minute)) return { quiet: true, until: null, tz: q.tz, unknownZone: true };
  const from = minutesOf(q.from), to = minutesOf(q.to);
  let startDay = null;
  if (from < to) { if (c.minute >= from && c.minute < to) startDay = c.day; }
  else if (c.minute >= from) startDay = c.day;
  else if (c.minute < to) startDay = (c.day + 6) % 7;
  if (startDay === null || (q.school_nights && startDay > 4)) return { quiet: false };
  return { quiet: true, until: q.to, tz: q.tz };
}

/** kosmos#6239: { ok: true } | { ok: false, because } for starting an agent or giving one a new message now. */
function quietAllows(policy = currentStrict(), ms = Date.now()) {
  const q = quietAt(policy, ms);
  if (!q.quiet) return { ok: true };
  if (q.unknownZone) return { ok: false, because: `${POLICY_SETTER} sets quiet hours in a time zone this computer cannot read (${q.tz}), so they last all day` };
  return { ok: false, because: `it is quiet hours until ${q.until} (${q.tz} time), under ${POLICY_SETTER}` };
}

/* kosmos#6309: the local wall-clock of `ms` in `tz`, as numbers. Throws on a zone this runtime cannot read. */
function localParts(ms, tz) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ms));
  const get = (t) => Number((parts.find((x) => x.type === t) || {}).value);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour') % 24, mi: get('minute'), s: get('second') };
}

/** kosmos#6309: the instant this calendar month began (the 1st, 00:00) in `tz`. Throws on a zone this runtime cannot
 *  read. The zone's offset is found by asking what local time an instant shows, twice, so a month that starts on a
 *  daylight-saving change still lands on local midnight. */
function monthStart(ms, tz) {
  const { y, m } = localParts(ms, tz);
  const wall = Date.UTC(y, m - 1, 1);
  let guess = wall;
  for (let i = 0; i < 3; i++) {
    const p = localParts(guess, tz);
    const shown = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
    if (shown === wall) break;
    guess += wall - shown;
  }
  return guess;
}

/** kosmos#6309: what the policy's usage cap says for `used` tokens this month. { capped: false } when there is no
 *  cap; else { capped: true, used, cap, pct, warn: used >= warn_pct of cap, over: used >= cap, tz }. `pct` is whole
 *  percent, rounded down so it reads 99 until the cap is really reached. Never throws when given a policy (with none,
 *  it reads the one in force, which throws on a damaged record). */
function capAt(policy = currentStrict(), used = 0) {
  const u = policy && policy.usage_cap;
  if (!capShapeOk(u)) return { capped: false };
  const n = Number.isFinite(used) && used > 0 ? Math.floor(used) : 0;
  const pct = Math.floor((n * 100) / u.monthly_tokens);
  return { capped: true, used: n, cap: u.monthly_tokens, pct, warn: pct >= u.warn_pct, over: n >= u.monthly_tokens, tz: u.tz };
}

/** kosmos#6309: { ok: true } | { ok: false, because } for giving an agent a new message with `used` tokens this month. */
function capAllows(policy, used) {
  /* Both required: the gate is usagecap.capAllows, which counts the month. A call that forgot the count would read 0
     and always allow. */
  if (!Number.isFinite(used)) throw new Error('orgpolicy.capAllows needs this month\'s count; the gate is usagecap.capAllows');
  const c = capAt(policy, used);
  if (!c.capped || !c.over) return { ok: true };
  return { ok: false, because: capSentence(c) };
}
/** kosmos#6309: the refusal's words for capAt's { used, cap, tz }. */
function capSentence(c) {
  const n = (x) => Number(x).toLocaleString('en-US');
  return `this month's usage cap is reached (${n(c.used)} of ${n(c.cap)} tokens), under ${POLICY_SETTER}; it opens again on the 1st (${c.tz} time)`;
}

/* #5534 review 1: the board stopped being this company's enrolled Kosmos (it left, was removed, or the company stopped
   naming it): its policy no longer applies here. The bundle and the policy go, so nothing re-applies it; a later join
   brings the company's current one. Review 3: the highest version seen for each company stays, so an older bundle
   replayed after a rejoin is still refused. The marks only grow: the coordinator numbers each company's policies
   upward and never restarts them; if it ever did, this board would refuse them (fails closed). Never throws. */
function clear() {
  const a = readApplied();
  const marks = readMarks();
  if (a && typeof a.org === 'string') marks[a.org] = Math.max(Number.isInteger(marks[a.org]) ? marks[a.org] : 0, a.version);
  try { fs.rmSync(BUNDLE(), { force: true }); } catch { /* already gone */ }
  try {
    if (Object.keys(marks).length) writeApplied({ marks });
    else fs.rmSync(APPLIED(), { force: true });
  } catch { try { fs.rmSync(APPLIED(), { force: true }); } catch { /* already gone */ } }
}

/** The company whose policy is in force, or null (review 3: a policy of a company this Kosmos left is cleared). */
function appliedOrg() { const a = readApplied(); return a && typeof a.org === 'string' ? a.org : null; }

/** The company the bundle on disk names, unverified (review 5: a mix-up check before it is applied), or null. */
function bundleOrg() { const b = bundleInfo(); return b ? b.org : null; }


/** The company and version the bundle on disk names, unverified, or null. bundleOrg's reader. */
function bundleInfo() {
  const t = readText(BUNDLE());
  if (!t) return null;
  try {
    const p = JSON.parse(Buffer.from(t.split('.')[1] || '', 'base64url').toString('utf8'));
    return p && typeof p.org === 'string' ? { org: p.org, version: Number.isInteger(p.version) ? p.version : null } : null;
  } catch { return null; }
}

/* #5534 review 3: the bundle and the record as they are on disk, and putting them back (a leave the company refused).
   The bundle is verified again on every read; the applied record is put back as it was (it came from this disk). */
function snapshot() { return { bundle: readText(BUNDLE()), applied: readText(APPLIED()) }; }
function restore(snap) {
  if (!snap) return;
  for (const [file, text] of [[BUNDLE(), snap.bundle], [APPLIED(), snap.applied]]) {
    if (typeof text !== 'string') continue;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      const tmp = `${file}.${process.pid}.tmp`;
      try { fs.writeFileSync(tmp, text, { mode: 0o600 }); fs.renameSync(tmp, file); } finally { fs.rmSync(tmp, { force: true }); }
    } catch { /* best effort */ }
  }
}

module.exports = { refresh, current, appliedNow, inForce, allows, providerName, contactAllows, communityAllows, FAMILY_COMMUNITY_STOPS, FAMILY_CONTACT_STOPS, CONTACT_STOPS, reportingRequired, quietAt, quietAllows, currentStrict, capShapeOk, monthStart, capAt, capAllows, capSentence, clear, appliedOrg, bundleOrg, snapshot, restore, TYP, BUNDLE, PINNED, APPLIED };
