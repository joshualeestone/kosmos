'use strict';
/**
 * kosmos#8581: a repeating task that is due is told to its holder, ONCE per due slot, even with the Prompter off.
 *
 * Why: Kosmos never STARTS a repeat (taskrepeat.js): its holder is nudged and reports with `kosmos task ran`. That
 * nudge lived only in the Prompter's tick (agentnudge.prompterTick), so on a Mac with the Prompter off a daily repeat
 * was never told to anybody and simply stopped (two daily tasks went 27 days with no run, the agent idle the whole time).
 *
 * Why this is not an "unprompted line" (holdstale's review 5): the holder set the schedule. A repeat that says "every
 * day at 9:30am" is the request to be reminded at 9:30, as a named reviewer asked to be told of a miss (missedtell.js,
 * which runs with the Prompter off for the same reason).
 *
 * With the Prompter ON this sweep does nothing: prompterTick already nudges an idle holder about a due run, and two
 * lines for one run would be noise. The caller passes `prompterOn`.
 *
 * kosmos#8586: a holder that cannot be reached (off the project) is recorded once per stall, not once per slot
 * (markTold's stall mark, repeatDueQuiet).
 *
 * Once: the task stores the latest due slot it told about (repeatDueToldAt). A slot is told only when it is newer than
 * that. While one stall lasts (no run since the last line), it is told again only stallSlots() slots on.
 * Nothing in a paused project, on a held task, closed, or for a
 * holder switched off in the project is told (#4771). One holder per slot: the first idle holder told answers it,
 * because one `kosmos task ran` answers the slot for the whole task. A delivery that reached nothing is tried again on
 * later sweeps, up to MAX_TRIES for one slot, then recorded as not reached so it never repeats for ever.
 *
 * The delivery loop is missedtell.sweep's, gate for gate (idle and settled, one line per agent per pass, the
 * Agent Communication limit, a hold spends no try, a throw counts as told). It is copied rather than shared because
 * that loop carries thirteen reviews' worth of tuning for its own case and a refactor of it is not this card.
 */
const taskrepeat = require('./taskrepeat');

const MAX_TRIES = 3;
const SETTLED_MS = 50 * 1000;
const SEEN_GAP_MS = 90 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/* How many of the rule's own slots past the last one told a stalled repeat waits before it is told again. Counted from
   the slots in the 24 hours after `from` (nextAfter, local time). */
const PERDAY_WALK_CAP = 24 * 60;
function stallSlots(rule, from) {
  let perDay = 0;
  let s = from;
  while (perDay < PERDAY_WALK_CAP) { s = taskrepeat.nextAfter(rule, s); if (s === null || s > from + DAY_MS) break; perDay += 1; }
  return Math.max(1, Math.min(perDay, Math.max(4, Math.round(perDay / 24))));
}
/* Have `need` slots of `rule` come after `from`, by `at`? */
function slotsReached(rule, from, at, need) {
  let s = from;
  for (let n = 0; n < need; n += 1) { s = taskrepeat.nextAfter(rule, s); if (s === null || s > at) return false; }
  return true;
}

/* Does the missed-run tell (missedtell.js) take task `t`'s slot `at`, or has it told it already? Asked of its own
   owed(), so the two sweeps cannot disagree about whose slot it is. */
function missedTellTakes(p, t, at, now) {
  const told = Date.parse(t.missToldAt || '');
  if (Number.isFinite(told) && told >= at) return true;
  return require('./missedtell').owed([{ ...p, tasks: [t] }], now).some((i) => i.n === t.number && i.slot === at);
}

function plain(s, max) { return require('./agentnudge').plainWords(s, max); }

/* The tasks whose holder is owed a line now: open, repeating, due, not on hold, in a live project, with a latest due
   slot newer than the last one told. Pure: `projects` as projects.readAll() gives them. */
function owed(projects, now = Date.now()) {
  const tasks = require('./tasks');
  const P = require('./projects');
  const out = [];
  for (const p of Array.isArray(projects) ? projects : []) {
    if (!p || p.archived === true || P.isPaused(p)) continue;
    for (const t of Array.isArray(p.tasks) ? p.tasks : []) {
      if (!t || !t.repeat) continue;
      if (tasks.isOnHold(t) || tasks.progressOf(t).closed) continue;
      /* The run is owed when taskrepeat.missedRuns says so (its miss grace and early-answer rule), the same rule the
         missed-run tell and the task's missed count use, so the three never disagree about one run. */
      const missed = taskrepeat.missedRuns(t, now);
      if (!missed || missed.lastAt === null) continue;
      const at = missed.lastAt;
      /* A rule set or changed after the last line starts afresh: the old rule's line says nothing about the new one. */
      const toldRaw = Date.parse(t.repeatDueToldAt || '');
      const told = Number.isFinite(toldRaw) && !(Date.parse(t.repeatSetAt || '') > toldRaw) ? toldRaw : NaN;
      if (Number.isFinite(told) && at <= told) continue;
      const ranSince = Date.parse(t.lastRunAt || '') > told;
      if (Number.isFinite(told) && !ranSince && !slotsReached(t.repeat, told, at, stallSlots(t.repeat, told))) continue;
      const everyHolder = [...new Set(tasks.partsOf(t).filter((x) => x && x.who && !x.closedAt).map((x) => x.who))]
        .filter((who) => !P.isSwarmOff(p, who));
      const holders = everyHolder
        /* A holder that is also the task's named reviewer is told by the missed-run tell (missedtell.tellText's "You run
           it and review its results"), never by both; but only when that tell takes this slot or already took it. A
           slot missed before the reviewer was named is not the missed-run tell's (kosmos#8586), so it is told here. */
        .filter((who) => who !== t.repeatReviewer || !missedTellTakes(p, t, at, now));
      if (!holders.length) continue;
      const by = taskrepeat.recordBy(t.repeat, at, now);
      out.push({
        projectId: p.id, project: typeof p.name === 'string' && p.name ? p.name : p.id, n: t.number, sentence: t.sentence || '',
        slot: at, earlier: missed.count > 1 || missed.more === true, words: taskrepeat.whenWords(at, now), byWords: by !== null ? taskrepeat.whenWords(by, now) : '',
        holders, everyHolder, members: Array.isArray(p.agents) ? p.agents.slice() : [],
        quiet: t.repeatDueQuiet || null, lastRunAt: t.lastRunAt || null, repeatSetAt: t.repeatSetAt || null,
      });
    }
  }
  return out;
}

/* The line a holder is sent: the task, the run that is due, and how to record it. */
function tellText(item) {
  const id = /^[A-Za-z0-9._-]{1,80}$/.test(item.projectId) && /[^.]/.test(item.projectId) ? item.projectId : '<project-id>';
  return 'Kosmos: your repeating task #' + item.n + ' in ' + plain(item.project, 80) + ', "' + plain(item.sentence, 160) + '", is due: '
    + 'its run ' + plain(item.words, 60) + (item.earlier ? ' and earlier ones have' : ' has') + ' not been reported. Run it now'
    + (item.byWords ? ' (record it before ' + plain(item.byWords, 60) + ', ahead of the next one; if it is still going then, stop it, record it as it stands with what stopped it, and start the next)' : '')
    + ', then record it with kosmos task ran ' + id + ' ' + item.n + ' (add --unchanged if it found nothing new).';
}

/* kosmos#8586: an unreachable holder (off the project) is recorded once per stall, not once per slot. The task keeps
   which holders could not be reached and when; while that holds (no run since, the rule unchanged, the same holders),
   a later slot is not recorded again. The mark is cleared only when markTold records another outcome: a delivery
   that reached the holder, or one given up after MAX_TRIES. A holder who comes back and is told, then leaves again,
   starts a new stall; one who comes back and is never told before leaving again is still in the first.
   The key is every holder of an open part, before the reviewer-holder filter, which depends on the slot. */
function quietKey(item) { return (item.everyHolder || item.holders).slice().sort().join('\n'); }
function stillQuiet(item) {
  const q = item.quiet;
  if (!q || typeof q.who !== 'string' || q.who !== quietKey(item)) return false;
  const at = Date.parse(q.at || '');
  if (!Number.isFinite(at)) return false;
  return !(Date.parse(item.lastRunAt || '') > at) && !(Date.parse(item.repeatSetAt || '') > at);
}

/* Store that `slot` was told about, and record it in the task's history. `outcome` 'unreachable' also stores the stall
   (kosmos#8586); any other outcome clears it. */
function markTold(item, who, outcome, now = Date.now()) {
  const projects = require('./projects');
  const taskchat = require('./taskchat');
  projects.mutate(item.projectId, (p) => ({
    ...p,
    tasks: (p.tasks || []).map((x) => {
      if (!x || x.number !== item.n) return x;
      const { repeatDueQuiet, ...rest } = x;   // eslint-disable-line no-unused-vars
      return { ...rest, repeatDueToldAt: new Date(item.slot).toISOString(),
        ...(outcome === 'unreachable' ? { repeatDueQuiet: { who: quietKey(item), at: new Date(now).toISOString() } } : {}) };
    }),
  }));
  taskchat.record(item.projectId, item.n, { kind: 'due-told', slot: new Date(item.slot).toISOString(), told: who, reached: outcome === 'reached' });
}

/**
 * One pass. `o`: { projects, roster, now, prompterOn (bool), allowed (bool: live execution and the brake), limit
 * ({ on, perHour }), sent (the board-wide hour of Kosmos-to-agent lines), book (Map), idleSeen (Map), idleSince(session),
 * deliver(session, text, roster) -> { state }, DELIVERY, log, mark (test seam; markTold by default), items (owed()'s
 * list when the caller already has it), recentTyped (Map, session -> ms, read and written) }. Never throws.
 */
function sweep(o) {
  const results = [];
  try {
    if (o.prompterOn === true) return { results, skipped: 'the Prompter is on and nudges due runs itself' };
    const now = Number.isFinite(o.now) ? o.now : Date.now();
    const mark = typeof o.mark === 'function' ? o.mark : markTold;
    const book = o.book instanceof Map ? o.book : new Map();
    const sent = Array.isArray(o.sent) ? o.sent : [];
    while (sent.length && now - sent[0] >= HOUR_MS) sent.shift();
    for (const k of [...book.keys()]) { const slot = Number(String(k).split('@').pop()); if (Number.isFinite(slot) && now - slot > 7 * 24 * HOUR_MS) book.delete(k); }
    const cap = o.limit && o.limit.on === true && Number.isInteger(o.limit.perHour) ? o.limit.perHour : Infinity;
    const cards = new Map((Array.isArray(o.roster) ? o.roster : []).filter((a) => a && a.sessionName).map((a) => [a.sessionName, a]));
    const seen = o.idleSeen instanceof Map ? o.idleSeen : new Map();
    const nudgeable = require('./agentnudge').nudgeableCard;
    for (const [sn, c] of cards) {
      if (!nudgeable(c)) { seen.delete(sn); continue; }
      const e = seen.get(sn);
      seen.set(sn, e && now - e.at <= SEEN_GAP_MS ? { since: e.since, at: now } : { since: now, at: now });
    }
    const typedTo = new Set();
    const say = (r) => { if (typeof o.log === 'function') { try { o.log(r); } catch { /* never breaks a pass */ } } };
    /* An agent another sweep typed into this minute (o.recentTyped, session -> ms) is held like one this pass typed to. */
    const recent = o.recentTyped instanceof Map ? o.recentTyped : new Map();
    for (const item of Array.isArray(o.items) ? o.items : owed(o.projects, now)) {
      try {
        const slotKey = item.projectId + '#' + item.n + '@' + item.slot;
        if (book.get(slotKey) === 'told') { results.push({ ...item, act: 'held', because: 'already told; its mark could not be saved' }); continue; }
        const onProject = item.holders.filter((h) => item.members.includes(h));
        if (!onProject.length) {
          // kosmos#8586: see stillQuiet().
          if (stillQuiet(item)) { results.push({ ...item, act: 'unreachable', because: 'no holder is on the project', recorded: false }); continue; }
          book.set(slotKey, 'told'); mark(item, item.holders[0], 'unreachable', now);
          results.push({ ...item, act: 'unreachable', because: 'no holder is on the project', recorded: true }); continue;
        }
        if (o.allowed !== true) { results.push({ ...item, act: 'held', because: 'Kosmos does not type into agents yet' }); continue; }
        let picked = null;
        let because = 'no holder is running';
        for (const h of onProject) {
          const card = cards.get(h);
          if (!card) continue;
          if (!nudgeable(card)) { because = 'the holder is not idle, or cannot be typed into'; continue; }
          if (typedTo.has(h) || now - (Number(recent.get(h)) || -Infinity) < 60 * 1000) { because = 'one line to an agent per minute'; continue; }
          let since = null;
          if (typeof o.idleSince === 'function') { try { since = o.idleSince(h); } catch { since = null; } }
          if (!Number.isFinite(since)) { const idle = seen.get(h); since = idle ? idle.since : null; }
          if (!Number.isFinite(since) || now - since < SETTLED_MS) { because = 'the holder has only just gone idle'; continue; }
          picked = h; break;
        }
        if (!picked) { results.push({ ...item, act: 'held', because }); continue; }
        if (sent.length >= cap) { results.push({ ...item, act: 'held', because: 'Agent Communication\'s limit of ' + cap + ' an hour is reached' }); continue; }
        typedTo.add(picked);
        recent.set(picked, now);
        seen.delete(picked);
        let state = null;
        let wait = false;
        try { const r = o.deliver(picked, tellText(item), o.roster); state = r && r.state; wait = Boolean(r && (r.held === true || r.busy === true)); }
        catch { state = (o.DELIVERY && o.DELIVERY.UNCONFIRMED) || 'unconfirmed'; }
        if (wait) { results.push({ ...item, act: 'held', because: 'the holder cannot take a line just now', delivery: state }); continue; }
        const D = o.DELIVERY || {};
        const reached = (D.PLACED != null && state === D.PLACED) || (D.UNCONFIRMED != null && state === D.UNCONFIRMED);
        const tries = (Number(book.get(slotKey)) || 0) + 1;
        if (reached) { sent.push(now); book.set(slotKey, 'told'); mark(item, picked, 'reached'); }
        else if (tries >= MAX_TRIES) { book.set(slotKey, 'told'); mark(item, picked, 'not reached'); }
        else book.set(slotKey, tries);
        results.push({ ...item, act: 'tell', to: picked, reached, delivery: state, tries });
        say({ holder: picked, task: item.n, project: item.projectId, reached, delivery: state, tries });
      } catch (err) {
        results.push({ ...item, act: 'error', because: String((err && err.message) || err) });
      }
    }
  } catch { /* never throws: a pass is best-effort */ }
  return { results };
}

module.exports = { owed, tellText, markTold, sweep, stallSlots, MAX_TRIES };
