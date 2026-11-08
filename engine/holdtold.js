'use strict';
/**
 * kosmos#8259: a hold that waits on the person (`kosmos task hold <p> <n> --for-you`, kosmos#7788) said when it was SET,
 * never whether the person was TOLD. An agent that set it and never asked looked the same as one that asked clearly and
 * waited half a day, and when the person answered nothing prompted the agent to take the hold off, so it was walked past.
 *
 * Told: each time, after the for-you mark went on, that a holder of an open part writes about the task where the person
 * reads it. The FIRST tell is `onHoldToldAt` (ISO), the age of the ask; the latest is `onHoldLastToldAt`, with
 * `onHoldToldVia` ('task', 'room' or 'reply', where it last asked) and, when that message has one, `onHoldToldId`. About
 * the task means:
 *   - in the task's own conversation (`kosmos task message <p> <n>`): always;
 *   - in the project's room (`kosmos post`): the post names the task (#12, or task 12);
 *   - to the person directly (`kosmos reply`): the reply says "task 12" (a bare #12 there is more often a card number),
 *     and exactly one of that agent's for-you holds, across its projects, has that number (two would be a guess, so
 *     neither is marked).
 *
 * Answered: the person writes in that task's conversation, or (once the task was told there) to the holder directly, or in
 * the room naming the task. The line the holder is typed gets one more sentence (clauseFor): the task is on hold waiting
 * on the person, so if this answers it, take it off hold, else say what it still needs; and the task records
 * `onHoldAnsweredAt` (markAnswered): in the task's conversation whenever the person writes there (it is in the task's
 * record whoever was reached), directly once the line was placed, in the room once every holder it reached was typed it. Directly and in the room that is once per tell: an answer
 * counts while none is newer than the latest tell, so an agent asking again (as the clause tells it to) is prompted again
 * by the next answer. The clause never rides a message kept to be typed later: by then the hold may be gone.
 *
 * All five fields belong to the for-you hold: they go when the hold or its mark goes, a new for-you hold is set, or its
 * reason changes (a new question) (tasks.HOLD_TOLD_FIELDS, dropped wherever onHoldForPerson is). Every note is
 * best-effort: a failure to record never breaks the message that triggered it, which is the operation the caller is doing.
 */

const VIAS = new Set(['task', 'room', 'reply']);
const CLAUSE_SHOWN = 3;   // holds a clause names; the rest are counted

/* The task numbers a text names: "#12" or "task 12" (also "task #12"), never the digits inside a longer number or
   word ("#123" is not #12, "v12" names nothing). `wordOnly` takes only "task 12": a direct message between the person
   and an agent cites card and PR numbers as #N, so a bare #N there would mark the wrong hold. */
function namedNumbers(text, wordOnly = false) {
  const out = new Set();
  const s = typeof text === 'string' ? text : '';
  const re = wordOnly ? /(?:^|[^\w#&])task\s+#?(\d{1,7})(?!\d)/gi : /(?:^|[^\w#&])(?:#|task\s+#?)(\d{1,7})(?!\d)/gi;
  let m;
  while ((m = re.exec(s)) !== null) {
    const n = Number(m[1]);
    if (Number.isInteger(n) && n > 0) out.add(n);
  }
  return out;
}

function isForYou(t) {
  const tasks = require('./tasks');
  return Boolean(t) && typeof t.number === 'number' && tasks.isOnHold(t) && t.onHoldForPerson === true && !tasks.progressOf(t).closed;
}

function holdsPart(t, who) {
  return require('./tasks').partsOf(t).some((x) => x && x.who === who && !x.closedAt);
}

/* Every open for-you hold `who` holds a part of: [{ p, t }], in project order. */
function forYouHoldsOf(projectList, who) {
  const out = [];
  for (const p of Array.isArray(projectList) ? projectList : []) {
    if (!p || p.archived === true) continue;
    for (const t of Array.isArray(p.tasks) ? p.tasks : []) if (isForYou(t) && holdsPart(t, who)) out.push({ p, t });
  }
  return out;
}

/* Write `fields` (an object, or a function of the stored task giving the whole new task) onto task `n` of project
   `projectId` when `ok(t)` still holds inside the write (the task may have moved since it was read). Returns the task as
   written, or null. */
function stamp(projectId, n, ok, fields) {
  const projects = require('./projects');
  let wrote = null;
  projects.mutate(projectId, (p) => {
    const tasks = p && Array.isArray(p.tasks) ? p.tasks : [];
    const t = tasks.find((x) => x && x.number === n);
    if (!t || !ok(t)) return p;
    wrote = typeof fields === 'function' ? fields(t) : { ...t, ...fields };
    return { ...p, tasks: tasks.map((x) => (x === t ? wrote : x)) };
  });
  return wrote;
}

/* Which tasks a message from agent `who` tells the person about. `projectList` as projects.readAll() gives it. */
function toldTargets(projectList, who, { via, projectId, task, text }) {
  const mine = forYouHoldsOf(projectList, who);
  if (via === 'task') return mine.filter((x) => x.p.id === projectId && x.t.number === Number(task));
  const named = namedNumbers(text, via === 'reply');
  if (!named.size) return [];
  if (via === 'room') return mine.filter((x) => x.p.id === projectId && named.has(x.t.number));
  // 'reply': no project, so a number counts only when exactly one of this agent's for-you holds has it.
  const out = [];
  for (const n of named) {
    const hits = mine.filter((x) => x.t.number === n);
    if (hits.length === 1) out.push(hits[0]);
  }
  return out;
}

/**
 * An agent wrote where the person reads. Marks each for-you hold it holds that the message is about: the first tell sets
 * onHoldToldAt, every tell moves onHoldLastToldAt and onHoldToldVia/Id. `msg`: { via: 'task' | 'room' | 'reply',
 * projectId (task, room), task (task), text, id?, at? }. Returns [{ projectId, n, first }] for the holds it marked.
 * Never throws.
 */
function noteTold(who, msg, o = {}) {
  try {
    if (typeof who !== 'string' || !who || !msg || !VIAS.has(msg.via)) return [];
    const projects = require('./projects');
    const list = Array.isArray(o.projects) ? o.projects : projects.readAll();
    const at = new Date(Number.isFinite(msg.at) ? msg.at : typeof msg.at === 'string' && Number.isFinite(Date.parse(msg.at)) ? Date.parse(msg.at) : Date.now()).toISOString();
    const id = typeof msg.id === 'string' && msg.id ? msg.id.slice(0, 120) : null;
    const out = [];
    for (const { p, t } of toldTargets(list, who, msg)) {
      let first = false;
      const wrote = stamp(p.id, t.number, (x) => isForYou(x) && holdsPart(x, who), (x) => {
        first = !x.onHoldToldAt;
        /* Round 2: a reply drained from the outbox carries its original send time, which can be older than this hold or
           than a tell already recorded; the marks never move back in time, so it counts as a tell now. */
        const floor = Math.max(Date.parse(x.onHoldLastToldAt) || 0, Date.parse(x.onHoldToldAt) || 0);
        const when = Date.parse(at) < floor ? new Date(Math.max(floor, Date.now())).toISOString() : at;
        const next = { ...x, onHoldLastToldAt: when, onHoldToldVia: msg.via };
        if (first) next.onHoldToldAt = when;
        if (id) next.onHoldToldId = id; else delete next.onHoldToldId;
        return next;
      });
      if (!wrote) continue;
      // The history records the first ask only: every message in the task's conversation is a tell, and is there already.
      if (first) { try { require('./taskchat').record(p.id, t.number, { kind: 'hold-told', who, via: msg.via }); } catch { /* the mark stands */ } }
      out.push({ projectId: p.id, n: t.number, first });
    }
    return out;
  } catch {
    return [];
  }
}

/* Whether an answer would be new: none recorded, or the agent asked again after the last one (onHoldLastToldAt; a hold
   told before that field existed has only onHoldToldAt). */
function answeredOpen(t) {
  const answered = Date.parse(t && t.onHoldAnsweredAt);
  if (!Number.isFinite(answered)) return true;
  const told = Date.parse(t.onHoldLastToldAt || t.onHoldToldAt);
  return Number.isFinite(told) && told > answered;
}

/* Which for-you holds a message from the person answers, with the holders it is typed to. */
function answeredTargets(projectList, { via, projectId, task, text, to }) {
  const out = [];
  if (via === 'task') {
    const p = (projectList || []).find((x) => x && x.id === projectId);
    const t = p && (p.tasks || []).find((x) => x && x.number === Number(task));
    if (p && isForYou(t)) out.push({ p, t });
    return out;
  }
  const named = namedNumbers(text, via === 'reply');
  if (via === 'room') {
    const p = (projectList || []).find((x) => x && x.id === projectId);
    for (const t of p && Array.isArray(p.tasks) ? p.tasks : []) {
      if (isForYou(t) && (named.has(t.number) || t.onHoldToldVia === 'room')) out.push({ p, t });
    }
    return out;
  }
  // 'reply': the person writing to one agent directly answers that agent's holds it told there, or one it names.
  if (typeof to !== 'string' || !to) return out;
  for (const x of forYouHoldsOf(projectList, to)) {
    if (x.t.onHoldToldVia === 'reply' || named.has(x.t.number)) out.push(x);
  }
  return out;
}

/**
 * The person wrote. Returns the for-you holds it answers as [{ projectId, project, n, holders }], so the caller can add
 * clauseFor to the line it types each holder, and then mark them (markAnswered) once the line went. In the task's own
 * conversation every message of the person's answers (it is the item itself). Directly or in the room, only the first
 * message after the latest tell does (answeredOpen), as the standing-question note of #5943 is said once per ask: a person
 * chatting about other things is not asked again and again, and an agent that asks again is. In the room, only holders
 * the post reaches (`to`, when given). `msg`: { via, projectId, task, text, to? }. Never throws.
 */
function noteAnswered(msg, o = {}) {
  try {
    if (!msg || !VIAS.has(msg.via)) return [];
    const projects = require('./projects');
    const tasks = require('./tasks');
    const list = Array.isArray(o.projects) ? o.projects : projects.readAll();
    const reach = Array.isArray(msg.to) ? new Set(msg.to) : null;
    const out = [];
    for (const { p, t } of answeredTargets(list, msg)) {
      if (msg.via !== 'task' && !answeredOpen(t)) continue;
      let holders = [...new Set(tasks.partsOf(t).filter((x) => x && x.who && !x.closedAt).map((x) => x.who))];
      if (msg.via === 'reply') holders = holders.filter((h) => h === msg.to);
      if (msg.via === 'room' && reach) holders = holders.filter((h) => reach.has(h));
      if (!holders.length) continue;
      out.push({ projectId: p.id, project: typeof p.name === 'string' && p.name ? p.name : p.id, n: t.number, holders });
    }
    return out;
  } catch {
    return [];
  }
}

/* Record `onHoldAnsweredAt` on each hold noteAnswered returned, once the person's message was typed. `reached`, when
   given, says which holders it was typed to: a hold is marked only when EVERY holder noteAnswered named was reached (round
   2: with two holders, one held back, marking it would leave that one never prompted); until then its answer stays open
   and the next message carries the clause again, to whoever it reaches. Never throws. */
function markAnswered(answered, at = Date.now(), reached) {
  const iso = new Date(Number.isFinite(at) ? at : Date.parse(at) || Date.now()).toISOString();
  const got = typeof reached === 'function' ? reached : () => true;
  for (const x of Array.isArray(answered) ? answered : []) {
    if (!x || !Array.isArray(x.holders) || !x.holders.length || !x.holders.every(got)) continue;
    try { stamp(x.projectId, x.n, isForYou, { onHoldAnsweredAt: iso }); } catch { /* the message stands */ }
  }
}

/* The sentence added to the line typed into `who` for the holds `answered` names (noteAnswered's answer), or ''. */
function clauseFor(answered, who) {
  const mine = (Array.isArray(answered) ? answered : []).filter((x) => x && Array.isArray(x.holders) && x.holders.includes(who));
  if (!mine.length) return '';
  const idOf = (x) => (typeof x.projectId === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(x.projectId) && /[^.]/.test(x.projectId) ? x.projectId : '<project-id>');
  const plain = (s) => require('./agentnudge').plainWords(String(s == null ? '' : s).replace(/[\u202a-\u202e\u2066-\u2069]/g, ' '), 80);   // and the bidi marks a pane refuses (chat DM_PANE_UNSAFE)
  const one = (x) => 'task #' + x.n + ' in ' + plain(x.project);
  const off = (x) => 'kosmos task unhold ' + idOf(x) + ' ' + x.n;
  if (mine.length === 1) {
    const x = mine[0];
    return ' [kosmos] you have ' + one(x) + ' on hold waiting on this person. If this message answers it, act on the answer and take it off hold: '
      + off(x) + '. If it does not, tell them what you still need.';
  }
  /* Round 2: typed after the length checks (a DM's or room post's trailer), so bounded: SHOWN holds by name, the rest
     counted and pointed at the list. */
  const shown = mine.slice(0, CLAUSE_SHOWN);
  const more = mine.length - shown.length;
  return ' [kosmos] you have ' + shown.map(one).join(', ') + (more ? ' and ' + more + ' more' : '') + ' on hold waiting on this person. For each this message answers, act on the answer and take it off hold ('
    + shown.map(off).join(', ') + (more ? '; the rest: kosmos task list' : '') + '). For the rest, tell them what you still need.';
}

module.exports = { CLAUSE_SHOWN, answeredOpen, namedNumbers, forYouHoldsOf, toldTargets, noteTold, answeredTargets, noteAnswered, markAnswered, clauseFor };
