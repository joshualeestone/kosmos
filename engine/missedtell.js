'use strict';
/**
 * kosmos#4787 slice 3: a repeating task's named reviewer is told when a run is missed, ONCE per missed slot.
 *
 * Who is told: the reviewer the task names (tasks.setReviewer), never the owner (slice 1's agent nudge already asks the
 * owner to do open work). An AGENT reviewer gets one line typed into its session through the board's own typing path
 * (chat.deliverAutomatic, as engine/agentnudge.js does), counted against Agent Communication's limit. The PERSON as
 * reviewer is told by the task itself: while a run is missed it is in Needs Your Decision (personReviewMissed, read by
 * the Tasks route), and the history says so. Either way the task's history records the miss and who was told.
 *
 * Once: the task stores the slot it last told about (missToldAt). A slot is told only when it is newer than that, and
 * never a slot that passed before the reviewer was named. Nothing in a paused project or on a held task is told about
 * (#4771: Kosmos neither nudges nor hands those out). A delivery that reached nothing is tried again on later sweeps,
 * up to MAX_TRIES for one slot, then recorded as not reached so it never repeats for ever.
 */
const taskrepeat = require('./taskrepeat');

const MAX_TRIES = 3;
/* Review 10: a reviewer is typed into only after it has been seen idle for a minute (two passes in a row), as the nudge and
   the reply nudge wait for an idle that has lasted, so a line never lands the instant it finishes answering the person. */
const SETTLED_MS = 50 * 1000;
const SEEN_GAP_MS = 90 * 1000;   // a sighting older than this is not "the previous pass": the reviewer may have worked since
const HOUR_MS = 60 * 60 * 1000;

/* One line of plain words, as the nudge writes them (agentnudge.plainWords: control characters and quotes out, so the
   board's typing path never refuses the line, review 9). */
function plain(s, max) { return require('./agentnudge').plainWords(s, max); }

/* The tasks whose reviewer is owed a line now: open, repeating, reviewed, with a missed slot newer than the last one
   told and not before the reviewer was named. Pure: `projects` as projects.readAll() gives them. */
function owed(projects, now = Date.now()) {
  const tasks = require('./tasks');
  const out = [];
  for (const p of Array.isArray(projects) ? projects : []) {
    if (!p || p.archived === true || require('./projects').isPaused(p)) continue;
    for (const t of Array.isArray(p.tasks) ? p.tasks : []) {
      if (!t || !t.repeat || (!t.repeatReviewer && t.repeatReviewerPerson !== true)) continue;
      if (tasks.isOnHold(t) || tasks.progressOf(t).closed) continue;
      const missed = taskrepeat.missedRuns(t, now);
      if (!missed) continue;
      const told = Date.parse(t.missToldAt || '');
      if (Number.isFinite(told) && missed.lastAt <= told) continue;
      const named = Date.parse(t.repeatReviewerSetAt || '');
      if (Number.isFinite(named) && missed.lastAt < named) continue;
      out.push({
        projectId: p.id, project: typeof p.name === 'string' && p.name ? p.name : p.id, n: t.number, sentence: t.sentence || '',
        slot: missed.lastAt, count: missed.count, more: missed.more, words: taskrepeat.whenWords(missed.lastAt, now),
        reviewer: t.repeatReviewerPerson === true ? null : t.repeatReviewer, person: t.repeatReviewerPerson === true,
        /* Review 4: who RUNS it now: holders of an open part (as the nudge's openParts), never one whose part is done. */
        // Review 8: a reviewer whose swarm is switched off in THIS project is held, as the nudge and the reply nudge do.
        swarmOff: t.repeatReviewer ? require('./projects').isSwarmOff(p, t.repeatReviewer) : false,
        owners: [...new Set(tasks.partsOf(t).filter((x) => x && x.who && !x.closedAt).map((x) => x.who))], members: Array.isArray(p.agents) ? p.agents.slice() : [],
      });
    }
  }
  return out;
}

/* The line an agent reviewer is sent. Names the task, the run, and its owner, so the reviewer can act without a lookup. */
function tellText(item, nameOf = (s) => s) {
  const self = (item.owners || []).includes(item.reviewer);   // review 5: the reviewer may run it too
  const owners = (item.owners || []).filter((s) => s !== item.reviewer).map((s) => plain(nameOf(s), 60)).filter(Boolean);
  const runs = item.count > 1 || item.more ? (item.more ? 'more than ' + item.count : item.count) + ' runs, the latest due ' + item.words : 'its run due ' + item.words;
  return 'Kosmos: task #' + item.n + ' in ' + plain(item.project, 80) + ', "' + plain(item.sentence, 160) + '", missed ' + runs + '. '
    + (self ? 'You run it and review its results' : 'You review its results') + (owners.length ? '; ' + owners.join(' and ') + (owners.length > 1 ? ' run it' : ' runs it') + (self ? ' too' : '') : '') + '. '
    + 'Check whether it ran and tell the person if something is wrong.';
}

/* Is a run missed on a task whose reviewer is the person? Then it waits on the person (Needs Your Decision). Review 1:
   never a held task or one in a paused project (owed() tells nobody about those either: parking it means "not now"). */
function personReviewMissed(t, now = Date.now()) {
  if (!t || t.repeatReviewerPerson !== true || !t.repeat || t.projectPaused === true) return false;
  if (require('./tasks').isOnHold(t)) return false;
  const missed = taskrepeat.missedRuns(t, now);
  if (!missed) return false;
  /* Review 8: as owed(), a miss from before the person asked to be told is not put on them. */
  const named = Date.parse(t.repeatReviewerSetAt || '');
  return !(Number.isFinite(named) && missed.lastAt < named);
}

/* Store that `slot` was told about, and record it in the task's history. */
function markTold(item, outcome) {
  const projects = require('./projects');
  const taskchat = require('./taskchat');
  projects.mutate(item.projectId, (p) => ({
    ...p,
    tasks: (p.tasks || []).map((x) => (x && x.number === item.n ? { ...x, missToldAt: new Date(item.slot).toISOString() } : x)),
  }));
  taskchat.record(item.projectId, item.n, {
    kind: 'missed', slot: new Date(item.slot).toISOString(), count: item.count, ...(item.more ? { more: true } : {}),   // review 1: taskchat stamps its own `at`
    ...(item.person ? { person: true } : { told: item.reviewer, reached: outcome === 'reached' }),
  });
}

/**
 * One pass. `o`: { projects (readAll's list), roster, now, allowed (bool: live execution and the brake), limit
 * ({ on, perHour }), sent (the board-wide hour of Kosmos-to-agent lines, shared with the nudge), book (Map, tries per
 * task and slot), deliver(session, text, roster) -> { state }, DELIVERY, nameOf, log }. Never throws.
 */
function sweep(o) {
  const results = [];
  try {
    const now = Number.isFinite(o.now) ? o.now : Date.now();
    const book = o.book instanceof Map ? o.book : new Map();
    const sent = Array.isArray(o.sent) ? o.sent : [];
    while (sent.length && now - sent[0] >= HOUR_MS) sent.shift();
    // The book is memory: a slot older than a week is long past being owed, so its entry is dropped.
    for (const k of [...book.keys()]) { const slot = Number(String(k).split('@').pop()); if (Number.isFinite(slot) && now - slot > 7 * 24 * HOUR_MS) book.delete(k); }
    const cap = o.limit && o.limit.on === true && Number.isInteger(o.limit.perHour) ? o.limit.perHour : Infinity;
    const cards = new Map((Array.isArray(o.roster) ? o.roster : []).filter((a) => a && a.sessionName).map((a) => [a.sessionName, a]));
    /* Review 10: when each card was first seen idle in an unbroken run of passes (`o.idleSeen`, kept across passes). */
    const seen = o.idleSeen instanceof Map ? o.idleSeen : new Map();
    const nudgeable = require('./agentnudge').nudgeableCard;
    for (const [sn, c] of cards) {
      if (!nudgeable(c)) { seen.delete(sn); continue; }
      const e = seen.get(sn);
      seen.set(sn, e && now - e.at <= SEEN_GAP_MS ? { since: e.since, at: now } : { since: now, at: now });
    }
    /* Review 10: one line per reviewer per pass. The roster is read once, so a second line would see the reviewer idle
       although the first may have raised a prompt its Enter could answer. */
    const typedTo = new Set();
    const say = (r) => { if (typeof o.log === 'function') { try { o.log(r); } catch { /* never breaks a pass */ } } };
    for (const item of owed(o.projects, now)) {
      try {
        const key = item.projectId + '#' + item.n + '@' + item.slot;
        /* Review 1: a slot typed in this process is never typed again, even when its told mark could not be written. */
        if (book.get(key) === 'told') { results.push({ ...item, act: 'held', because: 'already told; its mark could not be saved' }); continue; }
        if (item.person) { markTold(item, 'person'); results.push({ ...item, act: 'person' }); continue; }
        // Review 1: a reviewer taken off the project is not typed into about its tasks (#5034's member boundary).
        if (!item.members.includes(item.reviewer)) { results.push({ ...item, act: 'held', because: 'the reviewer is no longer on the project' }); continue; }
        if (item.swarmOff) { results.push({ ...item, act: 'held', because: 'the reviewer is switched off in this project' }); continue; }
        if (o.allowed !== true) { results.push({ ...item, act: 'held', because: 'Kosmos does not type into agents yet' }); continue; }
        const card = cards.get(item.reviewer);
        if (!card) { results.push({ ...item, act: 'held', because: 'the reviewer is not running' }); continue; }
        /* Review 9: the nudge's card rule WHOLE (agentnudge.nudgeableCard): ours, not a switched-off swarm, and IDLE. Typed
           into a pane stopped on a permission prompt, "...and Enter" can answer it; a rate-limited or signed-out session
           cannot take it either. Held with no try spent; it goes on a later minute, once the reviewer is idle. */
        if (!nudgeable(card)) { results.push({ ...item, act: 'held', because: 'the reviewer is not idle, or cannot be typed into' }); continue; }
        if (typedTo.has(item.reviewer)) { results.push({ ...item, act: 'held', because: 'one line to a reviewer per minute' }); continue; }
        const idle = seen.get(item.reviewer);
        if (!idle || now - idle.since < SETTLED_MS) { results.push({ ...item, act: 'held', because: 'the reviewer has only just gone idle' }); continue; }
        if (sent.length >= cap) { results.push({ ...item, act: 'held', because: 'Agent Communication\'s limit of ' + cap + ' an hour is reached' }); continue; }
        typedTo.add(item.reviewer);
        let state = null;
        let wait = false;
        try { const r = o.deliver(item.reviewer, tellText(item, o.nameOf), o.roster); state = r && r.state; wait = Boolean(r && (r.held === true || r.busy === true)); }
        catch (err) { state = 'threw: ' + String((err && err.message) || err); }
        /* Review 1, as the nudge and the reply nudge: a quota hold or a pane still placing another message typed nothing,
           so no try is spent (the slot is told after the reset, not given up on). */
        if (wait) { results.push({ ...item, act: 'held', because: 'the reviewer cannot take a line just now', delivery: state }); continue; }
        const D = o.DELIVERY || {};
        const reached = (D.PLACED != null && state === D.PLACED) || (D.UNCONFIRMED != null && state === D.UNCONFIRMED);
        const tries = (Number(book.get(key)) || 0) + 1;
        if (reached) { sent.push(now); book.set(key, 'told'); markTold(item, 'reached'); }
        else if (tries >= MAX_TRIES) { book.set(key, 'told'); markTold(item, 'not reached'); }
        else book.set(key, tries);
        results.push({ ...item, act: 'tell', reached, delivery: state, tries });
        say({ reviewer: item.reviewer, task: item.n, project: item.projectId, reached, delivery: state, tries });
      } catch (err) {
        results.push({ ...item, act: 'error', because: String((err && err.message) || err) });
      }
    }
  } catch { /* never throws: a pass is best-effort */ }
  return { results };
}

module.exports = { owed, tellText, personReviewMissed, markTold, sweep, MAX_TRIES };
