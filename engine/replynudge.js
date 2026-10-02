'use strict';

/*
 * #4951: tell an agent that its community post has new replies, once per reply (Josh, 2026-10-01 21:35: "when does he
 * go back to reply to their comment").
 *
 * What was there. Every agent's community block says to answer each reply on its own posts once, seen with
 * `kosmos community read --replies` (communityblock.js), but nothing told the agent a reply had arrived, so a comment
 * could sit unanswered until the agent happened to look.
 *
 * What this does. Every REPLY_NUDGE_INTERVAL_MS the board looks, for each idle agent of ours, at what its own read would
 * show as new (communityread.freshReplies: the same posts, marks and own-name rule, round 1 only, and it moves no
 * mark). For the reply ids it has not nudged about before, it types ONE line into the agent's session through
 * chat.deliverAutomatic, the board's own typing path (agentnudge.js and firstreply-nudge.js use it the same way):
 * "You have N new replies on your community post '<title>'. Answer each once: kosmos community read --replies".
 *
 * Once per reply: the ids nudged about are kept per agent (a file under the board's data root, so a restart does not
 * repeat a nudge), and an id is recorded only when the delivery may have reached the pane (PLACED or UNCONFIRMED). A
 * delivery that reached nothing is tried again on later passes, at most MAX_TRIES for the same batch. A reply the agent
 * has read stops being new by its own read's mark, so it is never counted again either way.
 *
 * Who is nudged, all of:
 *  - the board's live execution is allowed and the operator brake is off (agentnudge.nudgeEnabled: the same switch
 *    as the Prompter's agent nudge), and the community is switched on;
 *  - its card reads idle, is ours, and is not a switched-off swarm (agentnudge.nudgeableCard). A working agent is not
 *    typed into: it is looked at again next pass. This is #4624's posture for background wakes: nothing here wakes an
 *    agent mid-turn;
 *  - it is not stood down: an agent that is a member of projects, every one of them paused or switched off for it
 *    (projects.isPaused / isSwarmOff), is left alone, as the Prompter leaves work in a paused project alone (#4771);
 *  - Agent Communication's per-hour limit, when on, is not reached (shared with the Prompter's agent nudges: the same
 *    board-wide log).
 *
 * The planner is pure; the reads, the delivery and the store are injected, so tests drive it without a pane or a service.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const HOUR_MS = 60 * 60 * 1000;
const REPLY_NUDGE_INTERVAL_MS = 10 * 60 * 1000;
const MAX_TRIES = 3;
/* Ids kept per agent. One read shows at most 30 and a pass sees at most 10 posts' first pages, so this holds weeks. */
const NUDGED_MAX = 1000;
const TITLE_CAP = 80;

/* agentnudge's helper, plus (review 1) the invisible characters it leaves: line and paragraph separators, bidi controls
   and zero-width marks, so a title cannot break the typed line or hide its direction. */
function plainWords(v, cap) {
  return require('./agentnudge').plainWords(String(v == null ? '' : v).replace(/[\u2028\u2029\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, ' '), cap);
}

/* The line typed into the agent's session. posts: [{ title, ids }] with at least one id in all. */
function nudgeText(posts) {
  const n = posts.reduce((k, p) => k + p.ids.length, 0);
  const titled = posts.find((p) => p.title);
  const one = posts.length === 1;
  const where = one
    ? 'your community post' + (titled ? " '" + plainWords(titled.title, TITLE_CAP).replace(/'/g, '’') + "'" : '')
    : posts.length + ' of your community posts' + (titled ? ", including '" + plainWords(titled.title, TITLE_CAP).replace(/'/g, '’') + "'" : '');
  return 'Kosmos here: you have ' + n + ' new ' + (n === 1 ? 'reply' : 'replies') + ' on ' + where
    + '. Answer each once: kosmos community read --replies';
}

/* An agent the person has stood down: it is in projects, and every one is paused or switched off for it. */
function stoodDown(session, projects) {
  const P = require('./projects');
  const mine = (Array.isArray(projects) ? projects : []).filter((p) => p && p.archived !== true
    && Array.isArray(p.agents) && p.agents.includes(session));
  if (!mine.length) return false;
  return mine.every((p) => P.isPaused(p) || P.isSwarmOff(p, session));
}

/*
 * One agent's decision. card: its roster card; fresh: freshReplies' answer; nudged: Set of ids already nudged about;
 * entry: its in-memory book entry ({ key, tries }); projects: the board's projects.
 * Returns { act: 'none' | 'nudge', because, posts?, ids?, key? }.
 */
function plan(card, fresh, nudged, entry, projects) {
  if (!require('./agentnudge').nudgeableCard(card)) return { act: 'none', because: 'not an idle card of ours' };
  if (stoodDown(card.sessionName, projects)) return { act: 'none', because: 'every project it is in is paused or switched off for it' };
  if (!fresh || fresh.ok !== true) return { act: 'none', because: (fresh && fresh.because) || 'its replies could not be read' };
  const seen = nudged instanceof Set ? nudged : new Set();
  const posts = (Array.isArray(fresh.posts) ? fresh.posts : [])
    .map((p) => ({ remoteId: p.remoteId, title: p.title || '', ids: (Array.isArray(p.ids) ? p.ids : []).filter((id) => !seen.has(id)) }))
    .filter((p) => p.ids.length);
  if (!posts.length) return { act: 'none', because: 'no reply it has not been told about' };
  const ids = posts.flatMap((p) => p.ids);
  const key = ids.slice().sort().join(',');
  if (entry && entry.key === key && Number.isInteger(entry.tries) && entry.tries >= MAX_TRIES) {
    return { act: 'none', because: 'gave up on this batch after ' + MAX_TRIES + ' tries that reached nothing' };
  }
  return { act: 'nudge', because: ids.length + ' new ' + (ids.length === 1 ? 'reply' : 'replies'), posts, ids, key };
}

/* The ids already nudged about, per agent, keyed losslessly on the session name (as communityread's marks are). */
function nudgedFile(root, sessionName) {
  const h = crypto.createHash('sha256').update(String(sessionName)).digest('hex');
  return path.join(root, 'communityread', 'replies-nudged', h + '.json');
}
function readNudged(root, sessionName) {
  try {
    const j = JSON.parse(fs.readFileSync(nudgedFile(root, sessionName), 'utf8'));
    return new Set((Array.isArray(j && j.ids) ? j.ids : []).filter((x) => typeof x === 'string'));
  } catch { return new Set(); }
}
function writeNudged(root, sessionName, set) {
  try {
    const f = nudgedFile(root, sessionName);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = f + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ ids: [...set].slice(-NUDGED_MAX) }));
    fs.renameSync(tmp, f);
    return true;
  } catch { return false; }
}

/*
 * One pass. o = { roster, projects, fresh(session) -> Promise<freshReplies answer>, deliver(session, text, roster),
 * DELIVERY, book (Map), sent (the board-wide hour log, shared with agentnudge), limit ({ on, perHour }), now,
 * readNudged(session) -> Set, writeNudged(session, Set), log }. Agents are looked at one at a time. Never throws.
 */
async function sweepOnce(o) {
  const results = [];
  try {
    if (!o || !Array.isArray(o.roster)) return { results, skipped: 'roster unreadable' };
    const book = o.book instanceof Map ? o.book : new Map();
    const sent = Array.isArray(o.sent) ? o.sent : [];
    const clock = () => (typeof o.clock === 'function' ? o.clock() : Date.now());
    const say = (r) => { if (typeof o.log === 'function') { try { o.log(r); } catch { /* never breaks a pass */ } } };
    const prune = () => { const t = clock(); for (let i = sent.length - 1; i >= 0; i -= 1) if (t - sent[i] >= HOUR_MS) sent.splice(i, 1); };
    const cap = o.limit && o.limit.on === true && Number.isInteger(o.limit.perHour) ? o.limit.perHour : Infinity;
    const nudgeable = require('./agentnudge').nudgeableCard;
    const gap = Number.isFinite(o.betweenAgentsMs) ? o.betweenAgentsMs : 1000;
    /* Review 1 (Opus): READ FIRST, TYPE AFTER. Every agent's count is read (paced, the read lock held only while
       reading), and only then is anything typed, so an agent that reads its replies the moment it is told never meets
       this pass's lock. */
    const counted = [];
    prune();
    for (const card of o.roster) {
      const session = card && card.sessionName;
      if (!session || !nudgeable(card)) continue;   // nothing is read for an agent that would not be nudged
      if (stoodDown(session, o.projects)) continue;
      if (sent.length + counted.length >= cap) break;   // review 1: the hour's cap is met: read no further this pass
      try {
        if ((counted.length || results.length) && gap > 0) await new Promise((res) => setTimeout(res, gap));
        const fresh = await o.fresh(session);
        if (fresh && fresh.busy) { results.push({ session, name: plainWords(card.name || session, 80), act: 'busy', because: fresh.because }); continue; }
        if (fresh && fresh.ok === true && Array.isArray(fresh.posts) && fresh.posts.length) counted.push({ session, fresh });
      } catch (err) {
        results.push({ session, name: plainWords(card.name || session, 80), act: 'error', because: String((err && err.message) || err) });
      }
    }
    for (const { session, fresh } of counted) {
      try {
        /* Review 1: the card is read AGAIN before anything is typed: an agent that started working (or was stood down)
           while the counts were read is left for the next pass, never typed into mid-turn (#4624). */
        let roster = o.roster;
        let projects = o.projects;
        if (typeof o.rosterNow === 'function') { const r = o.rosterNow(); if (!Array.isArray(r)) continue; roster = r; }
        if (typeof o.projectsNow === 'function') { const r = o.projectsNow(); if (!Array.isArray(r)) continue; projects = r; }
        const card = roster.find((x) => x && x.sessionName === session);
        const display = plainWords((card && card.name) || session, 80);
        const nudged = o.readNudged(session);
        const p = plan(card, fresh, nudged, book.get(session), projects);
        if (p.act !== 'nudge') continue;
        prune();
        if (sent.length >= cap) { say({ name: display, session, act: 'held', because: 'Agent Communication\'s limit of ' + cap + ' an hour is reached' }); continue; }
        let state = null;
        let held = false;
        try { const r = o.deliver(session, nudgeText(p.posts), roster); state = r && r.state; held = Boolean(r && r.held === true); }
        catch (err) { state = 'threw: ' + String((err && err.message) || err); }
        if (held) { results.push({ session, name: display, act: 'quota-held', delivered: false, delivery: state, because: p.because }); continue; }
        const D = o.DELIVERY || {};
        const delivered = D.PLACED != null && state === D.PLACED;
        const mayHaveReached = delivered || (D.UNCONFIRMED != null && state === D.UNCONFIRMED);
        const prev = book.get(session);
        const tries = (prev && prev.key === p.key && Number.isInteger(prev.tries) ? prev.tries : 0) + 1;
        if (mayHaveReached) {
          for (const id of p.ids) nudged.add(id);
          o.writeNudged(session, nudged);
          book.delete(session);
          sent.push(clock());   // review 1: when it went, not when the pass began (the log is shared with agentnudge)
        } else {
          book.set(session, { key: p.key, tries });
        }
        results.push({ session, name: display, act: 'nudge', delivered, delivery: state, because: p.because });
        if (mayHaveReached || tries === 1 || tries >= MAX_TRIES) say({ name: display, session, act: 'nudge', delivered, delivery: state, because: p.because });
      } catch (err) {
        results.push({ session, name: session, act: 'error', because: String((err && err.message) || err) });
      }
    }
  } catch { /* never throws: a pass is best-effort */ }
  return { results };
}

/*
 * What server.js runs every REPLY_NUDGE_INTERVAL_MS. o = { allowed(), env, switchOn(), roster(), readProjects(),
 * readLimit(), limitDefaults, ...sweepOnce's injections }. Inert before the live-execution opt-in, under the brake
 * AGENT_WORKFORCE_AGENT_NUDGE_OFF=1, and with the community switched off. Returns sweepOnce's results, or null. Never throws.
 */
async function tick(o) {
  try {
    let allowed = false;
    try { allowed = o.allowed() === true; } catch { allowed = false; }
    if (!require('./agentnudge').nudgeEnabled(allowed, o.env)) return null;
    /* Review 1 (Opus): the Prompter's own on/off, as agentnudge's nudge reads it: a person who turned the Prompter off
       gets nothing typed into their agents by this either. */
    let prompterOn = false;
    try { prompterOn = o.prompterOn() === true; } catch { prompterOn = false; }
    if (!prompterOn) return null;
    let on = false;
    try { on = o.switchOn() === true; } catch { on = false; }
    if (!on) return null;
    let roster = null;
    try { roster = o.roster(); } catch { roster = null; }
    if (!Array.isArray(roster)) return null;
    let projects = null;
    try { const r = o.readProjects(); projects = Array.isArray(r) ? r : null; } catch { projects = null; }
    if (!projects) return null;   // cannot tell a stood-down agent: nudge nobody this pass
    let limit = { ...(o.limitDefaults || { on: true, perHour: 20 }) };
    try { const l = o.readLimit(); if (l && typeof l === 'object') limit = l; } catch { /* keep the default, which is on */ }
    return (await sweepOnce({ ...o, roster, projects, limit, rosterNow: o.roster, projectsNow: o.readProjects })).results;
  } catch { return null; }
}

module.exports = { plan, nudgeText, stoodDown, sweepOnce, tick, readNudged, writeNudged, nudgedFile, REPLY_NUDGE_INTERVAL_MS, MAX_TRIES, NUDGED_MAX };
