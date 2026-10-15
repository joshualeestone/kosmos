'use strict';
/**
 * kosmos#6209 part 3: a task left on hold while its work goes on in the project room. A user's agents kept working a
 * task with the person in its project room for days while the task stayed on hold, and nothing told either agent the
 * task's state no longer matched.
 *
 * Who is told: each holder of an open part of a held task that has posted in that project's room at least MIN_POSTS
 * times since the task was put on hold, once the hold is MIN_AGE_MS old. One line typed into its session through the
 * board's own typing path (chat.deliverAutomatic, as engine/missedtell.js and engine/agentnudge.js do), counted against
 * Agent Communication's limit. The line names the task, when it was put on hold and by whom, and how many posts the
 * owner made since, and asks the owner to take it off hold if its work is going on (or, for the person's own hold, to
 * ask the person), or to say on the task why it stays held. The posts are the room's, not the task's, so the held tasks
 * of one owner in one project that are owed in the same pass go in ONE line naming them all. A hold that becomes owed
 * later (it reached MIN_AGE_MS after the others were told) gets its own line.
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
   change there). Null when there is no hold-set event, or a hold-cleared after the last one (the record of a later hold
   failed: taskchat.record is best-effort). A clear AND a re-hold whose records both failed still read as the first
   hold, so posts from the gap would be counted; that costs at most one line per owner. */
function holdSet(projectId, n, read) {
  let events = [];
  try { events = read(projectId, n) || []; } catch { events = []; }
  let last = null;
  let cleared = -Infinity;
  for (const e of events) {
    if (!e) continue;
    const at = Date.parse(e.at);
    if (!Number.isFinite(at)) continue;
    if (e.kind === 'hold-cleared' && at > cleared) cleared = at;
    if (e.kind === 'hold-set' && (!last || at >= last.at)) last = { at, byPerson: e.via === 'screen' };
  }
  return last && cleared <= last.at ? last : null;
}

/* The owners owed a line now. Pure but for the task histories it reads (`o.read`, taskchat.read by default):
   `projects` as projects.readAll() gives them, `log` the message rows (messages.readLog()). */
function owed(projects, log, now = Date.now(), o = {}) {
  const tasks = require('./tasks');
  const read = typeof o.read === 'function' ? o.read : require('./taskchat').read;
  /* The room's posts by project and sender, read once per pass rather than once per held task and owner. */
  const posted = new Map();
  for (const r of Array.isArray(log) ? log : []) {
    if (!r || r.kind !== 'post' || typeof r.project !== 'string' || typeof r.from !== 'string') continue;
    const at = Date.parse(r.at);
    if (!Number.isFinite(at)) continue;
    const k = r.project + '\u0000' + r.from;
    if (!posted.has(k)) posted.set(k, []);
    posted.get(k).push(at);
  }
  const out = [];
  for (const p of Array.isArray(projects) ? projects : []) {
    if (!p || p.archived === true || require('./projects').isPaused(p)) continue;
    for (const t of Array.isArray(p.tasks) ? p.tasks : []) {
      if (!t || typeof t.number !== 'number' || !tasks.isOnHold(t) || tasks.progressOf(t).closed) continue;
      const hold = holdSet(p.id, t.number, read);
      if (!hold || now - hold.at < MIN_AGE_MS) continue;
      const told = t.holdStaleTold && typeof t.holdStaleTold === 'object' ? t.holdStaleTold : {};
      /* As missedtell's review 4: only holders of an open part. One whose part is done is not working this task. */
      const owners = [...new Set(tasks.partsOf(t).filter((x) => x && x.who && !x.closedAt).map((x) => x.who))];
      for (const owner of owners) {
        if (typeof owner !== 'string' || !owner) continue;
        if (Date.parse(told[owner]) === hold.at) continue;
        const posts = (posted.get(p.id + '\u0000' + owner) || []).filter((at) => at > hold.at).length;
        if (posts < MIN_POSTS) continue;
        out.push({
          projectId: p.id, project: typeof p.name === 'string' && p.name ? p.name : p.id, n: t.number, sentence: t.sentence || '',
          owner, holdAt: hold.at, byPerson: hold.byPerson || t.onHoldByPerson === true, posts,
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

/* The line an owner is sent, for its held tasks in one project (`group`, items of owed() for one owner and project). Names
   each task, its hold and the one way off it, and the owner's posts since the earliest hold. */
function tellText(group, now = Date.now()) {
  const items = (Array.isArray(group) ? group : [group]).slice().sort((x, y) => x.n - y.n);
  const first = items[0];
  const posts = Math.max(...items.map((x) => x.posts));
  /* As the nudge's review 3: a project id is typed into a command only when it is one the CLI takes as it is. */
  const idOf = (x) => (typeof x.projectId === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(x.projectId) && /[^.]/.test(x.projectId) ? x.projectId : '<project-id>');
  const unhold = (x) => 'kosmos task unhold ' + idOf(x) + ' ' + x.n;
  const list = (xs) => (xs.length < 3 ? xs.join(' and ') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);
  const one = (x) => 'task #' + x.n + ', "' + plain(x.sentence, 120) + '" (' + (x.byPerson ? 'the person put it on hold' : 'put on hold') + ' ' + agoWords(x.holdAt, now) + ' ago)';
  const theirs = items.filter((x) => x.byPerson);
  const mine = items.filter((x) => !x.byPerson);
  const ask = (n) => 'ask the person to take ' + (n === 1 ? 'it' : 'them') + ' off hold (only they can lift their own hold, on the screen)';
  let liftText;
  if (items.length === 1) liftText = 'If its work is going on, ' + (first.byPerson ? ask(1) : 'take it off hold: ' + unhold(first));
  else {
    const parts = [];
    if (mine.length) parts.push((mine.length === 1 ? 'take #' + mine[0].n + ' off hold: ' : 'take them off hold: ') + mine.map(unhold).join(', then '));
    if (theirs.length) parts.push((mine.length ? 'for ' + list(theirs.map((x) => '#' + x.n)) + ', ' : '') + ask(theirs.length));
    liftText = 'If their work is going on, ' + parts.join('; ');
  }
  return 'Kosmos: ' + (items.length === 1 ? one(first) + ' in ' + plain(first.project, 80) + ' is still on hold'
    : list(items.map(one)) + ' in ' + plain(first.project, 80) + ' are still on hold')
    + ', but you have posted ' + posts + ' times in ' + (items.length === 1 ? 'its' : 'their') + ' project room since then. '
    + liftText + '. If ' + (items.length === 1 ? 'it' : 'one') + ' should stay on hold, say why on the task.';
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
 * One pass. `o`: { projects, rows (messages.readLog()), items (owed()'s answer, when the caller already has it), roster, now, allowed (live execution and the brake), limit ({ on, perHour }), sent
 * (the board-wide hour of Kosmos-to-agent lines, shared with the nudge), book (Map of { tries | told, at } per owner, project
 * and the held tasks told together; a tries entry is dropped 30 days after it was written, a told one never), idleSeen
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
    /* Review 7: an entry is pruned by when it was WRITTEN, not by how old its hold is. A hold can last longer than any
       window, and pruning by the hold's age wiped its tries every pass, so it was retried every minute for ever. */
    /* Review 8: a told entry is never pruned (its group is told once; keys are bounded by the holds there are), so a group
       whose mark on the task was lost is not retyped a month later. */
    for (const [k, e] of [...book.entries()]) if (!e || typeof e !== 'object' || (e.told !== true && (!Number.isFinite(e.at) || now - e.at > 30 * 24 * HOUR_MS))) book.delete(k);
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
    const items = Array.isArray(o.items) ? o.items : owed(o.projects, o.rows, now, { read: o.read });
    const groups = new Map();
    for (const it of items) { const k = it.owner + '\u0000' + it.projectId; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); }
    for (const group of groups.values()) {
      const item = group[0];
      try {
        const key = item.projectId + ':' + item.owner + '@' + group.map((x) => x.n + '/' + x.holdAt).sort().join(',');
        const markAll = (outcome) => { for (const x of group) markTold(x, outcome); };
        if ((book.get(key) || {}).told === true) { results.push({ ...item, act: 'held', because: 'already told; its mark could not be saved' }); continue; }
        if (!item.members.includes(item.owner)) { markAll('not reached'); results.push({ ...item, act: 'unreachable', because: 'the owner is no longer on the project' }); continue; }
        if (item.swarmOff) { markAll('not reached'); results.push({ ...item, act: 'unreachable', because: 'the owner is switched off in this project' }); continue; }
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
        try { const r = o.deliver(item.owner, tellText(group, now), o.roster); state = r && r.state; wait = Boolean(r && (r.held === true || r.busy === true)); }
        catch { state = (o.DELIVERY && o.DELIVERY.UNCONFIRMED) || 'unconfirmed'; }   // a throw may have arrived: told, never retyped
        if (wait) { results.push({ ...item, act: 'held', because: 'the owner cannot take a line just now', delivery: state }); continue; }
        const D = o.DELIVERY || {};
        const reached = (D.PLACED != null && state === D.PLACED) || (D.UNCONFIRMED != null && state === D.UNCONFIRMED);
        const tries = (Number((book.get(key) || {}).tries) || 0) + 1;
        if (reached) { sent.push(now); book.set(key, { told: true, at: now }); markAll('reached'); }
        else if (tries >= MAX_TRIES) { book.set(key, { told: true, at: now }); markAll('not reached'); }
        else book.set(key, { tries, at: now });
        results.push({ ...item, tasks: group.map((x) => x.n), act: 'tell', reached, delivery: state, tries });
        say({ owner: item.owner, task: group.map((x) => x.n).join(','), project: item.projectId, reached, delivery: state, tries });
      } catch (err) {
        results.push({ ...item, act: 'error', because: String((err && err.message) || err) });
      }
    }
  } catch { /* never throws: a pass is best-effort */ }
  return { results };
}

module.exports = { owed, tellText, markTold, sweep, holdSet, MAX_TRIES, MIN_POSTS, MIN_AGE_MS };
