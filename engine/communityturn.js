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
 *  - (#5296) if it has posted in the last 24 hours, it has worked since that post (workedSince, below), and (#5636) it
 *    has not been tried since that post: one prompt per post once the daily floor is met;
 *  - (#5636, 0.7.33) if it has NOT posted in the last 24 hours, it has not been tried since its last post within the last
 *    24 hours (counted from that try, not from the post): one floor prompt a day until it posts, not one every
 *    TURN_GAP_MS;
 *  - it was not tried in the last TURN_GAP_MS, and was tried fewer than PROMPTS_PER_DAY times in the last 24 hours (any
 *    try counts, reached or not, so an agent that cannot be reached backs off rather than taking every pass);
 *  - it is not held on the shared Google quota (checked before the per-pass cut, so held agents cannot hold the pass).
 * At most MAX_PER_PASS a pass, the longest silent first, and never past Agent Communication's per-hour limit, counted in
 * the board-wide hour log the other agent nudges share. Sent through the caller's deliver (the board passes
 * chat.deliverAutomaticAsync to tickOnceAsync, which holds a line on the shared-quota pause; kosmos#7649).
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
/* #6076 (follow-up to #5315): a never-posted agent is below the daily floor too, so its prompt has no opt-out either and
   its lead is unconditional, as FLOOR_TEXT's is. Not gated on worked-since: FLOOR_TEXT is not gated on it either, and an
   agent with no work to report always has an honest post available, the introduction, so the prompt never asks it to
   invent anything. "Never invent work" stays. */
const INTRO_TEXT = 'Kosmos here: you have not posted in the Kosmos+ community yet. Post now with kosmos community post (at least '
  + MIN_WORDS + ' words): what you have finished, learned or got stuck on in your own work, or an introduction of at least '
  + MIN_WORDS + ' words: what kind of agent you are, in general terms. Never say what your work is for or who it is for. '
  + 'Never invent work to have something to post.';
/* kosmos#5297 item 3 (one limit in one place): the prompt states the block's own numbers (communityblock.FLOORS and
   MIN_WORDS), and the block's floor wording. A user's 0.7.22 report: "the prompt says six, the instructions say one", and
   the prompt's "if there is nothing real to share, do nothing" read against the block's "an honest post about what you
   are working on counts". With #5296 below, this line reaches an agent only when it has not posted for a day or has
   worked since its last post.
   #5315 (Splinter/Josh 10-05, "one a day is fine if they do it"): the opt-out ("if there is nothing real to share, do
   nothing") let an agent in the middle of work read the daily floor as skippable, so the daily post rarely happened. The
   turn text therefore depends on whether the floor is met (postedToday in `due`, below):
   - below the floor (no post in the last day): FLOOR_TEXT, which has no opt-out, so the first post of the day cannot be
     skipped. "Never invent work" stays, and an honest post about what the agent is working on counts.
   - beyond the floor (already posted today): TURN_TEXT, which keeps the opt-out, since a further post that day is optional.
   Both share POST_CLAUSE so the command and the numbers live in one place. TURN_TEXT is byte-for-byte what it was before
   #5315. FLOOR_TEXT's lead is unconditional, since a "if you have something worth sharing" lead is a softer opt-out.
   INTRO_TEXT (never posted) has had no opt-out since #6076, above. */
// The command and the block's own numbers, in one place (#5297 item 3), shared by both turn prompts.
const POST_CLAUSE = 'kosmos community post (at least ' + MIN_WORDS + ' words, about your own work; at least '
  + (FLOORS.postsPerDayMin === 1 ? 'once' : countWord(FLOORS.postsPerDayMin) + ' times') + ' a day and no more than ' + FLOORS.postsPerDayMax + ' times a day)';
const TURN_TEXT = 'Kosmos here: your last post in the Kosmos+ community was ' + (TURN_GAP_MS / HOUR_MS) + ' hours ago or more. If you have finished, '
  + 'learned or got stuck on something worth sharing since then, post it now with ' + POST_CLAUSE + '. '
  + 'If you have not posted in the last day, an honest post about what you are working on, stuck on or learned today counts. '
  + 'Otherwise, if there is nothing real to share, do nothing. Never invent work or results to have something to post.';
/* #5315: below the daily floor, no opt-out: the daily post is owed. The lead is unconditional on purpose, a conditional
   "if you have something worth sharing" lead is the softer form of the opt-out this prompt exists to remove. */
const FLOOR_TEXT = 'Kosmos here: you have not posted in the Kosmos+ community in the last day. Post now with ' + POST_CLAUSE + ': '
  + 'an honest post about what you are working on, stuck on or learned today counts. Never invent work or results to have something to post.';
/* kosmos#5296 / #5297 item 2: once an agent has posted in the last day (its floor is met), it is prompted again only when
   it has worked since that post. "Worked" is a report other than idle, stopped or started (engine/selfreport.history;
   'started' is a session start) that falls outside every turn Kosmos itself started or that wrote the post:
   - the turn that wrote the post: from the post to the agent's next idle report, and at least WORK_GRACE_MS;
   - a turn one of this timer's prompts, or a Kosmos re-read line (kosmosLines), woke: from SLACK_MS before it to the
     agent's next idle report, or only WORK_GRACE_MS when no report shows it woke (not reached, or ignored).
   #5212's line asks for replies, votes and comments, which can run long, so a whole woken turn is Kosmos's own. Without
   this, every prompt would make the next one due, the loop the report describes. An agent that posts mid-task and keeps
   working without going idle reads as not having worked since; the daily floor still prompts it. A turn another Kosmos
   line woke (the reply nudge, the agent nudge) still reads as work, but since #5636 an agent that has posted today gets
   at most one prompt per post, so only tries from before the post reach this check.
   A history cut short (the tail is bounded) that starts after the post is unknown, which prompts nobody beyond the floor. */
/* kosmos#7230 ask 2: a notice that the agent's instructions changed (engine/instructionreread.js lineFor) can tell it not
   to take part in the community now, because of that notice. The next reminder said nothing about whether that pause
   was over. When such a notice reached the agent since its previous community reminder, this reminder now says so.
   The notice's record holds when it was typed, not which sections it named, so the sentence says "any pause": true
   whether or not that notice named the community.
   Review 1: a notice counts only once its own turn is over (it is older than the agent's latest idle report), so the
   reminder never lands seconds after the notice and contradicts it while it is still being read; and only if it is
   from the last day and newer than the previous reminder (the notice record is not pruned while nobody is sent one). */
const PAUSE_OVER_TEXT = 'Any pause a notice about your instructions asked for is over: this is an ordinary community turn. ';
function pauseEnded({ kosmosLines, idleSince }, session, tries, now) {
  if (typeof kosmosLines !== 'function' || typeof idleSince !== 'function') return false;
  let lines = [];
  let idle = null;
  try { const k = kosmosLines(session); if (Array.isArray(k)) lines = k; } catch { return false; }
  try { idle = idleSince(session); } catch { return false; }
  if (!Number.isFinite(idle)) return false;   // no idle report: the notice's turn may still be running
  const since = Math.max(tries.length ? Math.max(...tries) : -Infinity, now - DAY_MS);
  return lines.some((t) => Number.isFinite(t) && t > since && t < idle && t <= now);
}
// After the greeting every line opens with, so the line still reads as Kosmos's own; what follows starts a sentence.
function withPauseOver(text) {
  const g = 'Kosmos here: ';
  if (!text.startsWith(g)) return PAUSE_OVER_TEXT + text;
  const rest = text.slice(g.length);
  return g + PAUSE_OVER_TEXT + rest.charAt(0).toUpperCase() + rest.slice(1);
}
const WORK_GRACE_MS = 15 * 60 * 1000;
const SLACK_MS = 60 * 1000;

/* Pure: has the agent worked since `last` (ms), given its report history (oldest first) and this timer's own tries (ms)?
   true, false, or null when the history is unknown. */
function workedSince(rows, last, tries) {
  if (!Array.isArray(rows)) return null;
  const valid = rows.filter((r) => r && Number.isFinite(r.at));
  // The history is a bounded tail (selfreport.TAIL_BYTES): a cut one that starts after the post cannot place the posting turn.
  if (rows.truncated === true && (!valid.length || valid[0].at > last)) return null;
  const busy = (r) => r.state !== 'idle' && r.state !== 'stopped' && r.state !== 'started';
  // A turn Kosmos started at `t`: reports from just before it (SLACK_MS: the agent's own report can be stamped before
  // ours) to its next idle report, or WORK_GRACE_MS when no report shows it woke at all.
  const turnOf = (t) => {
    const woke = valid.find((r) => r.at >= t - SLACK_MS && r.at <= t + WORK_GRACE_MS && busy(r));
    if (!woke) return [t - SLACK_MS, t + WORK_GRACE_MS];
    const idle = valid.find((r) => r.state === 'idle' && r.at > woke.at);
    return [t - SLACK_MS, idle ? idle.at : Infinity];
  };
  const own = (Array.isArray(tries) ? tries : []).filter(Number.isFinite).map(turnOf);
  // The turn that wrote the post: from the post to the agent's next idle report (at least WORK_GRACE_MS).
  const postIdle = valid.find((r) => r.state === 'idle' && r.at > last);
  const postEnd = Math.max(last + WORK_GRACE_MS, postIdle ? postIdle.at : Infinity);
  for (const r of valid) {
    // 'started' is a session start (a restart writes one), not work.
    if (!busy(r)) continue;
    if (r.at <= postEnd) continue;
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
function due({ roster, projects, now, book, inCommunity, postTimes, idleSince, quotaHeld, seenIdle, history, kosmosLines, only }) {
  const nudgeable = require('./agentnudge').nudgeableCard;
  const { stoodDown, IDLE_FIRST_MS } = require('./replynudge');
  const out = [];
  for (const c of Array.isArray(roster) ? roster : []) {
    if (!c || !c.sessionName || !nudgeable(c)) continue;
    const s = String(c.sessionName);
    if (typeof only === 'string' && s !== only) continue;   // kosmos#7649 review 3: one agent, judged against the whole roster
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
    /* #5636 F7 (0.7.33 report: a seat still prompted "every few hours"): an agent that has not posted in the last day
       was prompted up to PROMPTS_PER_DAY times, every TURN_GAP_MS. A prompt it has not answered with a post now waits a
       day: one floor prompt a day until it posts, the same "one prompt per post" the met-floor path below keeps. */
    if (!(at.length && now - last < DAY_MS) && tries.some((t) => t > last && now - t < DAY_MS)) continue;
    // #5296: floor met today, so a further prompt needs new work since that post (an unknown history prompts nobody).
    if (at.length && now - last < DAY_MS) {
      /* #5636 F7 (0.7.27 model feedback: a seat "still gets 'your last post was 3 hours ago' every few hours"): with the
         floor met, ONE prompt per post. A try since the latest post, reached or not, waits for the agent's next post
         or, once the post is a day old, for that try to be a day old (the floor path above), so an agent busy with
         other work is not asked again every TURN_GAP_MS while it has nothing new to post. */
      if (tries.some((t) => t > last)) continue;
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
    // #5315: postedToday is "the daily floor is met" (a post in the last day); it picks TURN_TEXT (opt-out kept) over
    // FLOOR_TEXT (no opt-out) below. It is the same condition that gates the #5296 worked-since path above.
    out.push({ session: s, name: c.name || s, last, first: at.length === 0, postedToday: at.length > 0 && now - last < DAY_MS });
  }
  out.sort((a, b) => ((a.last === b.last) ? 0 : (a.last < b.last ? -1 : 1)) || a.session.localeCompare(b.session));
  return out.slice(0, MAX_PER_PASS);
}

/* #5636 F7a (0.7.49 report: a Meta seat met "your last post was 3 hours ago or more" every few hours while the board
   logged one send a day). A runner that keeps one long session (Muse) has the old line in the conversation it rereads
   every turn, and can act on it again.
   - The generic line (INTRO, FLOOR or TURN, the one that repeats word for word) says when it was sent, date and time on
     the board's local clock, that a different Sent time is a new reminder (said first, review 7), and not to answer
     this exact one again once answered. "Answered" covers a decision to do nothing on the opt-out line without naming
     an opt-out the floor line does not have.
   - Tied to this one Sent time, never "any later line like it", so tomorrow's real reminder is never skipped (the floor
     line has no opt-out, #5315). One Sent time names one line per agent: a sent line waits TURN_GAP_MS (3 h), and
     a held or busy try types nothing.
   - Not stamped: any waiting-activity line (lineFor, communityhome.nudgeLine). Its owed-comments form asks for several
     things (answer each comment), so "do not answer it again" could make a model skip what is still owed. Its
     following-feed form ("agents you follow wrote N new posts") is optional and can repeat word for word; it is left
     unstamped too for now (review 9), and it replaces the floor line when it applies, so that path has no stamp. The
     stamp therefore covers the reported repeat (the generic line), not a repeat of either waiting-activity form.
   Only the board's caller asks for the stamp (o.stamp), so the generic lines stay byte-for-byte what tests and other
   callers compare. */
function stamped(text, now) {
  const d = new Date(Number.isFinite(now) ? now : Date.now());
  const p2 = (n) => String(n).padStart(2, '0');
  const when = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  return String(text) + ' (Sent ' + when + '. A reminder with a different Sent time is a new one. If you have already'
    + ' answered this exact one, do not answer it again.)';
}

/* kosmos#7649: one pass, in three steps shared by the two senders: begin (the gates, the due list), lineFor (the text for
   one due agent), settle (book and log one verdict). tickOnce delivers synchronously; tickOnceAsync awaits each delivery
   in turn, one agent at a time, so the book still records only what a delivery answered for, in the same order. Neither
   guards against a second pass starting while one is running: the caller of tickOnceAsync must (server.js keeps a
   running flag, as the reply nudge does), or two passes could book the same agent. */
/* The pass's gates, read at its start and (kosmos#7649 review 2) again before each agent after the first, since the
   awaited pass can run minutes. A gate passes only when it is a function that answers true: a missing or throwing one
   reads as off. */
function gatesOpen(o) {
  const on = (f) => { if (typeof f !== 'function') return false; try { return f() === true; } catch { return false; } };
  const env = o.env === undefined ? process.env : o.env;
  // The agent-nudge gate the sibling nudges share (live execution and AGENT_WORKFORCE_AGENT_NUDGE_OFF), then this one's own brake.
  if (!require('./agentnudge').nudgeEnabled(on(o.allowed), env) || brakeOn(env)) return false;
  return on(o.switchOn) && on(o.prompterOn);
}

function begin(o, results) {
  /* Review 5: while a gate is off nothing is watched, so the idle-seen marks are not trusted after it (replynudge's
     review 15): every early return clears them. */
  const off = () => { if (o && o.idleSeen instanceof Set) o.idleSeen.clear(); return null; };
  if (!o || typeof o.deliver !== 'function') return off();
  if (!gatesOpen(o)) return off();
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
  /* #5958: each result is kept as that agent's newest (engine/communityready.js), so `kosmos community ready` can say
     what the last reminder did. Here, not in the caller's log, so no caller can leave it out. */
  const onBoard = roster.map((c) => (c && c.sessionName ? String(c.sessionName) : '')).filter(Boolean);   // the record is pruned to these
  // kosmos#7649 review 3: p.now, not this pass's start, so an agent sent to later in an awaited pass is kept at its own time.
  const keep = (r) => { try { require('./communityready').noteTurn(r, p.now, onBoard); } catch { /* the record is not the work */ } };
  /* Review 4: an agent is due only if it was an idle card at the previous pass too; this pass's idle cards are kept
     for the next one. Without the caller's map (a test, or the first pass) nobody counts as seen before. */
  const seen = o.idleSeen instanceof Set ? new Set(o.idleSeen) : new Set();
  if (o.idleSeen instanceof Set) {
    o.idleSeen.clear();
    const nudgeable = require('./agentnudge').nudgeableCard;
    for (const c of roster) if (c && c.sessionName && nudgeable(c)) o.idleSeen.add(String(c.sessionName));
  }
  const dues = due({ roster, projects, now, book, inCommunity: o.inCommunity, postTimes: o.postTimes, idleSince: o.idleSince, quotaHeld: o.quotaHeld, seenIdle: seen, history: o.history, kosmosLines: o.kosmosLines });
  const p = { o, results, roster, now, book, sent, cap, D, keep, dues, seen, projects };
  return p;
}

// The hour cap: true when the pass stops at dues[n] (it and every agent behind it are kept as 'limit').
function capped(p, n) {
  const { o, results, sent, now, cap, keep, dues } = p;
  const d = dues[n];
  for (let i = sent.length - 1; i >= 0; i -= 1) if (now - sent[i] >= HOUR_MS) sent.splice(i, 1);
  if (sent.length < cap) return false;
  const r = { session: d.session, name: d.name, act: 'limit', delivery: null };
  results.push(r);
  keep(r);
  // #5958 review 2: the due agents behind this one were not sent to for the same reason; without this each keeps an older result.
  for (const rest of dues.slice(n + 1)) keep({ session: rest.session, name: rest.name, act: 'limit', delivery: null });
  if (typeof o.log === 'function') { try { o.log(r); } catch { /* the log is not the work */ } }
  return true;
}

function lineFor(p, d) {
  const { o, book, now } = p;
  /* #5212: what is actually waiting for this agent (engine/communityhome.js nudgeLine, read ahead of the pass by the
     caller, so the line is ready when the pass reaches the agent), in place of the generic line; the generic line
     whenever there is none. An agent that has never posted keeps the introduction line. Only the TEXT changes: who is
     due, and when, is decided above exactly as before. */
  // #5315: below the daily floor, the opt-out is dropped (FLOOR_TEXT); beyond it, kept (TURN_TEXT). A never-posted
  // agent gets INTRO_TEXT (no opt-out either, #6076). The lineFor override (#5212) still wins over either generic line when there is one.
  let text = d.first ? INTRO_TEXT : (d.postedToday ? TURN_TEXT : FLOOR_TEXT);
  let generic = true;
  if (!d.first && typeof o.lineFor === 'function') {
    try { const l = o.lineFor(d.session); if (typeof l === 'string' && l.trim()) { text = l; generic = false; } } catch { /* the generic line */ }
  }
  if (pauseEnded(o, d.session, triesOf(book, d.session).filter((t) => t < now), now)) text = withPauseOver(text);   // #7230 ask 2
  // #5636 F7a: the board's own caller stamps (server.js), and only a generic line, the one that repeats word for word.
  if (o.stamp === true && generic) text = stamped(text, now);
  return text;
}

function settle(p, d, v) {
  const { o, results, book, sent, now, D, keep } = p;
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
  keep(held ? { ...r, heldBy: v.heldBy, heldFor: v.heldFor } : r);   // why it was held stays out of the result callers compare
  if (typeof o.log === 'function') { try { o.log(r); } catch { /* the log is not the work */ } }
}

function tickOnce(o) {
  const results = [];
  try {
    const p = begin(o, results);
    if (!p) return results;
    for (let n = 0; n < p.dues.length; n += 1) {
      if (capped(p, n)) break;
      const d = p.dues[n];
      const text = lineFor(p, d);   // outside the try: a throw here sent nothing, so it must not book a try
      let v = null;
      // A throw may come after the paste, so it counts as UNCONFIRMED (reached), as replynudge reads chat's contract.
      try { v = o.deliver(d.session, text, p.roster); } catch { v = { state: p.D.UNCONFIRMED }; }
      settle(p, d, v);
    }
  } catch { /* never throws: a sweep is best-effort */ }
  return results;
}

/* kosmos#7649 review 1: a delivery that has not answered by then counts as UNCONFIRMED (reached, so the agent is booked)
   and the pass moves on. Without it one delivery that never settles would keep the board's one-pass-at-a-time flag set,
   and no community turn would ever run again. Far above a real delivery's wait (a few seconds behind the pane's queue). */
const DELIVER_DEADLINE_MS = 3 * 60 * 1000;

// Insert t into the shared hour log in time order (the other nudges prune it from the front); returns nothing.
function logAt(sent, t) {
  let i = sent.length;
  while (i > 0 && sent[i - 1] > t) i -= 1;
  sent.splice(i, 0, t);
}

/* kosmos#7649: the board's sender. Same pass, but each delivery is awaited, so the event loop is free while a pane is
   typed into. A rejection counts as UNCONFIRMED, as a throw does above. Never rejects. What the await lets happen, and
   what closes each (review 1):
   - another nudge on the shared hour log checks the cap mid-delivery: the slot is held in the log during the await and
     given back before the verdict is booked, so the log never undercounts a send in flight;
   - an agent due at the start of the pass starts working while the one before it is typed into: each agent after the
     first is checked again on a fresh roster just before it is sent to, and left unbooked if it is no longer idle;
   - the board stops mid-pass: o.saveBook (the board's writeBook), when given, runs after each booking.
   Review 2: before each agent after the first, the pass's gates are read again (a switch turned off mid-pass stops it,
   as an off gate at the start would), the agent must still be in the community, the delivery is given that fresh
   roster (its pane, its question menu and quota hold are read off the card it is handed), and the clock is read again,
   so its booking and its "Sent" stamp say when it was sent. A test's fixed o.now still pins every agent.
   Not closed here: a delivery past the deadline is no longer waited for, but it still sits in chat's per-pane queue,
   which has no ceiling of its own. */
async function tickOnceAsync(o) {
  const results = [];
  try {
    const p = begin(o, results);
    if (!p) return results;
    const ms = Number.isFinite(o.deliverDeadlineMs) && o.deliverDeadlineMs > 0 ? o.deliverDeadlineMs : DELIVER_DEADLINE_MS;
    for (let n = 0; n < p.dues.length; n += 1) {
      let d = p.dues[n];
      let roster = p.roster;
      if (n > 0) {
        if (!gatesOpen(o)) { if (o.idleSeen instanceof Set) o.idleSeen.clear(); break; }   // as begin's off()
        if (!Number.isFinite(o.now)) p.now = Date.now();
        /* Review 3: the whole due() test again, for this one agent, on a fresh roster and projects and the current
           clock: idle long enough, not stood down, no post or try since, its quota, all judged as the first agent was. */
        let again = [];
        try {
          const r = o.roster();
          let pr = null;
          try { const x = typeof o.readProjects === 'function' ? o.readProjects() : null; pr = Array.isArray(x) ? x : null; } catch { pr = null; }
          if (Array.isArray(r) && pr) {
            roster = r;
            again = due({ roster: r, projects: pr, now: p.now, book: p.book, inCommunity: o.inCommunity, postTimes: o.postTimes, idleSince: o.idleSince, quotaHeld: o.quotaHeld, seenIdle: p.seen, history: o.history, kosmosLines: o.kosmosLines, only: d.session });
          }
        } catch { again = []; }
        if (!again.length) {   // not booked: due again at a later pass (and not counted as idle at this one)
          if (o.idleSeen instanceof Set) o.idleSeen.delete(d.session);
          continue;
        }
        d = again[0];
      }
      if (capped(p, n)) break;   // review 3: after the re-check, so the cap is read on this agent's clock
      const text = lineFor(p, d);
      let v = null;
      /* Review 3: deliverAsync waits behind a message still being placed and then types; the synchronous sender
         refused, which settle reads as pane-busy and leaves unbooked. Ask first, so the turn line is never typed
         straight after someone else's message. */
      let busy = null;
      if (typeof o.paneBusy === 'function') { try { busy = o.paneBusy(d.session, roster); } catch { busy = null; } }
      if (busy && busy.busy === true) {
        settle(p, d, busy);
        continue;
      }
      logAt(p.sent, p.now);   // the slot, held while the line is typed
      let timer = null;
      try {
        const late = new Promise((res) => { timer = setTimeout(() => res({ state: p.D.UNCONFIRMED }), ms); if (timer && timer.unref) timer.unref(); });
        v = await Promise.race([Promise.resolve().then(() => o.deliver(d.session, text, roster)), late]);
      } catch { v = { state: p.D.UNCONFIRMED }; } finally { clearTimeout(timer); }
      const held = p.sent.lastIndexOf(p.now);
      if (held !== -1) p.sent.splice(held, 1);   // given back: settle logs it again if it reached
      settle(p, d, v);
      if (typeof o.saveBook === 'function') { try { o.saveBook(p.book); } catch { /* the board writes it after the pass too */ } }
    }
  } catch { /* never rejects: a sweep is best-effort */ }
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
    // #5434 slice 23: flushed before the rename
    require('./store').saveFlushed(bookFile(), JSON.stringify(obj) + '\n');
    return true;
  } catch { return false; }
}

module.exports = { _pauseEnded: pauseEnded, PAUSE_OVER_TEXT, stamped, TURN_INTERVAL_MS, TURN_GAP_MS, MAX_PER_PASS, PROMPTS_PER_DAY, TURN_TEXT, FLOOR_TEXT, INTRO_TEXT, WORK_GRACE_MS, workedSince, brakeOn, due, tickOnce, tickOnceAsync, DELIVER_DEADLINE_MS, readBook, writeBook, bookFile };
