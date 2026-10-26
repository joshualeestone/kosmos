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
 *   API key, not at a limit), MEASURED (a current weekly reading), under TARGET_MAX_PCT, and not the same account.
 *   The lowest usage wins; ties go to the earlier reset, then the folder, so the answer is stable from one read to
 *   the next.
 * - MOVABLE: an agent on an at-risk account that is idle, with no commitment and no open task part (the caller
 *   decides that with the Assigner's own tests and passes the answer in).
 * An account that is NOT MEASURED is never a target: a working login is not headroom (the card's 10-24 incident).
 */

const AT_RISK_PCT = 90;
const TARGET_MAX_PCT = 70;
const RESET_SOON_MS = 6 * 60 * 60 * 1000;

/* A weekly reading that is current: a number, with a reset still ahead. */
function weeklyNow(row, nowMs) {
  const w = row && row.weekly;
  return !!w && Number.isFinite(w.usedPct) && Number.isFinite(w.resetsAt) && w.resetsAt > nowMs ? w : null;
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
  return `it is at ${Math.round(w.usedPct)}% of its weekly limit, which resets in ${Math.round((w.resetsAt - nowMs) / 3600000)} h`;
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
    && weeklyNow(r, nowMs) && weeklyNow(r, nowMs).usedPct < TARGET_MAX_PCT);
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
 * why }], short: [dir] }: `held` names an at-risk account with movable agents but no target, so the page can say
 * nothing could take them; `short` names an at-risk account whose list of agents may be incomplete (review 1), so the
 * page does not read "nothing to move" as the whole truth.
 */
function decide({ rows, movable, nowMs }) {
  const all = Array.isArray(rows) ? rows.filter((r) => r && r.provider === 'anthropic' && r.dir) : [];
  const moves = [];
  const held = [];
  const short = [];
  if (eligible(all).length < 2) return { moves, held, short };
  for (const from of all) {
    const why = riskOf(from, nowMs);
    if (!why) continue;
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
  return { moves, held, short };
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
   archived ones included). `cards`: the board roster; `records`: every project; `readCommitment(session)`. An agent
   that is not on the roster, or whose record cannot be read, is not movable. */
function movableFor({ cards, records, readCommitment, assigner = require('./assigner') }) {
  const bySession = new Map((Array.isArray(cards) ? cards : []).filter((c) => c && c.sessionName).map((c) => [c.sessionName, c]));
  return (session) => {
    const c = bySession.get(session);
    if (!c || !assigner.idleCard(c)) return false;
    if (c.isGuide === true) return false;   // review 2: the page's bulk move never moves a guide, so neither would this
    let rec = null;
    try { rec = readCommitment(session); } catch { rec = null; }
    return assigner.commitmentsFree(rec) && !assigner.hasOpenWork(session, Array.isArray(records) ? records : []);
  };
}

module.exports = { decide, movableFor, markTargets, bulkTargetable, eligible, AT_RISK_PCT, TARGET_MAX_PCT, RESET_SOON_MS };
