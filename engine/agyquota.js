'use strict';

/*
 * #4588: resume Antigravity (agy) agents after their Google account's shared quota resets.
 *
 * Agy agents signed in to the same Google account share one quota (agy keeps one sign-in per machine today, so on
 * one computer that is usually all of them; not measured across worlds). When it runs out, agy ends the turn with RESOURCE_EXHAUSTED ... "Resets in 24m54s", and
 * bin/agy-report-bridge.js reports an automatic idle whose `until` is that reset as an ISO time (status.js reads it
 * as Paused until then; see quotaPauseUntil). This sweep types one carry-on line into each such agent after its
 * reset has passed, the connlost-heal pattern (#3410): a nudge keeps the agent's in-flight context, a restart
 * would lose it.
 *
 * ONE AT A TIME: at most one agent per sweep, and at least STAGGER_MS after the last one, so agents on one account
 * do not all hit the refreshed quota in the same second and use it up together (the card's second complaint).
 * Oldest reset first. At most MAX_TRIES tries per agent per pause; a pause is one `until`, so an agent that hits
 * the quota again after resuming starts a new one.
 *
 * The planner is pure and the delivery is injected, so tests drive both without touching a real agent. Nothing
 * here runs by itself: server.js calls the tick behind the live-execution gate and the operator brake
 * AGENT_WORKFORCE_AGY_QUOTA_RESUME_OFF=1.
 */

const GRACE_MS = 30 * 1000;
/* A little under the server's 60 s tick, so jitter between ticks cannot turn one minute's spacing into two (review 1). */
const STAGGER_MS = 55 * 1000;
/* A reset older than this is left alone: the book lives in memory, so without it every board restart would type the
   carry-on line again into an agent whose last report is still an old quota stop (review 1). The one constant the card's
   wording also uses (status.js QUOTA_RESUME_WINDOW_MS, review 3). */
const status = require('./status');
const MAX_AGE_MS = status.QUOTA_RESUME_WINDOW_MS;
const MAX_TRIES = 3;
const NUDGE_TEXT = 'The Google quota for this account has reset. Please carry on with what you were doing.';
/* The stagger stamp, kept in the same book under a key no session name can equal (review 2). */
const LAST = Symbol('lastNudgeAt');

/* The reset an agent is paused until, from its latest report, in epoch ms; null when it is not paused on the quota.
   status.js's own reading, not a copy of it (review 3). */
function pausedUntil(report) {
  return status.quotaResetOf(report);
}
/* #4588 PR B: Antigravity sign-in is machine-wide, so every antigravity agent here draws on one Google account's quota.
   A reset more than MAX_POOL_MS ahead is not believed: Google's longest window is a week. */
const MAX_POOL_MS = 8 * 24 * 3600 * 1000;
/* Each antigravity agent's last-seen reset, by session. A card stops carrying quotaUntil once its reset passes, and can
   stop showing its pause before then (its screen changed), while the pool is still empty; so the board remembers.
   A card that shows a new reset corrects only its own entry; an entry is dropped 2 * MAX_AGE_MS after its reset.
   `seen` is when each pause was first seen. Nothing
   releases it early: a card reading working is no proof the pool refilled (a resumed agent, an in-flight turn), so a
   hold lasts to its recorded reset, bounded by MAX_POOL_MS.
   In memory only: a board restart forgets it, and the release after that one reset is then lost. */
const POOL_MEMO = { bySession: new Map(), seen: new Map() };
function newPoolMemo() { return { bySession: new Map(), seen: new Map() }; }
/* One release step: the resume timer's period (60 s) or its stagger, whichever is longer. */
const SLOT_MS = Math.max(STAGGER_MS, 60 * 1000);
/* Our antigravity panes: a pane on this machine that is not ours (isNamedOurs false) is not in our pool or order. */
const isOurAgy = (c) => Boolean(c && c.runner === 'antigravity' && c.isNamedOurs !== false);
function agyNames(roster) {
  return (Array.isArray(roster) ? roster : []).filter((c) => isOurAgy(c) && c.sessionName)
    .map((c) => String(c.sessionName)).sort();
}
/* After the pool's reset R, agent i (by session name) is released at R + GRACE_MS + (i + 1) * SLOT_MS: one agent per step,
   so the held timers do not all fire in the minute the pool refills. This does not wait on the resume sweep below; the
   two may reach different agents in the same minute, into a pool that has refilled (decided, review 5). */
function releaseAfterMs(card, roster) {
  const names = agyNames(roster);
  const i = names.indexOf(String(card.sessionName));
  return GRACE_MS + SLOT_MS * ((i === -1 ? names.length : i) + 1);
}
/* Records what the cards show now and returns the pool's reset (the latest remembered), or null when none is pending. */
function notePool(roster, now, memo = POOL_MEMO) {
  const cards = Array.isArray(roster) ? roster : [];
  const cap = now + MAX_POOL_MS;
  for (const c of cards) {
    if (!isOurAgy(c) || !c.sessionName || typeof c.quotaUntil !== 'string') continue;
    const at = Date.parse(c.quotaUntil);
    if (Number.isFinite(at) && at > now && at <= cap) {
      const k = String(c.sessionName);
      const prev = memo.bySession.get(k);
      // When this pause was first seen: a correction of a reset still ahead keeps it; a new pause after the old reset,
      // or the first one, starts it now.
      if (prev === undefined || prev <= now || !memo.seen.has(k)) memo.seen.set(k, now);
      memo.bySession.set(k, at);
    }
  }
  // Kept past every release (MAX_AGE_MS covers any sane number of agents at one SLOT_MS each) and through the resume's
  // six hours (see heldBackBy); a constant, so the horizon does not depend on which caller's roster prunes.
  const keep = 2 * MAX_AGE_MS;
  let reset = null;
  for (const [k, at] of memo.bySession) {
    if (now >= at + keep) { memo.bySession.delete(k); memo.seen.delete(k); continue; }
    if (reset === null || at > reset) reset = at;
  }
  return reset;
}
/* The quota-hold brake (#4588 PR B reviews 4 and 5): AGENT_WORKFORCE_AGY_QUOTA_HOLD_OFF=1. One rule, read by heldForQuota
   and by the resume sweep's pool gate (sweepOnce), so the two cannot drift. Only "1" is the brake. */
function quotaHoldOff(env) {
  return Boolean(env && env.AGENT_WORKFORCE_AGY_QUOTA_HOLD_OFF === '1');
}
/* When an automatic line to `session` may be typed, in epoch ms, or null for now. Only an antigravity card is held: while
   the pool is paused, then until its own step after the reset (releaseAfterMs). The card is found by chat's own rule
   (resolveCard), so the gate and the delivery always mean the same card.
   Brake (quotaHoldOff): holds nothing, for every heldForQuota caller at once (deliverAutomatic(Async) and every timer
   and room post sent through it, the assigner, the recommender, and server.js's own checks), AND lifts the resume
   sweep's pool gate (sweepOnce), so PR A's per-agent resume timing is back. A misread reset up to MAX_POOL_MS ahead
   would otherwise hold them all with no way out but the wait; the card still shows the pause either way. It restores
   only resumes still inside their own six hours (heldBackBy is not applied under it), not ones that already aged out. */
function heldForQuota(session, roster, now, memo = POOL_MEMO, env = process.env) {
  if (quotaHoldOff(env)) return null;
  let card = null;
  try { card = require('./chat').resolveCard(roster, session); } catch { card = null; }
  if (!isOurAgy(card)) return null;
  const reset = notePool(roster, now, memo);
  if (reset === null) return null;
  if (now < reset) return reset;
  const releaseAt = reset + releaseAfterMs(card, roster);
  return now < releaseAt ? releaseAt : null;
}

/* #4588 ask 3: the cap (Settings > Automation, engine/agycap-setting.js). While `max` of our antigravity agents are
   working, an automatic line to ANOTHER one waits, so a team does not run more of them at once than the person chose.
   Returns when to look again (now + CAP_RECHECK_MS), or null. A line to an agent that is already working is not held:
   it is already counted (the line still reserves it, see noteCapStart). No limit (0, the default), the quota-hold brake, or a setting that cannot
   be read holds nothing. A person's own message never comes here (chat.deliver is not gated). */
const CAP_RECHECK_MS = 60 * 1000;
/* Review 1 (a blocker): a card reads `working` only once the agent's next report lands, so a fan-out from one roster
   (a room post to six idle agents, the assigner's loop, a held-post flush) saw nobody working and let them all
   through. So an automatic line about to be typed RESERVES its agent here, at the gate, before the keystroke (a
   parallel fan-out sees the reservation), and it counts as working for CAP_START_MS (it is not ended early when the
   agent finishes sooner: with a cap of 1 that is at most one automatic start every CAP_START_MS), and as long as its
   card says working after that. A delivery that reached nothing gives it back (releaseCapStart). Nothing is reserved
   while the cap is off. In memory only: a board restart forgets them, and the cards take over within a report. */
const CAP_START_MS = 3 * 60 * 1000;
const CAP_STARTS = new Map();   // session name -> when its automatic line was let through
function startedRecently(name, now) {
  const at = CAP_STARTS.get(name);
  if (at === undefined) return false;
  /* Review 7: a reservation dated AFTER `now` is still active. A sweep reads `now` once and delivers agent after agent,
     each reserving at a fresh clock, so a later check with the tick's `now` must still see the earlier reservations.
     Only one implausibly far ahead (past a whole window) is dropped. */
  if (now - at >= CAP_START_MS || at > now + CAP_START_MS) { CAP_STARTS.delete(name); return false; }
  return true;
}
function busyAgy(c, now) {
  return isOurAgy(c) && c.sessionName && (c.state === 'working' || startedRecently(String(c.sessionName), now));
}
/* Counts what the cards say: an agent in a long tool run whose `working` report has decayed reads unknown and stops
   counting, so the cap can undercount then (the permissive side). */
function heldForCap(session, roster, now, readCap = () => require('./agycap-setting').read(), env = process.env) {
  if (quotaHoldOff(env)) return null;
  let card = null;
  try { card = require('./chat').resolveCard(roster, session); } catch { card = null; }
  if (!isOurAgy(card) || busyAgy(card, now)) return null;   // review 13: before the setting is read, so other runners skip the disk
  let max = 0;
  try { max = Number(readCap().maxWorking) || 0; } catch { max = 0; }
  if (max <= 0) return null;
  const self = String(card.sessionName);
  const busy = (Array.isArray(roster) ? roster : [])
    .filter((c) => c && String(c.sessionName) !== self && busyAgy(c, now)).length;
  return busy >= max ? now + CAP_RECHECK_MS : null;
}
/* Reserve `session`'s slot for an automatic line about to be typed (only our antigravity agents). Returns a token for
   releaseCapStart, or null. */
function noteCapStart(session, roster, now, readCap = () => require('./agycap-setting').read(), env = process.env) {
  if (quotaHoldOff(env)) return null;   // the brake lifts the cap, so nothing is reserved under it either
  let max = 0;
  try { max = Number(readCap().maxWorking) || 0; } catch { max = 0; }
  if (max <= 0) return null;
  let card = null;
  try { card = require('./chat').resolveCard(roster, session); } catch { card = null; }
  if (!isOurAgy(card)) return null;
  const name = String(card.sessionName);
  /* Review 3: an active reservation is left alone. Refreshing it let an idle agent that keeps receiving lines hold the
     slot for good, and a later line's failure would release the first one, which did reach the agent. */
  if (startedRecently(name, now)) return null;
  // Review 10: lapsed entries for other names (a renamed or removed session) are pruned here, so the map stays small.
  for (const k of [...CAP_STARTS.keys()]) startedRecently(k, now);
  CAP_STARTS.set(name, now);
  return { name, at: now };
}
function releaseCapStart(token) {
  if (token && CAP_STARTS.get(token.name) === token.at) CAP_STARTS.delete(token.name);
}
/* Every automatic sender's one question, "may this agent be sent automatic work now?": the shared quota first, then the
   person's cap. When to look again, or null. */
function heldForAgy(session, roster, now, memo = POOL_MEMO, env = process.env, readCap = undefined) {
  const q = heldForQuota(session, roster, now, memo, env);
  return q !== null ? q : heldForCap(session, roster, now, readCap, env);
}

/* The card states a nudge may be typed over: never a question (a typed line could answer it), work, or a lost
   connection, which the board's screen reading ranks above the quota report (review 3). */
const NUDGE_OVER = Object.freeze(['idle', 'unknown', 'rate_limited']);

/* The pool reset that held back an agent whose own reset was `own`: the latest remembered one after it whose pause was
   first seen while the agent's own six hours were still open. A pause that began after that window had closed did not
   hold this agent back, so it does not reopen a stop PR A leaves alone. Null when none. */
function heldBackBy(own, memo = POOL_MEMO) {
  if (!Number.isFinite(own)) return null;
  let until = null;
  for (const [k, at] of memo.bySession) {
    const seen = memo.seen.get(k);
    if (at > own && Number.isFinite(seen) && seen <= own + MAX_AGE_MS && (until === null || at > until)) until = at;
  }
  return until;
}

/* One agent: { act: 'none' | 'wait' | 'nudge', because }. entry is its book entry for this pause, or undefined. */
function plan(report, entry, now, heldBackUntil) {
  const at = pausedUntil(report);
  if (at === null) return { act: 'none', because: 'not paused on the quota' };
  if (entry && entry.until === report.until) {
    if (entry.nudgedAt != null) return { act: 'none', because: 'already resumed once for this reset' };
    if ((entry.tries || 0) >= MAX_TRIES) return { act: 'none', because: 'gave up after ' + MAX_TRIES + ' tries that reached nothing' };
    /* A refusal backs off, STAGGER_MS per try so far, so a short-lived one (another message still being placed) cannot
       spend the whole budget on consecutive ticks (review 3). */
    if (Number.isFinite(entry.lastTryAt) && now - entry.lastTryAt < STAGGER_MS * (entry.tries || 1)) {
      return { act: 'wait', because: 'the last try reached nothing; backing off' };
    }
  }
  if (now < at + GRACE_MS) return { act: 'wait', because: 'its quota resets at ' + new Date(at).toISOString() };
  /* #4588 PR B: an agent held back by a later reset elsewhere in the pool (heldBackUntil, see heldBackBy) counts its six
     hours from that reset, so it is still resumed once the pool opens. */
  const since = Number.isFinite(heldBackUntil) && heldBackUntil > at ? heldBackUntil : at;
  if (now > since + MAX_AGE_MS) return { act: 'none', because: 'its quota reset more than six hours ago; left alone' };
  return { act: 'nudge', because: 'its quota reset at ' + new Date(at).toISOString() };
}

/*
 * One sweep. o = { roster, book (Map), now, memo (the pool memory; POOL_MEMO by default), env (process.env by default),
 * readReport (session) => selfreport.read shape, deliver (session, text, roster) => result, DELIVERY, log }. Nudges at
 * most one agent. Returns { results }. Never throws.
 */
function sweepOnce(o) {
  const results = [];
  try {
    if (!o || !Array.isArray(o.roster)) return { results, skipped: 'roster unreadable' };
    const book = o.book instanceof Map ? o.book : new Map();
    const now = Number.isFinite(o.now) ? o.now : Date.now();
    const read = typeof o.readReport === 'function' ? o.readReport : (s) => require('./selfreport').read(s);
    const log = typeof o.log === 'function' ? o.log : null;
    /* #4588 PR B: one pool. While any antigravity card is still inside its pause, a resume into another one would spend
       a turn against the same empty pool, so nobody is resumed until the latest reset has passed. */
    /* Under the quota-hold brake (quotaHoldOff) the pool gate is lifted: each agent is resumed on its own reset, PR A's
       timing, so a misread pool reset cannot stop every resume (review 5). The memory is still kept current. */
    const holdOff = quotaHoldOff(o.env === undefined ? process.env : o.env);
    const poolReset = notePool(o.roster, now, o.memo || POOL_MEMO);
    if (!holdOff && poolReset !== null && now < poolReset) return { results, skipped: 'the shared pool is still paused' };
    // An agent whose own reset came earlier still waits the grace after the POOL refills.
    if (!holdOff && poolReset !== null && now < poolReset + GRACE_MS) return { results, skipped: 'the shared pool has just refilled' };
    const last = book.get(LAST);
    if (Number.isFinite(last) && now - last < STAGGER_MS) return { results, skipped: 'spacing resumes out' };
    const due = [];
    for (const card of o.roster) {
      const session = card && card.sessionName;
      if (!session || card.runner !== 'antigravity') continue;
      if (!NUDGE_OVER.includes(card.state)) continue;
      let report = null;
      try { report = read(session); } catch { report = null; }
      const entry = book.get(session);
      const p = plan(report, entry, now, holdOff ? null : heldBackBy(pausedUntil(report), o.memo || POOL_MEMO));
      if (p.act === 'nudge') due.push({ card, session, report, entry, because: p.because, at: pausedUntil(report) });
    }
    if (!due.length) return { results };
    due.sort((a, b) => (a.at - b.at) || String(a.session).localeCompare(String(b.session)));
    const d = due[0];
    /* #4588 ask 3 (review 1): the person's cap applies to resumes too. At the cap, nobody is resumed this tick and no
       try is spent; the next tick looks again. Stopping at the first due agent is safe because the cap is one count for
       every agent here (a due agent is never one already counted busy); a per-agent cap would need to look further. */
    if (heldForCap(d.session, o.roster, now, o.readCap, o.env === undefined ? process.env : o.env) !== null) {
      return { results, skipped: 'the Gemini agents are at the limit set for working at once' };
    }
    let state = null;
    try { const r = o.deliver(d.session, NUDGE_TEXT, o.roster); state = r && r.state; }
    catch (err) { state = 'threw: ' + String((err && err.message) || err); }
    const D = o.DELIVERY || {};
    const delivered = D.PLACED != null && state === D.PLACED;
    const mayHaveReached = delivered || (D.UNCONFIRMED != null && state === D.UNCONFIRMED);
    const tries = (d.entry && d.entry.until === d.report.until && Number.isInteger(d.entry.tries) ? d.entry.tries : 0) + 1;
    book.set(d.session, { until: d.report.until, nudgedAt: mayHaveReached ? now : null, tries, lastTryAt: now, delivery: state });
    // Only a line that may have reached the pane spaces the next agent out: a refusal reached nobody (review 2).
    if (mayHaveReached) { book.set(LAST, now); noteCapStart(d.session, o.roster, now, o.readCap, o.env === undefined ? process.env : o.env); }
    const gaveUp = !mayHaveReached && tries >= MAX_TRIES;
    const r = { session: d.session, name: d.card.name || d.session, act: gaveUp ? 'gave-up' : 'nudge', delivered, delivery: state,
      because: gaveUp ? d.because + '; nothing reached the pane in ' + tries + ' tries, so it is left idle with its turn unfinished until someone messages it' : d.because, waiting: due.length - 1 };
    results.push(r);
    if (log) { try { log(r); } catch { /* never breaks a sweep */ } }
  } catch { /* never throws: a sweep is best-effort */ }
  return { results };
}

/* The one "does the resume run" rule: live execution allowed and the operator brake off. */
function resumeEnabled(allowed, env) {
  return allowed === true && (env || process.env).AGENT_WORKFORCE_AGY_QUOTA_RESUME_OFF !== '1';
}

/* The server's per-tick wrapper. deps = { allowed, env (process.env by default; also reaches the pool gate), roster, readReport?, deliver, DELIVERY, log, book, now? }. */
function makeTick(deps) {
  return function tick() {
    try {
      if (!resumeEnabled(deps.allowed() === true, deps.env)) return null;
      const roster = deps.roster();
      if (!Array.isArray(roster)) return null;
      return sweepOnce({ roster, book: deps.book, now: deps.now ? deps.now() : Date.now(), env: deps.env || process.env, readReport: deps.readReport, deliver: deps.deliver, DELIVERY: deps.DELIVERY, log: deps.log });
    } catch { return null; }
  };
}

module.exports = { CAP_RECHECK_MS, CAP_START_MS, CAP_STARTS, noteCapStart, releaseCapStart, heldForCap, heldForAgy, GRACE_MS, STAGGER_MS, MAX_AGE_MS, MAX_TRIES, NUDGE_OVER, NUDGE_TEXT, pausedUntil, notePool, heldBackBy, releaseAfterMs, SLOT_MS, heldForQuota, quotaHoldOff, POOL_MEMO, newPoolMemo, MAX_POOL_MS, plan, sweepOnce, resumeEnabled, makeTick };
