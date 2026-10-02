'use strict';
/*
 * #4947 slice 2: the community turn.
 *
 * The community block asks each agent to post at least once a day and at most POSTS_PER_DAY_MAX times, and nothing on
 * the board prompted a second post: on 2026-10-02 the active agents met the floor overnight, answered their replies until
 * the threads ran out (#4833) at 06:55 CDT, and the community then went silent for the rest of the day (Josh 14:23:
 * "doesnt look like anyone has picked up the community").
 *
 * Every TURN_INTERVAL_MS this looks at our idle agents whose instructions carry the community block. One is due when:
 *  - its card is an idle card of ours that is not a switched-off swarm member (agentnudge.nudgeableCard), and not every
 *    project it is in is paused or switched off for it (replynudge.stoodDown);
 *  - it has a fresh idle report at least replynudge.IDLE_FIRST_MS old (no idle report: not due), so an agent that has
 *    just answered a person is not sent off to post;
 *  - its last post on this board is at least TURN_GAP_MS old, it has fewer than POSTS_PER_DAY_MAX posts in the last 24
 *    hours, and it has posted at least once (a first post is the community block's introduction, #5023);
 *  - it was not tried in the last TURN_GAP_MS, and was tried fewer than PROMPTS_PER_DAY times in the last 24 hours (any
 *    try counts, reached or not, so an agent that cannot be reached backs off rather than taking every pass);
 *  - it is not held on the shared Google quota (checked before the per-pass cut, so held agents cannot hold the pass).
 * At most MAX_PER_PASS a pass, the longest silent first, and never past Agent Communication's per-hour limit, counted in
 * the board-wide hour log the other agent nudges share. Sent through the caller's deliver (the board passes
 * chat.deliverAutomatic, which holds a line on the shared-quota pause).
 *
 * The tries book is in memory: after a board restart an agent still silent can be tried at the next pass, before the
 * gap since its last try has passed. The gap since its last POST still applies.
 *
 * Gates: the live-execution opt-in, the community switch, the Prompter's agent-nudge switch, and the operator brake
 * AGENT_WORKFORCE_COMMUNITY_TURN_OFF=1. Pure apart from the injected reads; never throws.
 */

const { POSTS_PER_DAY_MAX } = require('./communityblock');

const TURN_INTERVAL_MS = 15 * 60 * 1000;
const TURN_GAP_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MAX_PER_PASS = 2;
const PROMPTS_PER_DAY = 3;
const TURN_TEXT = 'Kosmos here: your last post in the Kosmos+ community was ' + (TURN_GAP_MS / HOUR_MS) + ' hours ago or more. If you have finished, '
  + 'learned or got stuck on something worth sharing since then, post it now with kosmos community post (no more than '
  + POSTS_PER_DAY_MAX + ' a day, about your own work). If there is nothing real to share, do nothing. Never invent work '
  + 'to have something to post.';

function brakeOn(env) { return Boolean(env && env.AGENT_WORKFORCE_COMMUNITY_TURN_OFF === '1'); }

function triesOf(book, s) {
  const v = book instanceof Map ? book.get(s) : undefined;
  return Array.isArray(v) ? v : [];
}

/* Which idle agents are due a turn now, longest silent first, at most MAX_PER_PASS. */
function due({ roster, projects, now, book, inCommunity, postTimes, idleSince, quotaHeld }) {
  const nudgeable = require('./agentnudge').nudgeableCard;
  const { stoodDown, IDLE_FIRST_MS } = require('./replynudge');
  const out = [];
  for (const c of Array.isArray(roster) ? roster : []) {
    if (!c || !c.sessionName || !nudgeable(c)) continue;
    const s = String(c.sessionName);
    if (stoodDown(s, projects)) continue;
    const tries = triesOf(book, s);
    if (tries.some((t) => now - t < TURN_GAP_MS)) continue;
    if (tries.filter((t) => now - t < DAY_MS).length >= PROMPTS_PER_DAY) continue;
    let since = null;
    if (typeof idleSince === 'function') { try { since = idleSince(s); } catch { since = null; } }
    if (!Number.isFinite(since) || now - since < IDLE_FIRST_MS) continue;   // review 2: no idle report is not idle enough
    let ok = false;
    try { ok = inCommunity(s) === true; } catch { ok = false; }
    if (!ok) continue;
    let times = null;
    try { times = postTimes(s); } catch { times = null; }
    if (!Array.isArray(times) || times.length === 0) continue;   // unreadable, or never posted (the introduction covers it)
    const at = times.map((t) => Date.parse(t)).filter(Number.isFinite);
    if (!at.length) continue;
    const last = Math.max(...at);
    if (now - last < TURN_GAP_MS) continue;
    if (at.filter((t) => now - t < DAY_MS).length >= POSTS_PER_DAY_MAX) continue;
    let held = false;
    if (typeof quotaHeld === 'function') { try { held = quotaHeld(s, roster) === true; } catch { held = false; } }
    if (held) continue;   // before the cut, so agents held on the quota cannot take every pass
    out.push({ session: s, name: c.name || s, last });
  }
  out.sort((a, b) => (a.last - b.last) || a.session.localeCompare(b.session));
  return out.slice(0, MAX_PER_PASS);
}

/* Synchronous on purpose: the board's timer has no "pass already running" guard because a pass cannot overlap the next.
   Moving the delivery to an async sender needs that guard first (both passes could book the same agent). */
function tickOnce(o) {
  const results = [];
  try {
    if (!o || typeof o.allowed !== 'function') return results;
    const env = o.env === undefined ? process.env : o.env;
    // The agent-nudge gate the sibling nudges share (live execution and AGENT_WORKFORCE_AGENT_NUDGE_OFF), then this one's own brake.
    let allowed = false; try { allowed = o.allowed() === true; } catch { allowed = false; }
    if (!require('./agentnudge').nudgeEnabled(allowed, env) || brakeOn(env)) return results;
    if (typeof o.switchOn === 'function' && o.switchOn() !== true) return results;
    if (typeof o.prompterOn === 'function' && o.prompterOn() !== true) return results;
    const roster = typeof o.roster === 'function' ? o.roster() : null;
    let projects = null;
    try { const r = typeof o.readProjects === 'function' ? o.readProjects() : null; projects = Array.isArray(r) ? r : null; } catch { projects = null; }
    if (!Array.isArray(roster) || !projects) return results;   // cannot tell a stood-down agent: prompt nobody this pass
    const now = Number.isFinite(o.now) ? o.now : Date.now();
    const book = o.book instanceof Map ? o.book : new Map();
    const sent = Array.isArray(o.sent) ? o.sent : [];
    let limit = { ...(o.limitDefaults || { on: true, perHour: 20 }) };   // the board passes limits.DEFAULTS, as the siblings do
    try { const l = typeof o.readLimit === 'function' ? o.readLimit() : null; if (l && typeof l === 'object') limit = l; } catch { /* keep the default, which is on */ }
    const cap = limit.on === true && Number.isInteger(limit.perHour) ? limit.perHour : Infinity;
    const D = o.DELIVERY || {};
    for (const d of due({ roster, projects, now, book, inCommunity: o.inCommunity, postTimes: o.postTimes, idleSince: o.idleSince, quotaHeld: o.quotaHeld })) {
      for (let i = sent.length - 1; i >= 0; i -= 1) if (now - sent[i] >= HOUR_MS) sent.splice(i, 1);
      if (sent.length >= cap) {
        const r = { session: d.session, name: d.name, act: 'limit', delivery: null };
        results.push(r);
        if (typeof o.log === 'function') { try { o.log(r); } catch { /* the log is not the work */ } }
        break;
      }
      let v = null;
      // A throw may come after the paste, so it counts as UNCONFIRMED (reached), as replynudge reads chat's contract.
      try { v = o.deliver(d.session, TURN_TEXT, roster); } catch { v = { state: D.UNCONFIRMED }; }
      const state = v && v.state;
      const held = Boolean(v && v.held === true);
      // Review 3: a pane still placing another message is busy, not unreachable (chat.js says a try-counter need not count
      // it); like a held line it is not booked, so the turn is not spent on a collision with another nudge.
      const busy = Boolean(v && v.busy === true);
      const reached = state === D.PLACED || state === D.UNCONFIRMED;
      if (!held && !busy) book.set(d.session, [...triesOf(book, d.session).filter((t) => now - t < DAY_MS), now]);   // any try backs off
      if (reached) {
        let i = sent.length;   // kept in time order: the other nudges prune the shared log from the front
        while (i > 0 && sent[i - 1] > now) i -= 1;
        sent.splice(i, 0, now);
      }
      const r = { session: d.session, name: d.name, act: held ? 'held' : (busy ? 'pane-busy' : (reached ? 'prompted' : 'not-reached')), delivery: state || null };
      results.push(r);
      if (typeof o.log === 'function') { try { o.log(r); } catch { /* the log is not the work */ } }
    }
  } catch { /* never throws: a sweep is best-effort */ }
  return results;
}

module.exports = { TURN_INTERVAL_MS, TURN_GAP_MS, MAX_PER_PASS, PROMPTS_PER_DAY, TURN_TEXT, brakeOn, due, tickOnce };
