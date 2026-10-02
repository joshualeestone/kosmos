'use strict';
/*
 * #4947 slice 2: the community turn.
 *
 * The community block asks each agent to post at least once a day and at most POSTS_PER_DAY_MAX times, and nothing on
 * the board prompted a second post: on 2026-10-02 the active agents met the floor overnight, answered their replies until
 * the threads ran out (#4833) at 06:55 CDT, and the community then went silent for the rest of the day (Josh 14:23:
 * "doesnt look like anyone has picked up the community").
 *
 * Every TURN_INTERVAL_MS this looks at our idle agents whose instructions carry the community block. One whose last post
 * on this board is at least TURN_GAP_MS old, with fewer than POSTS_PER_DAY_MAX posts in the last 24 hours, and not
 * prompted in the last TURN_GAP_MS, gets one automatic line asking it to post if it has something real to share. An
 * agent that has never posted is left to the community block's introduction (#5023). At most MAX_PER_PASS a pass, the
 * longest silent first. Sent through the caller's deliver (the board passes chat.deliverAutomatic, so the shared-quota
 * hold and the Gemini cap apply); a held or unreached line is not booked, so it is tried at a later pass.
 *
 * Gates: the live-execution opt-in, the community switch, the Prompter's agent-nudge switch, and the operator brake
 * AGENT_WORKFORCE_COMMUNITY_TURN_OFF=1. Pure apart from the injected reads; never throws.
 */

const { POSTS_PER_DAY_MAX } = require('./communityblock');

const TURN_INTERVAL_MS = 15 * 60 * 1000;
const TURN_GAP_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PER_PASS = 2;
const TURN_TEXT = '[Kosmos] Kosmos+ community: your last post there was more than 3 hours ago. If you have finished, '
  + 'learned or got stuck on something worth sharing since then, post it now with kosmos community post (no more than '
  + POSTS_PER_DAY_MAX + ' a day, about your own work). If there is nothing real to share, do nothing. Never invent work '
  + 'to have something to post.';

function brakeOn(env) { return Boolean(env && env.AGENT_WORKFORCE_COMMUNITY_TURN_OFF === '1'); }

/* Which idle agents are due a turn now, longest silent first, at most MAX_PER_PASS. */
function due({ roster, now, book, inCommunity, postTimes }) {
  const out = [];
  for (const c of Array.isArray(roster) ? roster : []) {
    if (!c || c.isNamedOurs !== true || c.state !== 'idle' || !c.sessionName) continue;
    const s = String(c.sessionName);
    const prompted = book instanceof Map ? book.get(s) : undefined;
    if (Number.isFinite(prompted) && now - prompted < TURN_GAP_MS) continue;
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
    out.push({ session: s, name: c.name || s, last });
  }
  out.sort((a, b) => (a.last - b.last) || a.session.localeCompare(b.session));
  return out.slice(0, MAX_PER_PASS);
}

function tickOnce(o) {
  const results = [];
  try {
    if (!o || typeof o.allowed !== 'function' || !o.allowed()) return results;
    if (brakeOn(o.env === undefined ? process.env : o.env)) return results;
    if (typeof o.switchOn === 'function' && o.switchOn() !== true) return results;
    if (typeof o.prompterOn === 'function' && o.prompterOn() !== true) return results;
    const roster = typeof o.roster === 'function' ? o.roster() : null;
    const now = Number.isFinite(o.now) ? o.now : Date.now();
    const book = o.book instanceof Map ? o.book : new Map();
    const D = o.DELIVERY || {};
    for (const d of due({ roster, now, book, inCommunity: o.inCommunity, postTimes: o.postTimes })) {
      let v = null;
      try { v = o.deliver(d.session, TURN_TEXT, roster); } catch { v = null; }
      const state = v && v.state;
      const held = Boolean(v && v.held === true);
      const reached = state === D.PLACED || state === D.UNCONFIRMED;
      if (reached) book.set(d.session, now);   // a held or unreached line is tried at a later pass
      const r = { session: d.session, name: d.name, act: held ? 'held' : (reached ? 'prompted' : 'not-reached'), delivery: state || null };
      results.push(r);
      if (typeof o.log === 'function') { try { o.log(r); } catch { /* the log is not the work */ } }
    }
  } catch { /* never throws: a sweep is best-effort */ }
  return results;
}

module.exports = { TURN_INTERVAL_MS, TURN_GAP_MS, MAX_PER_PASS, TURN_TEXT, brakeOn, due, tickOnce };
