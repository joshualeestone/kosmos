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
 * show as new (communityread.freshReplies: the same posts, marks, own-name rule, round 2 and 30-reply cap, and it moves no
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
const BUSY_WAIT_MS = 5 * 1000;   // review 6: a busy count waits this long for the read holding the lock, then asks again
const BUSY_RETRIES = 4;          // so about 20 s, past an agent's own read (two 8 s rounds at most)
const TYPE_GAP_MS = 20 * 1000;   // review 2: between two agents' lines, so each told agent reads with the lock free
/* Ids kept per agent. One count names at most 30 (the read's cap), so this holds weeks. */
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
/* Review 3 (Opus): ONLY a missing file is "told nothing". Any other failure (EMFILE, EACCES, EIO, a torn file) is null,
   and the pass skips that agent: read as empty, it would tell the agent again about replies it was already told about. */
function readNudged(root, sessionName) {
  let raw;
  try { raw = fs.readFileSync(nudgedFile(root, sessionName), 'utf8'); }
  catch (err) { return err && err.code === 'ENOENT' ? new Set() : null; }
  try {
    const j = JSON.parse(raw);
    return new Set((Array.isArray(j && j.ids) ? j.ids : []).filter((x) => typeof x === 'string'));
  } catch { return null; }
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
    const capOf = (l) => (l && l.on === true && Number.isInteger(l.perHour) ? l.perHour : Infinity);
    let cap = capOf(o.limit);
    const nudgeable = require('./agentnudge').nudgeableCard;
    const gap = Number.isFinite(o.betweenAgentsMs) ? o.betweenAgentsMs : 1000;
    /* Review 1 (Opus): READ FIRST, TYPE AFTER. Every agent's count is read (paced, the read lock held only while
       reading), and only then is anything typed, so an agent that reads its replies the moment it is told never meets
       this pass's lock. */
    const counted = [];
    let readOne = false;   // review 2: the gap follows EVERY read that asked the service since the last gap, counted or not
    /* Review 8 (Opus): the pass starts AFTER the last agent asked last pass (o.rotation, kept by the caller), so a pass
       that ends early (a refusing service, the hour cap) does not starve the same later agents every time, and an agent
       whose posts end the count goes to the back. Without o.rotation, roster order. */
    const rot = o.rotation && typeof o.rotation === 'object' ? o.rotation : null;
    let order = o.roster;
    if (rot && rot.after) {
      const at = o.roster.findIndex((c) => c && c.sessionName === rot.after);
      if (at >= 0) order = o.roster.slice(at + 1).concat(o.roster.slice(0, at + 1));
    }
    for (const card of order) {
      const session = card && card.sessionName;
      if (!session || !nudgeable(card)) continue;   // nothing is read for an agent that would not be nudged
      if (stoodDown(session, o.projects)) continue;
      /* Review 4 (Opus): an agent held on its machine's shared Google quota is not read and takes no cap slot: delivery
         would hold it (no try counted), so it would fill a slot every pass until the reset and starve later agents. */
      if (typeof o.quotaHeld === 'function') {
        let q = false; try { q = o.quotaHeld(session, o.roster) === true; } catch { q = false; }   // review 6: the pass's roster, no new snapshot
        if (q) { results.push({ session, name: plainWords(card.name || session, 80), act: 'quota-held', because: 'its machine\'s shared Google quota is out' }); continue; }
      }
      prune();   // review 8: the hour's log ages out during a long pass too
      if (sent.length + counted.length >= cap) break;   // review 1: the hour's cap is met: read no further this pass
      try {
        // Review 2: only replies it has NOT been told about count (and take a cap slot); told-but-unread ones wait for its read.
        /* Review 4 (Opus): the told record is read BEFORE the service is asked, so an agent whose record cannot be read
           costs no requests, and the skip is said once (not every pass) so the reason is on record. */
        const told = o.readNudged(session);
        if (!(told instanceof Set)) {
          const because = 'its told record could not be read';
          results.push({ session, name: plainWords(card.name || session, 80), act: 'skipped', because });
          const m = book.get(session) || {};
          if (!m.skipSaid) { say({ name: plainWords(card.name || session, 80), session, act: 'skipped', because }); book.set(session, { ...m, skipSaid: true }); }
          continue;
        }
        if (readOne && gap > 0) await new Promise((res) => setTimeout(res, gap));
        readOne = false;
        let fresh = await o.fresh(session);
        if (!(fresh && fresh.asked === 0)) readOne = true;   // review 9: a count that asked the service nothing costs no gap
        /* Review 6 (Opus): a count that stepped aside for an agent's own read would leave every later agent busy too (the
           read holds the lock for seconds). So a busy count waits for the read and asks again, up to BUSY_RETRIES times.
           A service that refuses (429, or not answering) ends the counting for this pass: its budget is the agents'. */
        // Review 10: a partial count (a post it could not read) is not asked again this pass: nothing changes in 20 s.
        for (let i = 0; fresh && fresh.busy && !fresh.stop && !fresh.partial && i < BUSY_RETRIES; i += 1) {
          const wait = Number.isFinite(o.busyWaitMs) ? o.busyWaitMs : BUSY_WAIT_MS;
          if (wait > 0) await new Promise((res) => setTimeout(res, wait));
          fresh = await o.fresh(session);
        }
        if (rot) rot.after = session;   // review 8: it was asked; the next pass starts after it
        if (fresh && fresh.busy) {
          results.push({ session, name: plainWords(card.name || session, 80), act: 'busy', because: fresh.because });
          if (fresh.stop) break;
          continue;
        }
        const memo = book.get(session);
        if (memo && memo.told instanceof Set) for (const id of memo.told) told.add(id);
        const untold = fresh && fresh.ok === true && Array.isArray(fresh.posts) ? fresh.posts.flatMap((p) => (p.ids || []).filter((id) => !told.has(id))) : [];
        // Review 3 (Opus): a batch given up on (MAX_TRIES) takes no cap slot either, or it blocks later agents every pass.
        const givenUp = memo && memo.key === untold.slice().sort().join(',') && Number.isInteger(memo.tries) && memo.tries >= MAX_TRIES;
        if (untold.length && !givenUp) counted.push({ session, fresh });
      } catch (err) {
        results.push({ session, name: plainWords(card.name || session, 80), act: 'error', because: String((err && err.message) || err) });
      }
    }
    /* Review 2 (Opus): the lines are SPACED (typeGapMs, default TYPE_GAP_MS), so each agent told has the read lock to
       itself when it reads (two agents' own reads refuse each other, #4833). Review 1: so the card is read AGAIN before
       each line: an agent that started working (or was stood down) meanwhile is left for the next pass (#4624). */
    const typeGap = Number.isFinite(o.typeGapMs) ? o.typeGapMs : TYPE_GAP_MS;
    let typedOne = false;
    for (const { session, fresh } of counted) {
      try {
        if (typedOne && typeGap > 0) await new Promise((res) => setTimeout(res, typeGap));
        /* Review 3 (Opus): the gates are asked again before EVERY line (a person can switch the community or the
           Prompter off while this pass types), like the card below. */
        if (typeof o.gatesOpen === 'function') { let open = false; try { open = o.gatesOpen() === true; } catch { open = false; } if (!open) break; }
        // Review 4 (Opus): the hour's limit too, so a person who turns it on mid-pass is obeyed from the next line.
        if (typeof o.limitNow === 'function') { try { const l = o.limitNow(); if (l && typeof l === 'object') cap = capOf(l); } catch { /* keep the cap this pass began with */ } }
        let roster = o.roster;
        let projects = o.projects;
        if (typeof o.rosterNow === 'function') { let r = null; try { r = o.rosterNow(); } catch { r = null; } if (!Array.isArray(r)) continue; roster = r; }
        if (typeof o.projectsNow === 'function') { let r = null; try { r = o.projectsNow(); } catch { r = null; } if (!Array.isArray(r)) continue; projects = r; }
        const card = roster.find((x) => x && x.sessionName === session);
        const display = plainWords((card && card.name) || session, 80);
        const nudged = o.readNudged(session);
        if (!(nudged instanceof Set)) continue;   // review 3: unreadable record: skip, never re-tell
        const memo0 = book.get(session);
        if (memo0 && memo0.told instanceof Set) for (const id of memo0.told) nudged.add(id);
        /* Review 5 (Sonnet): the count may be minutes old by this line (lines are spaced). If the agent's read marks moved
           since, it read its replies meanwhile: the count is stale, so it is not told; the next pass counts afresh. */
        if (typeof o.marksNow === 'function' && fresh && fresh.marksAt != null) {
          let now = null; try { now = o.marksNow(session); } catch { now = null; }
          if (now !== fresh.marksAt) { results.push({ session, name: display, act: 'read-meanwhile', because: 'it read its replies after they were counted' }); continue; }
        }
        const p = plan(card, fresh, nudged, memo0, projects);
        if (p.act !== 'nudge') continue;
        prune();
        if (sent.length >= cap) { say({ name: display, session, act: 'held', because: 'Agent Communication\'s limit of ' + cap + ' an hour is reached' }); continue; }
        let state = null;
        let held = false;
        let paneBusy = false;
        typedOne = true;
        try { const r = o.deliver(session, nudgeText(p.posts), roster); state = r && r.state; held = Boolean(r && r.held === true); paneBusy = Boolean(r && r.busy === true); }
        catch (err) { state = 'threw: ' + String((err && err.message) || err); }
        /* Review 7 (Sonnet): a pane still placing another message is busy, not unreachable: no try is counted (as held).
           Review 8 (Opus): either is said once per change of state (as skipSaid), so it is on record without a line every pass. */
        if (held || paneBusy) {
          const act = held ? 'quota-held' : 'pane-busy';
          results.push({ session, name: display, act, delivered: false, delivery: state, because: p.because });
          const m = book.get(session) || {};
          if (m.waitSaid !== act) { say({ name: display, session, act, delivered: false, delivery: state, because: p.because }); book.set(session, { ...m, waitSaid: act }); }
          continue;
        }
        const D = o.DELIVERY || {};
        const delivered = D.PLACED != null && state === D.PLACED;
        const mayHaveReached = delivered || (D.UNCONFIRMED != null && state === D.UNCONFIRMED);
        const prev = book.get(session);
        const tries = (prev && prev.key === p.key && Number.isInteger(prev.tries) ? prev.tries : 0) + 1;
        if (mayHaveReached) {
          for (const id of p.ids) nudged.add(id);
          /* Review 2: if the store cannot be written, the ids are kept in memory too, so the next pass does not repeat. */
          if (o.writeNudged(session, nudged) === true) book.delete(session);
          else book.set(session, { told: new Set([...((memo0 && memo0.told) || []), ...p.ids]) });
          /* Review 1: when it went, not when the pass began. Review 2: kept in time order (agentnudge prunes from the front,
             assuming that order, and pushes its pass's start time). */
          const at = clock();
          let i = sent.length;
          while (i > 0 && sent[i - 1] > at) i -= 1;
          sent.splice(i, 0, at);
        } else {
          book.set(session, { key: p.key, tries, told: memo0 && memo0.told });   // review 3: keep any ids held in memory
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
    const gatesOpen = () => {
      let a = false; try { a = o.allowed() === true; } catch { a = false; }
      let p = false; try { p = o.prompterOn() === true; } catch { p = false; }
      let s = false; try { s = o.switchOn() === true; } catch { s = false; }
      return require('./agentnudge').nudgeEnabled(a, o.env) && p && s;
    };
    return (await sweepOnce({ ...o, roster, projects, limit, rosterNow: o.roster, projectsNow: o.readProjects, limitNow: o.readLimit, gatesOpen })).results;
  } catch { return null; }
}

module.exports = { BUSY_RETRIES, BUSY_WAIT_MS, plan, nudgeText, stoodDown, sweepOnce, tick, readNudged, writeNudged, nudgedFile, REPLY_NUDGE_INTERVAL_MS, MAX_TRIES, NUDGED_MAX, TYPE_GAP_MS };
