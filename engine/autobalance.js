'use strict';
/**
 * kosmos#7152 slice 2: which agents WOULD move off a Claude account that is running out, and where to. Nothing here
 * moves anything (slice 3 does, through engine/accountmove.js); this is the decision, so a person can read it first.
 *
 * PURE: no file, no network, no clock but `nowMs`. The caller (GET /api/accounts) hands it the rows it already builds
 * and the agents' idle state, so the page, this decision and slice 3's sweep read one rule.
 *
 * THE RULE (the card, slice 2):
 * - AT RISK: weekly usage at or above AT_RISK_PCT that does not reset within RESET_SOON_MS, or a login that has stopped
 *   working (a real call was rejected, or it is signed out).
 * - TARGET: an account a whole set of agents may be moved to at all (bulkTargetable: shared memory, offerable, not an
 *   API key, not at a limit), positively SIGNED IN (signedIn), MEASURED (a current weekly reading), under
 *   TARGET_MAX_PCT, and not the same account.
 *   The lowest usage wins; ties go to the earlier reset, then the folder, so the answer is stable from one read to
 *   the next.
 * - MOVABLE: an agent on an at-risk account that is idle, with no commitment and no open task part (the caller
 *   decides that with the Assigner's own tests and passes the answer in).
 * An account that is NOT MEASURED is never a target: a working login is not headroom (the card's 10-24 incident).
 */

const AT_RISK_PCT = 90;
const TARGET_MAX_PCT = 70;
const RESET_SOON_MS = 6 * 60 * 60 * 1000;
/* Slice 3 (slice 2's review 11): a target this far into its five-hour window would stall the agents sent there for hours. */
const FIVE_HOUR_MAX_PCT = 90;

/* A weekly reading that is current: a number, with a reset still ahead. */
function weeklyNow(row, nowMs) {
  const w = row && row.weekly;
  return !!w && Number.isFinite(w.usedPct) && Number.isFinite(w.resetsAt) && w.resetsAt > nowMs ? w : null;
}

/* A five-hour reading that is current: a number, with its reset still ahead. */
function fiveHourNow(row, nowMs) {
  const f = row && row.fiveHour;
  return !!f && Number.isFinite(f.usedPct) && Number.isFinite(f.resetsAt) && f.resetsAt > nowMs ? f : null;
}

/* The login has stopped working: the live check's own two confirmed states. */
function loginStopped(row) {
  const badge = row && row.connection && row.connection.badge;
  return badge === 'rejected' || badge === 'signed_out';
}

/* The page's acctOfferableTarget, as it was: only the CONFIRMED-unusable are out (rejected, signed out); a row with no
   connection is offered; a badge-less row falls back to the older state. */
function offerable(row) {
  const c = row && row.connection;
  if (!c) return true;
  if (c.badge) return c.badge !== 'rejected' && c.badge !== 'signed_out';
  return c.state !== 'none';
}

/* Whether a whole set of agents may be moved onto this row at all, whoever asks (the page's bulk move or this
   decision): the row-only half of the page's old acctBulkTarget, moved here so the two cannot disagree. One test is
   added: a row that says it is not offerable (OpenAI rows carry the field; Claude rows do not today). The "not the
   account they are on" half needs the source and stays with the caller. */
function bulkTargetable(row, nowMs) {
  if (!row || row.provider !== 'anthropic' || !row.dir || !row.memoryShared || row.apiKey) return false;
  if (row.offerable === false || !offerable(row)) return false;
  /* The page's acctWeeklyNow: a reading counts unless its reset has passed (one with no reset time still counts). */
  const w = row.weekly && Number.isFinite(row.weekly.usedPct) && !(Number.isFinite(row.weekly.resetsAt) && row.weekly.resetsAt <= nowMs) ? row.weekly : null;
  if (w && Math.round(w.usedPct) >= 100) return false;   // a full account cannot run them (rounded as its row shows it)
  const f = row.fiveHour;
  if (f && Number.isFinite(f.usedPct) && Math.round(f.usedPct) >= 100 && !(Number.isFinite(f.resetsAt) && f.resetsAt <= nowMs)) return false;
  return true;
}

/* Why this account is at risk, in words for the page, or null when it is not. */
function riskOf(row, nowMs) {
  if (!row || row.provider !== 'anthropic' || row.apiKey) return null;
  if (loginStopped(row)) return 'its login has stopped working';
  const w = weeklyNow(row, nowMs);
  if (!w || w.usedPct < AT_RISK_PCT || w.resetsAt - nowMs <= RESET_SOON_MS) return null;
  /* Review 7: hours rounded UP, so a reset just past 6 h never reads as "6 h" beside a rule that says "within 6 hours";
     past two days, in days. */
  const hours = Math.ceil((w.resetsAt - nowMs) / 3600000);
  const when = hours > 48 ? `${Math.round(hours / 24)} days` : `${hours} h`;
  return `it is at ${Math.round(w.usedPct)}% of its weekly limit, which resets in ${when}`;
}

/* Two rows are the same account when both name the same login (email and organization): one account can be signed in
   from two folders, and moving between them gains nothing. The rows carry the organization's NAME, not its id, so two
   organizations of one name read as one account: that errs toward not moving, never toward a wrong move. */
function sameAccount(a, b) {
  if (a.dir === b.dir) return true;
  const ea = typeof a.email === 'string' ? a.email.toLowerCase() : null;
  const eb = typeof b.email === 'string' ? b.email.toLowerCase() : null;
  if (!ea || !eb || ea !== eb) return false;
  return !(a.organization && b.organization && a.organization !== b.organization);
}

/* Signed in, positively: the automatic move needs more than the page's include-and-label rule, which also offers an
   account whose check has not answered (review 1: slice 3 must not move agents onto a login that just timed out). */
function signedIn(row) {
  const badge = row && row.connection && row.connection.badge;
  return badge === 'working' || badge === 'signed_in_unverified';
}

/* The best target for agents leaving `from`, or null. */
function targetFor(from, rows, nowMs) {
  const ok = rows.filter((r) => !sameAccount(r, from) && bulkTargetable(r, nowMs) && signedIn(r)
    && weeklyNow(r, nowMs) && weeklyNow(r, nowMs).usedPct < TARGET_MAX_PCT
    && !(fiveHourNow(r, nowMs) && fiveHourNow(r, nowMs).usedPct >= FIVE_HOUR_MAX_PCT));
  ok.sort((x, y) => (weeklyNow(x, nowMs).usedPct - weeklyNow(y, nowMs).usedPct)
    || (weeklyNow(x, nowMs).resetsAt - weeklyNow(y, nowMs).resetsAt)
    || (x.dir < y.dir ? -1 : x.dir > y.dir ? 1 : 0));
  return ok[0] || null;
}

/* Eligible accounts: Claude subscription accounts (not API keys), working or not: one whose login has stopped is the
   one its agents most need to leave. The setting does nothing with fewer than two. */
function eligible(rows) {
  return (Array.isArray(rows) ? rows : []).filter((r) => r && r.provider === 'anthropic' && r.dir && !r.apiKey);
}

/**
 * The decision. `rows`: the Claude account rows (/api/accounts shape: dir, provider, email, organization,
 * memoryShared, offerable, apiKey, connection.badge, weekly, fiveHour, agentsHere.names and .complete).
 * `movable(session)`: whether that agent may move now. Returns { moves: [{ agent, from, to, why }], held: [{ from,
 * why }], short: [dir], atRisk: [{ from, why, kind: 'usage' | 'login' }] }: `held` names an at-risk account with movable agents but no target,
 * so the page can say nothing could take them; `short` names an at-risk account whose list of agents may be incomplete
 * (review 1), so the page does not read "nothing to move" as the whole truth; `atRisk` names every account at risk,
 * so an at-risk account with no idle agent on it is said, not silent (review 3).
 */
function decide({ rows, movable, nowMs }) {
  const all = Array.isArray(rows) ? rows.filter((r) => r && r.provider === 'anthropic' && r.dir) : [];
  const moves = [];
  const held = [];
  const short = [];
  const atRisk = [];
  if (eligible(all).length < 2) return { moves, held, short, atRisk };
  for (const from of all) {
    const why = riskOf(from, nowMs);
    if (!why) continue;
    atRisk.push({ from: from.dir, why, kind: loginStopped(from) ? 'login' : 'usage' });   // review 9: the page words the two apart
    if (!from.agentsHere || from.agentsHere.complete !== true) short.push(from.dir);
    const names = from.agentsHere && Array.isArray(from.agentsHere.names) ? from.agentsHere.names : [];
    /* Review 2: an agent already being moved is not named again. */
    const moving = new Set(from.agentsHere && Array.isArray(from.agentsHere.moving) ? from.agentsHere.moving : []);
    const going = names.filter((n) => !moving.has(n) && typeof movable === 'function' && movable(n) === true);
    if (!going.length) continue;
    const to = targetFor(from, all, nowMs);
    if (!to) { held.push({ from: from.dir, why }); continue; }
    for (const agent of going.slice().sort()) moves.push({ agent, from: from.dir, to: to.dir, why });
  }
  return { moves, held, short, atRisk };
}

/* kosmos#7152 slice 2: put the engine's answer on every Claude row /api/accounts sends, so the page's bulk move reads
   the same rule (review 1: the route's loop is here so a test can reach it). A row the rule cannot read is not a
   target. */
function markTargets(rows, nowMs) {
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r !== 'object') continue;
    try { r.bulkTargetable = bulkTargetable(r, nowMs); } catch { r.bulkTargetable = false; }
  }
  return rows;
}

/* The card's movable test, as the Assigner decides "free": the card reads idle (assigner.idleCard), its commitments
   leave it free (assigner.commitmentsFree), and it holds no open part of a task in ANY project (assigner.hasOpenWork,
   archived ones included). `cards`: the board roster; `records`: every project, or a function that reads them (review
   3: read only when an agent is first asked about); `readCommitment(session)`. An agent that is not on the roster, or
   whose record cannot be read, is not movable.
   Slice 3 (slice 2's review 11): the guide FAILS CLOSED here. The route's walk leaves it out too (skipGuide), but that
   test reads a check that throws as "not the guide", which is wrong for a move. `isGuide(session)` throws when it
   cannot tell; `guideName()` is the name the guide was seeded under, and throws when its record cannot be read. */
function movableFor({ cards, records, readCommitment, assigner = require('./assigner'),
  isGuide = (s) => require('./setup-assistant').isGuideFolderStrict(s),
  guideName = () => require('./setup-assistant').guideNameStrict() }) {
  /* Review 3: a roster that could not be read is not an empty one: the caller says "could not work out". */
  if (!Array.isArray(cards)) throw new Error('the roster could not be read');
  const bySession = new Map(cards.filter((c) => c && c.sessionName).map((c) => [c.sessionName, c]));
  return (session) => {
    const c = bySession.get(session);
    if (!c || !assigner.idleCard(c)) return false;
    /* Review 2 (slice 3): words sitting unsent in its box are a person's or a peer's, and a restart would drop them. A
       card that cannot say is not movable. */
    try { if (c.unsentInput) return false; } catch { return false; }
    /* Not from the card: a roster card carries no isGuide (only the status rows are marked); a test pins that. */
    try {
      if (isGuide(session) !== false) return false;
      const g = guideName();
      if (typeof g === 'string' && g && g.trim().toLowerCase() === String(session).trim().toLowerCase()) return false;
    } catch { return false; }
    let rec = null;
    try { rec = readCommitment(session); } catch { rec = null; }
    const all = typeof records === 'function' ? records() : records;
    /* Review 9: the Assigner's own filter (assigner.js step), so one bad entry in the projects file is skipped rather
       than failing the whole decision. */
    const valid = (Array.isArray(all) ? all : []).filter((p) => p && typeof p.id === 'string');
    return assigner.commitmentsFree(rec) && !assigner.hasOpenWork(session, valid);
  };
}

/* Slice 3: the Claude rows a timer may build, with no live check (listLive must never run on a timer). From
   accounts.list() (`list`) and slice 1's usage record (`readUsage(dir, nowMs)`, fresh only): a fresh record whose
   state is 'ok' is a real usage call that worked for this login, so it stands for signed in; a fresh 401 or 403 (on the
   usage or the profile call) stands for a login that stopped working. Anything else says nothing (no badge: not a
   target, and not at risk by login). Review 2: that includes usagepoll's other refusals, a 429 above all (the usage
   endpoint's own rate limit, held for an hour), an answer it could not read, and a token that belongs to another
   login: none of them says the agents' login has stopped. `agentsOn(dir, isDefault)` gives { names, complete, moving }.
   The record's resets are seconds; rows carry ms, as /api/accounts does. */
const LOGIN_REFUSED = /^(profile-)?http-40[13]$/;
function rowsFromReadings({ list, readUsage, agentsOn, nowMs }) {
  const ms = (w) => (w && Number.isFinite(w.usedPct) ? { usedPct: w.usedPct, resetsAt: Number.isFinite(w.resetsAt) ? w.resetsAt * 1000 : null } : null);
  const out = [];
  for (const a of Array.isArray(list) ? list : []) {
    if (!a || typeof a.dir !== 'string' || !a.dir || a.apiKey) continue;
    let rec = null;
    try { rec = readUsage(a.dir, nowMs); } catch { rec = null; }
    const badge = rec && rec.state === 'ok' ? 'working' : (rec && LOGIN_REFUSED.test(String(rec.state)) ? 'rejected' : null);
    let here = { names: [], complete: false };
    try { here = agentsOn(a.dir, a.isDefault === true) || here; } catch { here = { names: [], complete: false }; }
    out.push({ provider: 'anthropic', dir: a.dir, label: a.label || null, isDefault: a.isDefault === true,
      email: a.email || null, organization: a.organization || null, memoryShared: a.memoryShared === true, apiKey: false,
      connection: { badge }, weekly: rec && rec.state === 'ok' ? ms(rec.weekly) : null,
      fiveHour: rec && rec.state === 'ok' ? ms(rec.fiveHour) : null, agentsHere: here});
  }
  return out;
}

/* Review 8: the movable test, built only when it is first asked (only for an at-risk account with agents on it), so
   a roster that could not be read says "could not work out" only when that matters, not on every read with nothing at
   risk. `build()` returns a movable function, or throws. */
function movableOnDemand(build) {
  let fn = null;
  return (session) => (fn || (fn = build()))(session);
}

module.exports = { decide, movableFor, movableOnDemand, markTargets, bulkTargetable, eligible, rowsFromReadings, AT_RISK_PCT, TARGET_MAX_PCT, RESET_SOON_MS, FIVE_HOUR_MAX_PCT };
