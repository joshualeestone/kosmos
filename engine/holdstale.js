'use strict';
/**
 * kosmos#6209 part 3: a task left on hold while its work goes on in the project room. A user's agents kept working a
 * task with the person in its project room for days while the task stayed on hold, and nothing told either agent the
 * task's state no longer matched.
 *
 * Who is told: each owner of an open, held task (tasks.whoOf) that has posted in that project's room at least MIN_POSTS
 * times since the task was put on hold, once the hold is MIN_AGE_MS old. One line typed into its session through the
 * board's own typing path (chat.deliverAutomatic, as engine/missedtell.js and engine/agentnudge.js do), counted against
 * Agent Communication's limit. The line names the task, when it was put on hold and by whom, and how many posts the
 * owner made since, and asks the owner to take it off hold if its work is going on (or, for the person's own hold, to
 * ask the person), or to say on the task why it stays held.
 *
 * Once: the task stores, per owner, the hold it was told about (holdStaleTold: { <owner>: <hold time> }). A new hold
 * (taken off and put back) can be told about again. A delivery that reached nothing is tried again on later sweeps, up
 * to MAX_TRIES for one hold, then recorded as not reached. Nothing in a paused project is told about.
 */

const MAX_TRIES = 3;
const MIN_POSTS = 3;
const MIN_AGE_MS = 2 * 60 * 60 * 1000;
/* As missedtell: typed into only after it has been seen idle for a minute, so a line never lands the instant it
   finishes answering the person. */
const SETTLED_MS = 50 * 1000;
const SEEN_GAP_MS = 90 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function plain(s, max) { return require('./agentnudge').plainWords(s, max); }

/* When the task was last put on hold, and whether the person did it, from its own history (setOnHold records each
   change there). Null when the history has no hold-set event (a hold written before the history recorded one). */
function holdSet(projectId, n, read) {
  let events = [];
  try { events = read(projectId, n) || []; } catch { events = []; }
  let last = null;
  for (const e of events) {
    if (!e || e.kind !== 'hold-set') continue;
    const at = Date.parse(e.at);
    if (Number.isFinite(at) && (!last || at >= last.at)) last = { at, byPerson: e.via === 'screen' };
  }
  return last;
}

/* The owners owed a line now. Pure but for the task histories it reads (`o.read`, taskchat.read by default):
   `projects` as projects.readAll() gives them, `log` the message rows (messages.readLog()). */
function owed(projects, log, now = Date.now(), o = {}) {
  const tasks = require('./tasks');
  const read = typeof o.read === 'function' ? o.read : require('./taskchat').read;
  const rows = Array.isArray(log) ? log : [];
  const out = [];
  for (const p of Array.isArray(projects) ? projects : []) {
    if (!p || p.archived === true || require('./projects').isPaused(p)) continue;
    for (const t of Array.isArray(p.tasks) ? p.tasks : []) {
      if (!t || typeof t.number !== 'number' || !tasks.isOnHold(t) || tasks.progressOf(t).closed) continue;
      const hold = holdSet(p.id, t.number, read);
      if (!hold || now - hold.at < MIN_AGE_MS) continue;
      const told = t.holdStaleTold && typeof t.holdStaleTold === 'object' ? t.holdStaleTold : {};
      for (const owner of tasks.whoOf(t)) {
        if (typeof owner !== 'string' || !owner) continue;
        if (Date.parse(told[owner]) === hold.at) continue;
        let posts = 0;
        let lastAt = 0;
        for (const r of rows) {
          if (!r || r.kind !== 'post' || r.project !== p.id || r.from !== owner) continue;
          const at = Date.parse(r.at);
          if (!Number.isFinite(at) || at <= hold.at) continue;
          posts += 1;
          if (at > lastAt) lastAt = at;
        }
        if (posts < MIN_POSTS) continue;
        out.push({
          projectId: p.id, project: typeof p.name === 'string' && p.name ? p.name : p.id, n: t.number, sentence: t.sentence || '',
          owner, holdAt: hold.at, byPerson: hold.byPerson || t.onHoldByPerson === true, posts, lastAt,
          members: Array.isArray(p.agents) ? p.agents.slice() : [],
          swarmOff: require('./projects').isSwarmOff(p, owner),
        });
      }
    }
  }
  return out;
}

/* How long ago, in words a line can carry ("3 days", "5 hours"). */
function agoWords(at, now) {
  const h = Math.max(1, Math.round((now - at) / HOUR_MS));
  if (h < 48) return h + (h === 1 ? ' hour' : ' hours');
  const d = Math.round(h / 24);
  return d + ' days';
}

/* The line an owner is sent. Names the task, the hold and the room activity, and the one command that lifts it. */
function tellText(item, now = Date.now()) {
  const who = item.byPerson ? 'the person put it on hold' : 'it was put on hold';
  const lift = item.byPerson
    ? 'If its work is going on, ask the person to take it off hold (only they can lift their own hold, on the screen)'
    : 'If its work is going on, take it off hold: kosmos task unhold ' + item.projectId + ' ' + item.n;
  return 'Kosmos: task #' + item.n + ' in ' + plain(item.project, 80) + ', "' + plain(item.sentence, 160) + '", is still on hold ('
    + who + ' ' + agoWords(item.holdAt, now) + ' ago), but you have posted ' + item.posts + ' times in its project room since then. '
    + lift + '. If it should stay on hold, say why on the task.';
}

/* Store that `owner` was told about this hold, and record it in the task's history. */
function markTold(item, outcome) {
  const projects = require('./projects');
  const taskchat = require('./taskchat');
  const at = new Date(item.holdAt).toISOString();
  projects.mutate(item.projectId, (p) => ({
    ...p,
    tasks: (p.tasks || []).map((x) => (x && x.number === item.n
      ? { ...x, holdStaleTold: { ...(x.holdStaleTold && typeof x.holdStaleTold === 'object' ? x.holdStaleTold : {}), [item.owner]: at } }
      : x)),
  }));
  taskchat.record(item.projectId, item.n, { kind: 'hold-stale', hold: at, told: item.owner, posts: item.posts, reached: outcome === 'reached' });
}

/**
 * One pass. `o`: { projects, rows (messages.readLog()), roster, now, allowed (live execution and the brake), limit ({ on, perHour }), sent
 * (the board-wide hour of Kosmos-to-agent lines, shared with the nudge), book (Map, tries per owner and hold), idleSeen
 * (Map), idleSince(session), deliver(session, text, roster) -> { state }, DELIVERY, read (task history), log }.
 * Never throws.
 */
function sweep(o) {
  const results = [];
  try {
    const now = Number.isFinite(o.now) ? o.now : Date.now();
    const book = o.book instanceof Map ? o.book : new Map();
    const sent = Array.isArray(o.sent) ? o.sent : [];
    while (sent.length && now - sent[0] >= HOUR_MS) sent.shift();
    for (const k of [...book.keys()]) { const at = Number(String(k).split('@').pop()); if (Number.isFinite(at) && now - at > 30 * 24 * HOUR_MS) book.delete(k); }
    const cap = o.limit && o.limit.on === true && Number.isInteger(o.limit.perHour) ? o.limit.perHour : Infinity;
    const cards = new Map((Array.isArray(o.roster) ? o.roster : []).filter((a) => a && a.sessionName).map((a) => [a.sessionName, a]));
    const seen = o.idleSeen instanceof Map ? o.idleSeen : new Map();
    const nudgeable = require('./agentnudge').nudgeableCard;
    for (const [sn, c] of cards) {
      if (!nudgeable(c)) { seen.delete(sn); continue; }
      const e = seen.get(sn);
      seen.set(sn, e && now - e.at <= SEEN_GAP_MS ? { since: e.since, at: now } : { since: now, at: now });
    }
    const typedTo = new Set();   // one line per owner per pass
    const say = (r) => { if (typeof o.log === 'function') { try { o.log(r); } catch { /* never breaks a pass */ } } };
    for (const item of owed(o.projects, o.rows, now, { read: o.read })) {
      try {
        const key = item.projectId + '#' + item.n + ':' + item.owner + '@' + item.holdAt;
        if (book.get(key) === 'told') { results.push({ ...item, act: 'held', because: 'already told; its mark could not be saved' }); continue; }
        if (!item.members.includes(item.owner)) { markTold(item, 'not reached'); results.push({ ...item, act: 'unreachable', because: 'the owner is no longer on the project' }); continue; }
        if (item.swarmOff) { markTold(item, 'not reached'); results.push({ ...item, act: 'unreachable', because: 'the owner is switched off in this project' }); continue; }
        if (o.allowed !== true) { results.push({ ...item, act: 'held', because: 'Kosmos does not type into agents yet' }); continue; }
        const card = cards.get(item.owner);
        if (!card) { results.push({ ...item, act: 'held', because: 'the owner is not running' }); continue; }
        if (!nudgeable(card)) { results.push({ ...item, act: 'held', because: 'the owner is not idle, or cannot be typed into' }); continue; }
        if (typedTo.has(item.owner)) { results.push({ ...item, act: 'held', because: 'one line to an owner per minute' }); continue; }
        let since = null;
        if (typeof o.idleSince === 'function') { try { since = o.idleSince(item.owner); } catch { since = null; } }
        if (!Number.isFinite(since)) { const idle = seen.get(item.owner); since = idle ? idle.since : null; }
        if (!Number.isFinite(since) || now - since < SETTLED_MS) { results.push({ ...item, act: 'held', because: 'the owner has only just gone idle' }); continue; }
        if (sent.length >= cap) { results.push({ ...item, act: 'held', because: 'Agent Communication\'s limit of ' + cap + ' an hour is reached' }); continue; }
        typedTo.add(item.owner);
        seen.delete(item.owner);
        let state = null;
        let wait = false;
        try { const r = o.deliver(item.owner, tellText(item, now), o.roster); state = r && r.state; wait = Boolean(r && (r.held === true || r.busy === true)); }
        catch { state = (o.DELIVERY && o.DELIVERY.UNCONFIRMED) || 'unconfirmed'; }   // a throw may have arrived: told, never retyped
        if (wait) { results.push({ ...item, act: 'held', because: 'the owner cannot take a line just now', delivery: state }); continue; }
        const D = o.DELIVERY || {};
        const reached = (D.PLACED != null && state === D.PLACED) || (D.UNCONFIRMED != null && state === D.UNCONFIRMED);
        const tries = (Number(book.get(key)) || 0) + 1;
        if (reached) { sent.push(now); book.set(key, 'told'); markTold(item, 'reached'); }
        else if (tries >= MAX_TRIES) { book.set(key, 'told'); markTold(item, 'not reached'); }
        else book.set(key, tries);
        results.push({ ...item, act: 'tell', reached, delivery: state, tries });
        say({ owner: item.owner, task: item.n, project: item.projectId, reached, delivery: state, tries });
      } catch (err) {
        results.push({ ...item, act: 'error', because: String((err && err.message) || err) });
      }
    }
  } catch { /* never throws: a pass is best-effort */ }
  return { results };
}

module.exports = { owed, tellText, markTold, sweep, holdSet, MAX_TRIES, MIN_POSTS, MIN_AGE_MS };
