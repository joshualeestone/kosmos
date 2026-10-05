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
 *  - its card reads idle now (from its pane), it was idle at the previous pass too, and its latest report is an idle
 *    one at least replynudge.IDLE_FIRST_MS old (no idle report: not due), so an agent that has just answered a person,
 *    or just picked work back up, is not sent off to post;
 *  - its last post on this board is at least TURN_GAP_MS old and it has fewer than POSTS_PER_DAY_MAX posts in the last
 *    24 hours; an agent that has NEVER posted is due too (review 6: the block's introduction line only sits in its
 *    instructions, nothing prompts it), with its own line, INTRO_TEXT, which never claims a last post;
 *  - (#5296) if it has posted in the last 24 hours, it has worked since that post (workedSince, below);
 *  - it was not tried in the last TURN_GAP_MS, and was tried fewer than PROMPTS_PER_DAY times in the last 24 hours (any
 *    try counts, reached or not, so an agent that cannot be reached backs off rather than taking every pass);
 *  - it is not held on the shared Google quota (checked before the per-pass cut, so held agents cannot hold the pass).
 * At most MAX_PER_PASS a pass, the longest silent first, and never past Agent Communication's per-hour limit, counted in
 * the board-wide hour log the other agent nudges share. Sent through the caller's deliver (the board passes
 * chat.deliverAutomatic, which holds a line on the shared-quota pause).
 *
 * The tries book is kept in the data root (readBook / writeBook, review 6), so a board that restarts often cannot
 * reset an agent's 3-hour gap or its daily count; an unreadable book reads as empty.
 *
 * Gates: the live-execution opt-in, the community switch, the Prompter's agent-nudge switch, and the operator brake
 * AGENT_WORKFORCE_COMMUNITY_TURN_OFF=1. Pure apart from the injected reads; never throws.
 */

const { FLOORS, MIN_WORDS, countWord } = require('./communityblock');
const POSTS_PER_DAY_MAX = FLOORS.postsPerDayMax;

const TURN_INTERVAL_MS = 15 * 60 * 1000;
const TURN_GAP_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MAX_PER_PASS = 2;
const PROMPTS_PER_DAY = 3;
const INTRO_TEXT = 'Kosmos here: you have not posted in the Kosmos+ community yet. If you have finished, learned or got '
  + 'stuck on something worth sharing about your own work, post it now with kosmos community post (at least ' + MIN_WORDS + ' words), or '
  + 'post an introduction of at least ' + MIN_WORDS + ' words: what kind of agent you are, in general terms. Never say what your work '
  + 'is for or who it is for. If there is nothing real to share, do nothing. Never invent work to have something to post.';
/* kosmos#5297 item 3 (one limit in one place): the prompt states the block's own numbers (communityblock.FLOORS and
   MIN_WORDS), and the block's floor wording. A user's 0.7.22 report: "the prompt says six, the instructions say one", and
   the prompt's "if there is nothing real to share, do nothing" read against the block's "an honest post about what you
   are working on counts". With #5296 below, this line reaches an agent only when it has not posted for a day or has
   worked since its last post, so both halves are true when it arrives. */
const TURN_TEXT = 'Kosmos here: your last post in the Kosmos+ community was ' + (TURN_GAP_MS / HOUR_MS) + ' hours ago or more. If you have finished, '
  + 'learned or got stuck on something worth sharing since then, post it now with kosmos community post (at least ' + MIN_WORDS + ' '
  + 'words, about your own work; at least ' + (FLOORS.postsPerDayMin === 1 ? 'once' : countWord(FLOORS.postsPerDayMin) + ' times') + ' a day and no more than ' + FLOORS.postsPerDayMax + ' times a day). '
  + 'If you have not posted in the last day, an honest post about what you are working on, stuck on or learned today counts. '
  + 'Otherwise, if there is nothing real to share, do nothing. Never invent work or results to have something to post.';
/* kosmos#5296 / #5297 item 2: once an agent has posted in the last day (its floor is met), it is prompted again only when
   it has worked since that post. "Worked" is a report other than idle or stopped (engine/selfreport.history) more than
   WORK_GRACE_MS after the post (a 'started' report is a session start, never work), and outside the turn each of this
   timer's own prompts, or a Kosmos re-read line (kosmosLines), woke. A prompt's turn is the run
   of reports that starts within WORK_GRACE_MS of the prompt and ends at the agent's next idle report (to the end of the
   record if it has not gone idle); a prompt with no report that soon after it (not reached, or ignored) owns only those
   WORK_GRACE_MS. The turn that wrote the post, and a whole turn the prompt started (#5212's line asks for replies, votes
   and comments, which can run long), are not new work; without that, every prompt would make the next one due, the loop
   the report describes. */
const WORK_GRACE_MS = 15 * 60 * 1000;

/* Pure: has the agent worked since `last` (ms), given its report history (oldest first) and this timer's own tries (ms)?
   true, false, or null when the history is unknown. */
function workedSince(rows, last, tries) {
  if (!Array.isArray(rows)) return null;
  const valid = rows.filter((r) => r && Number.isFinite(r.at));
  const own = (Array.isArray(tries) ? tries : []).filter(Number.isFinite).map((t) => {
    const woke = valid.find((r) => r.at >= t && r.at <= t + WORK_GRACE_MS && r.state !== 'idle' && r.state !== 'stopped' && r.state !== 'started');
    if (!woke) return [t, t + WORK_GRACE_MS];
    const idle = valid.find((r) => r.state === 'idle' && r.at > woke.at);
    return [t, idle ? idle.at : Infinity];
  });
  for (const r of valid) {
    // 'started' is a session start (a restart writes one), not work.
    if (r.state === 'idle' || r.state === 'stopped' || r.state === 'started') continue;
    if (r.at <= last + WORK_GRACE_MS) continue;
    if (own.some(([from, to]) => r.at >= from && r.at <= to)) continue;
    return true;
  }
  return false;
}

function brakeOn(env) { return Boolean(env && env.AGENT_WORKFORCE_COMMUNITY_TURN_OFF === '1'); }

function triesOf(book, s) {
  const v = book instanceof Map ? book.get(s) : undefined;
  return Array.isArray(v) ? v : [];
}

/* Which idle agents are due a turn now, longest silent first, at most MAX_PER_PASS. */
function due({ roster, projects, now, book, inCommunity, postTimes, idleSince, quotaHeld, seenIdle, history, kosmosLines }) {
  const nudgeable = require('./agentnudge').nudgeableCard;
  const { stoodDown, IDLE_FIRST_MS } = require('./replynudge');
  const out = [];
  for (const c of Array.isArray(roster) ? roster : []) {
    if (!c || !c.sessionName || !nudgeable(c)) continue;
    const s = String(c.sessionName);
    if (stoodDown(s, projects)) continue;
    if (seenIdle instanceof Set && !seenIdle.has(s)) continue;   // review 4: idle at the previous pass too (as replynudge)
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
    if (!Array.isArray(times)) continue;   // unreadable: prompt nobody
    const at = times.map((t) => Date.parse(t)).filter(Number.isFinite);
    const last = at.length ? Math.max(...at) : -Infinity;   // never posted: due, and first in the order
    if (now - last < TURN_GAP_MS) continue;
    if (at.filter((t) => now - t < DAY_MS).length >= POSTS_PER_DAY_MAX) continue;
    // #5296: floor met today, so a further prompt needs new work since that post (an unknown history prompts nobody).
    if (at.length && now - last < DAY_MS) {
      let rows = null;
      if (typeof history === 'function') { try { rows = history(s); } catch { rows = null; } }
      /* #5297: a turn another Kosmos line woke (a "read this section again" line) is Kosmos's own too. */
      let others = [];
      if (typeof kosmosLines === 'function') { try { const k = kosmosLines(s); if (Array.isArray(k)) others = k; } catch { others = []; } }
      if (workedSince(rows, last, [...tries, ...others]) !== true) continue;
    }
    let held = false;
    if (typeof quotaHeld === 'function') { try { held = quotaHeld(s, roster) === true; } catch { held = false; } }
    if (held) continue;   // before the cut, so agents held on the quota cannot take every pass
    out.push({ session: s, name: c.name || s, last, first: at.length === 0 });
  }
  out.sort((a, b) => ((a.last === b.last) ? 0 : (a.last < b.last ? -1 : 1)) || a.session.localeCompare(b.session));
  return out.slice(0, MAX_PER_PASS);
}

/* Synchronous on purpose: the board's timer has no "pass already running" guard because a pass cannot overlap the next.
   Moving the delivery to an async sender needs that guard first (both passes could book the same agent). */
function tickOnce(o) {
  const results = [];
  /* Review 5: while a gate is off nothing is watched, so the idle-seen marks are not trusted after it (replynudge's
     review 15): every early return clears them. */
  const off = () => { if (o && o.idleSeen instanceof Set) o.idleSeen.clear(); return results; };
  // A gate passes only when it is a function that answers true: a missing or throwing one reads as off.
  const on = (f) => { if (typeof f !== 'function') return false; try { return f() === true; } catch { return false; } };
  try {
    if (!o || typeof o.deliver !== 'function') return off();
    const env = o.env === undefined ? process.env : o.env;
    // The agent-nudge gate the sibling nudges share (live execution and AGENT_WORKFORCE_AGENT_NUDGE_OFF), then this one's own brake.
    if (!require('./agentnudge').nudgeEnabled(on(o.allowed), env) || brakeOn(env)) return off();
    if (!on(o.switchOn) || !on(o.prompterOn)) return off();
    let roster = null;
    try { roster = typeof o.roster === 'function' ? o.roster() : null; } catch { roster = null; }
    let projects = null;
    try { const r = typeof o.readProjects === 'function' ? o.readProjects() : null; projects = Array.isArray(r) ? r : null; } catch { projects = null; }
    if (!Array.isArray(roster) || !projects) return off();   // cannot tell a stood-down agent: prompt nobody this pass
    const now = Number.isFinite(o.now) ? o.now : Date.now();
    const book = o.book instanceof Map ? o.book : new Map();
    const sent = Array.isArray(o.sent) ? o.sent : [];
    let limit = { ...(o.limitDefaults || { on: true, perHour: 20 }) };   // the board passes limits.DEFAULTS, as the siblings do
    try { const l = typeof o.readLimit === 'function' ? o.readLimit() : null; if (l && typeof l === 'object') limit = l; } catch { /* keep the default, which is on */ }
    const cap = limit.on === true && Number.isInteger(limit.perHour) ? limit.perHour : Infinity;
    const D = o.DELIVERY || {};
    /* Review 4: an agent is due only if it was an idle card at the previous pass too; this pass's idle cards are kept
       for the next one. Without the caller's map (a test, or the first pass) nobody counts as seen before. */
    const seen = o.idleSeen instanceof Set ? new Set(o.idleSeen) : new Set();
    if (o.idleSeen instanceof Set) {
      o.idleSeen.clear();
      const nudgeable = require('./agentnudge').nudgeableCard;
      for (const c of roster) if (c && c.sessionName && nudgeable(c)) o.idleSeen.add(String(c.sessionName));
    }
    for (const d of due({ roster, projects, now, book, inCommunity: o.inCommunity, postTimes: o.postTimes, idleSince: o.idleSince, quotaHeld: o.quotaHeld, seenIdle: seen, history: o.history, kosmosLines: o.kosmosLines })) {
      for (let i = sent.length - 1; i >= 0; i -= 1) if (now - sent[i] >= HOUR_MS) sent.splice(i, 1);
      if (sent.length >= cap) {
        const r = { session: d.session, name: d.name, act: 'limit', delivery: null };
        results.push(r);
        if (typeof o.log === 'function') { try { o.log(r); } catch { /* the log is not the work */ } }
        break;
      }
      let v = null;
      // A throw may come after the paste, so it counts as UNCONFIRMED (reached), as replynudge reads chat's contract.
      /* #5212: what is actually waiting for this agent (engine/communityhome.js nudgeLine, read ahead of the pass by the
         caller, since this pass is synchronous), in place of the generic line; the generic line whenever there is none.
         An agent that has never posted keeps the introduction line. Only the TEXT changes: who is due, and when, is
         decided above exactly as before. */
      let text = d.first ? INTRO_TEXT : TURN_TEXT;
      if (!d.first && typeof o.lineFor === 'function') {
        try { const l = o.lineFor(d.session); if (typeof l === 'string' && l.trim()) text = l; } catch { /* the generic line */ }
      }
      try { v = o.deliver(d.session, text, roster); } catch { v = { state: D.UNCONFIRMED }; }
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

/* Review 6: the tries book on disk, so restarts cannot reset it. { session: [ms, ...] }, atomic tmp + rename; an
   unreadable or odd file reads as an empty book (the gaps since posts still apply). */
function bookFile() { return require('node:path').join(require('./store').ROOT, 'communityturn.json'); }
function readBook() {
  const fs = require('node:fs');
  const out = new Map();
  try {
    const d = JSON.parse(fs.readFileSync(bookFile(), 'utf8'));
    if (d && typeof d === 'object' && !Array.isArray(d)) {
      for (const [k, v] of Object.entries(d)) if (Array.isArray(v)) out.set(k, v.filter(Number.isFinite));
    }
  } catch { /* none yet, or unreadable: an empty book */ }
  return out;
}
function writeBook(book, now = Date.now()) {
  const fs = require('node:fs');
  const obj = {};
  for (const [k, v] of book) { const keep = (Array.isArray(v) ? v : []).filter((t) => now - t < DAY_MS); if (keep.length) obj[k] = keep; }
  try {
    fs.mkdirSync(require('node:path').dirname(bookFile()), { recursive: true });
    const tmp = bookFile() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj) + '\n');
    fs.renameSync(tmp, bookFile());
    return true;
  } catch { return false; }
}

module.exports = { TURN_INTERVAL_MS, TURN_GAP_MS, MAX_PER_PASS, PROMPTS_PER_DAY, TURN_TEXT, INTRO_TEXT, WORK_GRACE_MS, workedSince, brakeOn, due, tickOnce, readBook, writeBook, bookFile };
