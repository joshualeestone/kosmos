/**
 * Tasks: things that need doing, which exist whether or not anyone is on
 * them (the pack's definition, stated on the project column). A task lives
 * INSIDE its project's record: its number is issued by the project and is
 * only unique there ("task 15" spans no projects), so the project is the
 * storage unit and the atomic write is the project store's own.
 *
 * ⚠️ WHAT A TASK DELIBERATELY DOES NOT HAVE, from the pack, because each
 * absence is a claim the system cannot check:
 *   - no writable STATUS: a new task has not started because nobody started
 *     it, and whether an agent is on it is engine/commitments.js's fact to
 *     observe, not a person's to type (the removed "Handed off" rule);
 *   - no person-chosen NUMBER: the project issues it;
 *   - no cross-project list anywhere down the line.
 *
 * ⚠️ CLOSING A TASK DOES NOT STOP AN AGENT. Verified in this repo when the
 * pack was drawn and still true: nothing in tasks can reach into a running
 * session. close() edits Kosmos's own record, exactly like
 * commitments.resolve(). The screen carries the sentence; this file
 * carries the mechanism that makes the sentence true.
 *
 * The `who` field records who the task was GIVEN to, with the same honesty
 * shape as project membership's everSeen: whether we could see that agent
 * at assignment time is recorded, so a typo and a temporarily unreadable
 * agent stay distinguishable later.
 */
const projects = require('./projects');
/* #992: a task's transcript. record() is best-effort and never throws, so a
   failed append can never break the task write that triggered it -- the task is
   the source of truth, the transcript is a record of it. Every call below sits
   AFTER the successful projects.mutate / writeParts, so a refused write (an
   agent not on the project) records nothing. */
const taskchat = require('./taskchat');

const SENTENCE_MAX = 200;
const DETAIL_MAX = 2000;
// #768: the cap on a task-conversation message. 2000 matches the project room's
// composer (#d-say maxlength) and DETAIL_MAX, and sits under taskchat's generic
// FIELD_MAX (4000) so a valid message is never silently truncated on the way to
// disk. say() REFUSES over-length input rather than leaning on that truncation --
// the same lesson as the older maxlength-vs-engine mismatch: the client limit and
// the engine limit must agree, or a caller past the client one saves less than it
// thinks it did.
const MESSAGE_MAX = 2000;

const WHO_MAX = 80;

/* #768: a task can carry a DUE DATE (a calendar date, YYYY-MM-DD, or null).
   Josh's #768 asks for "if there's a due date assigned" shown on the task page,
   which reverses the earlier deliberate "no due date" deferral on purpose: that
   deferral's own condition was "it belongs here the day something reads it", and
   #768 IS that day -- the task page now reads and shows it. Stored as the date
   string (or null); nothing SCHEDULES on it yet, so it is information a person and
   a picking-up agent read, never a promise the product silently breaks. */
const DUE_RE = /^\d{4}-\d{2}-\d{2}$/;
function dueProblem(dueDate) {
  if (dueDate === undefined || dueDate === null || dueDate === '') return null; // none / clear
  if (typeof dueDate !== 'string' || !DUE_RE.test(dueDate)) {
    return 'a due date has to be a calendar date (YYYY-MM-DD), or empty to clear it';
  }
  // A well-FORMED string can still be an impossible date (2026-02-31); reject it by
  // round-tripping through UTC so a nonsense date never lands on a task.
  const [y, m, d] = dueDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return 'that is not a real date';
  }
  return null;
}

function taskProblem({ sentence, detail, who } = {}) {
  if (typeof sentence !== 'string' || !sentence.trim()) {
    return 'say what needs doing';
  }
  if (sentence.trim().length > SENTENCE_MAX) {
    return `say what needs doing in ${SENTENCE_MAX} characters or fewer; the detail box below has the room`;
  }
  if (detail !== undefined && detail !== null
      && (typeof detail !== 'string' || detail.length > DETAIL_MAX)) {
    return `anything they should know has to be words (${DETAIL_MAX} characters or fewer)`;
  }
  // ⚠️ A PRESENT who is refused when it cannot be an agent's name, never
  // silently dropped: a caller who asked to assign and got a 200 with a
  // "Nobody yet" task believes an assignment happened. Absent/blank means
  // nobody, which is the modal's real default.
  if (who !== undefined && who !== null && who !== ''
      && (typeof who !== 'string' || !who.trim() || who.trim().length > WHO_MAX)) {
    return 'who is on it has to be an agent\'s name';
  }
  return null;
}

/**
 * Create a task on a project. Validated whole-or-not-at-all BEFORE the
 * write; the number is issued inside the same atomic mutate that stores
 * the task, so two concurrent creates cannot share one.
 */
function create(projectId, { sentence, detail, who, made: origin } = {}, roster) {
  const problem = taskProblem({ sentence, detail, who });
  if (problem) throw new Error(problem);
  const whoKey = typeof who === 'string' && who.trim() ? who.trim() : null;
  const seen = (whoKey && Array.isArray(roster))
    ? roster.some((a) => a && a.sessionName === whoKey)
    : (whoKey ? null : undefined);
  let made;
  projects.mutate(projectId, (p) => {
    // ⚠️ Membership is checked HERE, inside the same read that stores the
    // task, never from a separate earlier read. The screen only offers
    // members, so this refusal is for the API path -- without it the route
    // answered `told` while syncAgent (which derives the block strictly
    // from membership) had silently written a block that never mentioned
    // the task. A refusal is honest; a told-when-not is the lie this
    // module's header forbids.
    if (whoKey && !(p.agents || []).includes(whoKey)) {
      throw new Error('that agent is not on this project, so the task cannot be given to it');
    }
    const number = (p.taskCounter || 0) + 1;
    made = {
      number,
      sentence: sentence.trim(),
      detail: (typeof detail === 'string' && detail.trim()) ? detail.trim() : null,
      who: whoKey,
      // undefined when unassigned (nothing to have seen); null when assigned
      // with no roster to check against; boolean when checked.
      whoSeen: seen,
      /* 🔑 WHO PUT IT THERE. The day this field was seeded for arrived
         (#485, Josh 19:26: agents can create tasks too): 'operator' for the
         screen, the agent's session name when a pane resolved, null for a
         process nothing vouched for -- the screen says "an agent" then,
         never "You". addedVia carries HOW separately, because who and how
         are different facts and the valve counts the second. */
      addedBy: (origin && origin.via === 'process') ? (origin.by || null) : 'operator',
      addedVia: (origin && origin.via === 'process') ? 'process' : 'screen',
      createdAt: new Date().toISOString(),
      closedAt: null,
      // #768: every task carries the field so a consumer never has to guess
      // whether it exists; null means no due date, set later via setDue.
      dueDate: null,
    };
    return {
      ...p,
      taskCounter: number,
      tasks: [...(p.tasks || []), made],
    };
  });
  taskchat.record(projectId, made.number, {
    kind: 'created', sentence: made.sentence, detail: made.detail,
    addedBy: made.addedBy, addedVia: made.addedVia,
    // #992: a task created pre-assigned carries its first assignee HERE. That
    // assignment does not go through assignPart (create writes `who` directly),
    // so without this the transcript would show an agent removed but never that
    // one was on it from birth. null when it was created unassigned.
    who: made.who,
  });
  return made;
}

/**
 * Write a task's parts back, ALWAYS materialising the derived ones first.
 *
 * 🛑 THE TRAP THIS EXISTS TO CLOSE. A legacy task has `who` and no `parts`. Add
 * a second part to it and store only that one, and the FIRST part -- the
 * original assignment -- silently ceases to exist, because `partsOf` only
 * derives when the array is empty. The person adds a part and loses one.
 * So every write starts from `partsOf`, which is the derived list, and the
 * legacy `who` is retired in the same edit rather than left to disagree.
 */
function writeParts(projectId, n, fn) {
  let changed;
  projects.mutate(projectId, (p) => {
    const t = byNumber(p, n);
    if (!t) throw new Error('there is no task by that number on this project');
    const parts = fn(partsOf(t), t, p);
    if (!parts) throw new Error('that did not change anything');
    changed = { ...t, parts };
    /* ⚠️ `who` is DROPPED once parts are stored, not kept in step. Two fields
       answering "who is on this" is two things that disagree the first time
       one of them is edited, and every reader would then have to know which
       one wins. `partsOf` no longer looks at it once `parts` is there. */
    delete changed.who;
    return { ...p, tasks: (p.tasks || []).map((x) => (x.number === changed.number ? changed : x)) };
  });
  return changed;
}

function nextPartId(parts) {
  /* ⚠️ Never reused, including after a delete, for the reason the task number
     is never reused: an id that comes back means "part 2" stops meaning one
     thing forever. */
  return parts.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;
}

/* The parts valve (#803). tasks.create and projects.create sit behind a
   persisted twelve-an-hour refusal of process-originated writes; addPart and
   assignPart did not, so a looping process could make unlimited parts and
   reassign them without bound, each one rewriting instruction files through
   tellEveryoneOn. It looked metered because its neighbours were. Persisted
   the same way the task valve is: in the records themselves (a part carries
   how and when it was added, and how and when it was last moved), so a
   restart does not open the valve. The SCREEN is never valved. */
const PARTS_PER_HOUR = 12;
const HOUR_MS = 3600000;
function viaOf(made) { return made && made.via === 'process' ? 'process' : 'screen'; }

/** Every process-originated part write in the last hour, across all
 * projects: parts added, and parts moved to somebody. Answers the count and
 * when the oldest one ages out, so a refusal can say the number. */
function processPartWrites(now = Date.now()) {
  const since = now - HOUR_MS;
  let count = 0; let oldest = null;
  for (const p of projects.readAll()) {
    for (const t of (p && p.tasks) || []) {
      for (const x of (t && t.parts) || []) {
        for (const [via, at] of [[x.addedVia, x.createdAt], [x.movedVia, x.movedAt]]) {
          const ms = Date.parse(at);
          if (via === 'process' && Number.isFinite(ms) && ms >= since) { count += 1; if (oldest === null || ms < oldest) oldest = ms; }
        }
      }
    }
  }
  return { count, liftsInSecs: oldest === null ? 0 : Math.max(1, Math.ceil((oldest + HOUR_MS - now) / 1000)) };
}

/** The refusal, or not, for a process write right now. The sentence says the
 * count and when it lifts, and that the person's own path is open. */
function partValve(now = Date.now()) {
  const w = processPartWrites(now);
  if (w.count < PARTS_PER_HOUR) return { refused: false, count: w.count };
  const mins = Math.max(1, Math.ceil(w.liftsInSecs / 60));
  return { refused: true, count: w.count, retryAfterSecs: w.liftsInSecs,
    because: 'agents have made ' + w.count + ' part changes in the last hour, so Kosmos is pausing agent-made parts for '
      + mins + (mins === 1 ? ' minute' : ' minutes') + '; the person can still make them from the screen' };
}

/** Tests age the records through this rather than shortening the hour. */
function agePartWritesForTests(projectId, secs) {
  const shift = (at) => (Number.isFinite(Date.parse(at)) ? new Date(Date.parse(at) - secs * 1000).toISOString() : at);
  projects.mutate(projectId, (p) => ({ ...p, tasks: (p.tasks || []).map((t) => ({ ...t,
    parts: (t.parts || []).map((x) => ({ ...x, createdAt: shift(x.createdAt), movedAt: shift(x.movedAt) })) })) }));
}

/** Add a piece to a task. Its own sentence, and nobody on it until asked.
 * `made` says how it arrived ({via: 'process'|'screen'}), as tasks.create's
 * does; the part records it, which is what the valve counts. */
function addPart(projectId, n, { sentence, who, made } = {}) {
  const said = typeof sentence === 'string' ? sentence.trim() : '';
  if (!said) return { ok: false, because: 'say what this part is' };
  if (said.length > SENTENCE_MAX) return { ok: false, because: `keep it under ${SENTENCE_MAX} characters` };
  const whoKey = typeof who === 'string' && who.trim() ? who.trim() : null;
  if (whoKey && whoKey.length > WHO_MAX) return { ok: false, because: 'who is on it has to be an agent\'s name' };
  // Same refusal as create() (engine/tasks.js create(), above): the screen only
  // offers members, so an assignee that is not on the project reaches here only
  // via the API, and #761 now types a line into whoever `who` names -- a check
  // that never fired before this had a live-pane side effect to guard.
  // #992 (iter-6 nit): capture the new part's id so the transcript's part-added
  // line carries `partId`, exactly as its sibling part events (assigned /
  // part-closed / part-reopened) do -- otherwise a reader cannot correlate a
  // part-added with the later events on that same part. Computed inside the
  // callback (nextPartId needs the live parts), read after a successful write.
  let newPartId = null;
  // #992: adding an OPEN part to an already-complete task (all prior parts
  // closed, derived progressOf().closed true) un-completes it -- a real
  // task-level reopen, on the same derived transition setPartClosed/setClosed
  // record. A new part is always open, so addPart can only reopen, never
  // complete; that is why there is no `closed` counterpart here.
  // A task closed via an explicit task.closedAt stays closed after adding a part
  // (progressOf gives closedAt precedence over all-parts-done), so THAT case
  // records no reopened -- correctly, the task genuinely remains closed.
  let taskReopened = false;
  const task = writeParts(projectId, n, (parts, t, p) => {
    if (whoKey && !(p.agents || []).includes(whoKey)) {
      throw new Error('that agent is not on this project, so the part cannot be given to it');
    }
    newPartId = nextPartId(parts);
    const next = parts.concat([{ id: newPartId, who: whoKey, sentence: said, closedAt: null,
      addedVia: viaOf(made), createdAt: new Date().toISOString() }]);
    if (progressOf({ ...t, parts }).closed && !progressOf({ ...t, parts: next }).closed) {
      taskReopened = true;
    }
    return next;
  });
  taskchat.record(projectId, Number(n), { kind: 'part-added', partId: newPartId, sentence: said, who: whoKey });
  if (taskReopened) taskchat.record(projectId, Number(n), { kind: 'reopened' });
  return { ok: true, task };
}

/** Put somebody on a part, or take them off it (`who: null`). A move that
 * changes `who` records how and when it arrived (`made`), which the valve
 * counts; a resubmit of the current assignee records nothing. */
function assignPart(projectId, n, partId, who, made) {
  const whoKey = typeof who === 'string' && who.trim() ? who.trim() : null;
  if (whoKey && whoKey.length > WHO_MAX) return { ok: false, because: 'who is on it has to be an agent\'s name' };
  let found = false;
  // `moved` is false when `who` is set to what it already was -- the caller
  // uses it to skip re-typing the same pane line for the same fact (#304's
  // rule, extended here to parts). Named apart from writeParts's own local
  // `changed` (the merged task record it returns) -- same word, unrelated
  // meaning, easy to conflate on a re-read.
  let moved = false;
  // The membership check runs only for a part that actually exists (inside
  // the id match below) -- checked unconditionally up front, a nonexistent
  // partId with an unrecognised who threw the membership error instead of
  // "no part by that number" (caught by the existing refusal test).
  // ⚠️ AND only when `moved` -- a resubmit of the CURRENT assignee must stay
  // a harmless no-op even if that agent has since left the project (removal
  // does not clear a part's `who`). Checking membership unconditionally
  // turned every such resubmit into a hard refusal for a value nothing was
  // asking to change.
  const task = writeParts(projectId, n, (parts, t, p) => {
    return parts.map((x) => {
      if (Number(x.id) !== Number(partId)) return x;
      found = true;
      moved = (x.who || null) !== whoKey;
      if (moved && whoKey && !(p.agents || []).includes(whoKey)) {
        throw new Error('that agent is not on this project, so the part cannot be given to it');
      }
      return moved ? { ...x, who: whoKey, movedVia: viaOf(made), movedAt: new Date().toISOString() } : x;
    });
  });
  if (!found) return { ok: false, because: 'there is no part by that number on this task' };
  // Only a real move is recorded: a resubmit of the current assignee (moved
  // false) changed nothing and types no pane line, so it leaves no transcript
  // line either. `who: null` is a real event -- somebody was taken off.
  if (moved) taskchat.record(projectId, Number(n), { kind: 'assigned', partId: Number(partId), who: whoKey });
  return { ok: true, task, changed: moved };
}

/** Finish a part, or put it back. The parent's state follows from its parts. */
function setPartClosed(projectId, n, partId, closedAt) {
  let found = false;
  let partTransition = false;
  // #992: does closing/reopening THIS part flip the whole task's derived
  // completion? +1 the task just completed, -1 it just re-opened, 0 no change.
  let taskTransition = 0;
  const task = writeParts(projectId, n, (parts, t) => {
    const next = parts.map((x) => {
      if (Number(x.id) !== Number(partId)) return x;
      found = true;
      // #992: record only a real open<->closed TRANSITION, not a re-close (which
      // passes a fresh timestamp so a raw closedAt comparison would misfire). Same
      // fidelity gate as assignPart's `moved`: no spurious lifecycle events.
      partTransition = (!!x.closedAt) !== (!!closedAt);
      return { ...x, closedAt };
    });
    // #992: a MULTI-part task completes when its last open part closes -- that is
    // the derived progressOf().closed state (tasks.js progressOf: task.closedAt OR
    // all parts closed), and it is reached with NO task.closedAt write to hang a
    // `closed` event on. Without recording the derived transition here, a
    // multi-part task's completion (and its re-opening when a part is reopened)
    // never appears in its transcript, only the per-part lines. Compare the
    // derived state before/after the part change; setClosed records the SAME
    // derived transition, so the two paths stay consistent and never double-count.
    if (found) {
      const before = progressOf({ ...t, parts }).closed;
      const after = progressOf({ ...t, parts: next }).closed;
      if (before !== after) taskTransition = after ? 1 : -1;
    }
    return next;
  });
  if (!found) return { ok: false, because: 'there is no part by that number on this task' };
  if (partTransition) taskchat.record(projectId, Number(n), { kind: closedAt ? 'part-closed' : 'part-reopened', partId: Number(partId) });
  if (taskTransition) taskchat.record(projectId, Number(n), { kind: taskTransition > 0 ? 'closed' : 'reopened' });
  return { ok: true, task };
}

function byNumber(p, n) {
  return (p.tasks || []).find((t) => t.number === Number(n));
}

/** Close: a record edit, never an act on an agent (see the header). */
function close(projectId, n) {
  return setClosed(projectId, n, new Date().toISOString());
}

/** Reopen: the undo of the one human verb. */
function reopen(projectId, n) {
  return setClosed(projectId, n, null);
}

function setClosed(projectId, n, closedAt) {
  let changed;
  // #992: +1 just completed, -1 just re-opened, 0 no change (see below).
  let transition = 0;
  projects.mutate(projectId, (p) => {
    const t = byNumber(p, n);
    if (!t) throw new Error('there is no task by that number on this project');
    // #992: record on the DERIVED completion state (progressOf), not the raw
    // parent closedAt. Two reasons: (1) a re-close passes a fresh timestamp, so
    // comparing closed-ness rather than the value logs no duplicate; (2) an
    // explicit close of a task whose parts are ALREADY all closed (so it was
    // derived-closed before this call) is not a new completion and records
    // nothing -- which also keeps this consistent with setPartClosed, so the two
    // close paths never emit two `closed` lines for one completion.
    const before = progressOf(t).closed;
    changed = { ...t, closedAt };
    const after = progressOf(changed).closed;
    if (before !== after) transition = after ? 1 : -1;
    return {
      ...p,
      tasks: (p.tasks || []).map((x) => (x.number === changed.number ? changed : x)),
    };
  });
  if (transition) taskchat.record(projectId, changed.number, { kind: transition > 0 ? 'closed' : 'reopened' });
  return changed;
}

/**
 * #768: set or clear a task's due date. `dueDate` is a YYYY-MM-DD string, or
 * null/'' to clear it. Validated whole-or-not-at-all BEFORE the write (a nonsense
 * date is refused, never stored), and records a lifecycle event so the change
 * shows in the task's activity. No-op-safe: setting the same value the task
 * already has records nothing, the same discipline setClosed uses for a re-close.
 */
function setDue(projectId, n, dueDate) {
  const problem = dueProblem(dueDate);
  if (problem) throw new Error(problem);
  const next = (dueDate === undefined || dueDate === '' ) ? null : dueDate;
  let changed;
  let didChange = false;
  projects.mutate(projectId, (p) => {
    const t = byNumber(p, n);
    if (!t) throw new Error('there is no task by that number on this project');
    const before = t.dueDate || null;
    didChange = before !== next;
    changed = { ...t, dueDate: next };
    return {
      ...p,
      tasks: (p.tasks || []).map((x) => (x.number === changed.number ? changed : x)),
    };
  });
  if (didChange) {
    taskchat.record(projectId, changed.number, next
      ? { kind: 'due-set', dueDate: next }
      : { kind: 'due-cleared' });
  }
  return changed;
}

/* #768: record a free-text message on a task's conversation -- the WRITE half of
   #992's transcript (the read half is the activity list, engine/taskchat.js read()).
   THIS FUNCTION only RECORDS; DELIVERY to the task's agents happens at the server
   route (POST .../message), which has the roster and calls chat.deliver to the
   assignees (Josh, 2026-09-12: "only to the agents assigned to the task"). Keeping
   delivery in the route mirrors the room, whose delivery also lives at its route
   with the roster, and keeps this engine function pure. A message is validated
   non-empty here and the task must exist -- a message to a missing project/task is a
   404, never a stray transcript file. taskchat.record bounds and single-lines the
   text itself, and returns false (never throws) on a write failure, which for a
   user-initiated message is surfaced rather than swallowed (the message IS the
   operation, unlike a lifecycle side-record). */
function say(projectId, n, text) {
  const t = (typeof text === 'string' ? text : '').trim();
  if (!t) throw new Error('a message cannot be empty');
  if (t.length > MESSAGE_MAX) throw new Error(`keep the message to ${MESSAGE_MAX} characters or fewer`);
  // Resolve READ-ONLY (projects.get), not via projects.mutate as setDue does: a
  // message records to the transcript (taskchat) and changes nothing on the
  // project, so writing the project file back would be a needless write. Existence
  // is all we need from the lookup, so the cheaper read is the right shape here.
  const p = projects.get(projectId);
  if (!p) throw new Error('there is no project by that name');
  const task = byNumber(p, n);
  if (!task) throw new Error('there is no task by that number on this project');
  const ok = taskchat.record(projectId, task.number, { kind: 'said', text: t });
  if (!ok) throw new Error('we could not record that message');
  return task;
}

/**
 * A task's PARTS: the assignable things it is made of.
 *
 * 🔑 THE PARENT HAS NO ASSIGNEE OF ITS OWN. Mona Lisa's spec: a real job splits
 * into pieces needing different agents, so assignment lives on the part and the
 * parent is just the thing they add up to. Its state is DERIVED from its parts,
 * which is why it cannot disagree with them.
 *
 * 🛑 AND THE MIGRATION IS A READ, NOT A REWRITE. Every task already on disk has
 * a `who` and no `parts`, and a bulk pass over somebody's stored tasks is a
 * chance to lose them for a shape change nobody asked for. So this DERIVES the
 * parts of a legacy task every time it is read, and only new writes carry the
 * field. A record written in July keeps working in December with no upgrade
 * step and no version number.
 *
 * ⚠️ ONE PART, NEVER ZERO, when there is nobody on it. Mona Lisa's line
 * verbatim: "A task with no parts and a task with one unassigned part are
 * different screens: the first has nothing to show, the second says 'Nobody
 * yet', which is the state the pack draws and the only one that is true of an
 * existing task."
 */
function partsOf(task) {
  if (!task) return [];
  if (Array.isArray(task.parts) && task.parts.length) {
    return task.parts.map((part, i) => ({
      id: typeof part.id === 'number' ? part.id : i + 1,
      who: typeof part.who === 'string' && part.who.trim() ? part.who.trim() : null,
      /* A part with no sentence of its own IS the whole task, which is exactly
         what a migrated single part is. */
      sentence: (typeof part.sentence === 'string' && part.sentence.trim())
        ? part.sentence.trim() : task.sentence,
      closedAt: part.closedAt || null,
      /* Provenance (#803): how and when a part was added or last moved,
         carried through as stored, since writeParts stores what this
         returns. Absent on parts from before it existed; the valve treats
         absent as not-a-process-write, which is the safe direction. */
      ...(part.addedVia ? { addedVia: part.addedVia } : {}),
      ...(part.createdAt ? { createdAt: part.createdAt } : {}),
      ...(part.movedVia ? { movedVia: part.movedVia } : {}),
      ...(part.movedAt ? { movedAt: part.movedAt } : {}),
    }));
  }
  return [{
    id: 1,
    who: typeof task.who === 'string' && task.who.trim() ? task.who.trim() : null,
    sentence: task.sentence,
    /* ⚠️ The legacy task's own closedAt, so a finished task migrates to
       "1 of 1 done" rather than to a finished parent holding an open part.
       The two halves of one record must not disagree the moment they are read
       through a new shape. */
    closedAt: task.closedAt || null,
  }];
}

/**
 * What a person reads on the card: how many of a task's parts are finished.
 *
 * ⚠️ `done` is derived from the PARTS and never stored, so the sentence cannot
 * drift from the rows underneath it. A task whose parts are all closed IS
 * closed, whatever a parent field says.
 */
function progressOf(task) {
  const parts = partsOf(task);
  const done = parts.filter((x) => x.closedAt).length;
  return {
    parts,
    done,
    total: parts.length,
    /* The parent's own truth. `closedAt` on the task still exists and still
       wins when it is set, because closing a task is a thing a person does to
       the whole thing; all-parts-done is the other way in. */
    closed: Boolean(task && task.closedAt) || (parts.length > 0 && done === parts.length),
    assigned: parts.filter((x) => x.who).length,
  };
}

/** Whoever is on this task at all, for the join and the card's face. */
function whoOf(task) {
  const named = partsOf(task).map((x) => x.who).filter(Boolean);
  return [...new Set(named)];
}

/**
 * The column's list versus the whole list, per the pack's door rule: the
 * column shows a task with somebody on it that is not finished; finished
 * tasks and tasks nobody has picked up are both real and both behind the
 * door.
 */
function columnTasks(p) {
  /* ⚠️ THROUGH `whoOf` AND `progressOf`, not through `t.who`. Once a task
     stores parts it has no `who` at all, so the old test dropped every
     multi-part task out of the column silently -- the door would have shown
     tasks the column was hiding for no reason a person could see. */
  return (p.tasks || []).filter((t) => whoOf(t).length > 0 && !progressOf(t).closed);
}


/**
 * The JOIN, read side: does the assignee SAY it is on this task?
 *
 * ⚠️ Assignment is the join (the pack's rule): commitments knows what each
 * agent says it is holding; a task knows who it was given to. The match is
 * DETERMINISTIC, never fuzzy: a commitment counts only when its text names
 * "task <number>" (word-bounded, so task 1 never matches task 12). Agents
 * learn the convention from the managed block in their own instructions
 * (projects.blockBody lists their open tasks with exactly that spelling).
 *
 * Three answers, never two:
 *   { claimed: true }          a FRESH report names this task
 *   { claimed: false }         a fresh report exists and does not name it
 *                              (which is NOT "not started": it says only
 *                              that the agent has not said so)
 *   { claimed: null, because } we could not read what it reports (absent,
 *                              stale, unreadable) -- and null must never
 *                              render as either of the others
 * Unassigned and closed tasks have no claim to compute (null, no because).
 */
/* The qualified spelling (#779): "task N of <project>" (also on/in/for, the
   name or the id, any case; the name ends where it ends, so "Midnight
   Inventory 2" is not "Midnight Inventory"). A bare "task N" stays enough when the number
   names one thing to this agent; when it names two (a task 1 on each of
   two projects), only the qualified form is a claim, and a bare one is
   could-not-tell with the reason. Accepting the spelling costs nothing
   before agents are taught it; teaching it is a wording change (#763's
   rule: Splinter, then Josh) and is not in this file. */
/**
 * Every open task on every project, for the all-tasks screen (#1382).
 *
 * Josh: a list of "all tasks across all projects", reachable the way the
 * documents list is.
 *
 * 🔑 CLOSED TASKS ARE IN, AND THE REASON IS A REMOVAL RATHER THAN A
 * PREFERENCE. This screen is reached from `#pj-alltasks`, the per-project
 * door, which today reveals hidden tasks IN PLACE. #1009 already put every
 * OPEN task in the column, assigned or not, so what that door reveals now is
 * the remainder: FINISHED WORK.
 * ⇒ Repurposing the door to open this screen is a removal plus an addition,
 * and if the screen excluded closed tasks the removal would leave finished
 * work unreachable anywhere in Kosmos.
 *
 * ⚠️ THE COST, STATED RATHER THAN HIDDEN: closed tasks grow without bound, so
 * this list does too. There is no pager, deliberately, while the realistic
 * count is small. That is the first thing to revisit, and the trigger is a
 * real machine with enough finished work to scroll, not a guess about one.
 *
 * 🔑 ONE ARRAY, SO A COUNT CANNOT DISAGREE WITH ITS OWN DESTINATION. The
 * "View all tasks (N)" control and the rows on the screen both derive from
 * what this returns. That is #1346 stated as a construction rather than as a
 * rule to remember: that screen said "3 agents" over three rows and "6" below
 * them because one number came from the DATA and the other from a
 * document-wide DOM query.
 *
 * `projectName` and `whoNames` are ADDED, never merged over the task's own
 * fields: a task that stores parts has no `who` at all, and overwriting it
 * with the derived list would make two different facts share one name.
 */
function allTasks() {
  const out = [];
  for (const p of projects.readAll() || []) {
    for (const t of p.tasks || []) {
      out.push(Object.assign({}, t, {
        projectId: p.id,
        projectName: p.name,
        whoNames: whoOf(t),
        /* Named on the row rather than inferred by the screen: `progressOf`
           lives here, and a caller re-deriving "is it finished" from another
           field is the two-sources-for-one-fact shape that put "3 agents" over
           six rows in #1346. */
        isClosed: !!progressOf(t).closed,
      }));
    }
  }
  /* Deterministic order, so the screen does not reshuffle between paints and
     a test can assert rows rather than a set: project name, then the task
     number within it. */
  /* Open work first, then finished, each by project then task number. A
     person opening this is looking for what is live; the finished half is why
     the door existed and it stays reachable, underneath. */
  return out.sort((a, b) => (a.isClosed ? 1 : 0) - (b.isClosed ? 1 : 0)
    || String(a.projectName).localeCompare(String(b.projectName))
    || (a.number || 0) - (b.number || 0));
}

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function claimPatterns(n, project) {
  const bare = new RegExp('\\btask\\s+' + n + '(?!\\d)(?!\\.\\d)', 'i');
  const names = [];
  if (project && typeof project.name === 'string' && project.name.trim()) names.push(escapeRe(project.name.trim()));
  if (project && project.id !== undefined && project.id !== null && String(project.id).trim()) names.push(escapeRe(String(project.id).trim()));
  const qualified = names.length
    ? new RegExp('\\btask\\s+' + n + '\\s+(?:of|on|in|for)\\s+["“\'‘]?(?:' + names.join('|') + ')(?![a-z0-9])(?!\\s+\\d)', 'i')
    : null;
  return { bare, qualified };
}

function claimFor(task, reading, opts) {
  const project = opts && opts.project ? opts.project : null;
  const ambiguous = !!(opts && opts.ambiguous);
  /* ⚠️ Same correction as columnTasks: a task with parts has no `who`, so this
     returned null for every assigned multi-part task and the card lost its
     says-it-is-on-this line with nothing saying why. The claim is still asked
     of the task as a whole (one report naming "task 15" is a claim about the
     task); per-part claims need a spelling agents have not been taught. */
  if (!task || whoOf(task).length === 0 || progressOf(task).closed) return null;
  // ⚠️ The DEFINITE branch is allowlisted, never the unknown one: a state
  // this module does not recognize (a future vocabulary word, a hand-edited
  // record) must fall to could-not-tell, because falling to true/false would
  // render a definite answer nobody computed. STATE comes from the producer,
  // so the two cannot drift.
  const { STATE } = require('./commitments');
  if (!reading || (reading.state !== STATE.HOLDING && reading.state !== STATE.CLEAR)) {
    return {
      claimed: null,
      because: (reading && reading.because) || 'we could not read what it reports holding',
    };
  }
  // Server-issued numbers are integers; a hand-edited store can hold
  // anything, and a non-integer interpolated into the pattern is regex
  // (1.5 matches "task 175"). Same way-out validation commitments.js does.
  const n = task.number;
  if (typeof n !== 'number' || !Number.isSafeInteger(n)) {
    return { claimed: null, because: 'this task\'s number is not a whole number, so a report cannot name it' };
  }
  // The trailing guard is two lookaheads, not \b: \b sits happily between
  // "1" and ".", so "task 1.5" in a report would join task 1. Not-a-digit
  // blocks "task 12"; not-a-dot-then-digit blocks "task 1.5" while still
  // matching a sentence that simply ends "task 1."
  const { bare, qualified } = claimPatterns(n, project);
  const whats = (reading.commitments || []).filter((c) => c && typeof c.what === 'string').map((c) => c.what);
  const saysQualified = !!qualified && whats.some((w) => qualified.test(w));
  const saysBare = whats.some((w) => bare.test(w));
  if (ambiguous) {
    if (saysQualified) return { claimed: true, because: null };
    if (saysBare) {
      return { claimed: null, because: '"task ' + n + '" names more than one of this agent\'s open tasks: it has a task '
        + n + ' in two projects and has not said which' + (project && project.name ? ' (say "task ' + n + ' of ' + String(project.name).trim() + '")' : '') };
    }
    return { claimed: false, because: null };
  }
  return { claimed: saysBare || saysQualified, because: null };
}

module.exports = { create, close, reopen, byNumber, columnTasks, allTasks, claimFor, claimPatterns, taskProblem,
  partsOf, progressOf, whoOf, addPart, assignPart, setPartClosed, setDue, dueProblem, say,
  partValve, processPartWrites, agePartWritesForTests, PARTS_PER_HOUR,
  SENTENCE_MAX, DETAIL_MAX, MESSAGE_MAX, WHO_MAX };
