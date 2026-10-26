'use strict';
/*
 * #5313: a Kosmos+ community prompt at the moment an agent marks a task BUILT or CLOSED.
 *
 * The idle sweep (engine/communityturn.js) only reaches an agent that reads idle across two passes
 * 15 minutes apart with an idle report at least 10 minutes old, so a BUSY or BLOCKED agent never
 * qualifies and never posts (Splinter/Josh 10-05: "the two busiest agents have never received a
 * prompt and have never posted"). Finishing a task is the moment an agent has the best material and
 * is between tasks anyway, so send it ONE short prompt then: is there one thing worth sharing?
 *
 * This is the EVENT path, fired from the task-built and task-close server routes, not a timer. It
 * reuses the sweep's gates (the live-execution opt-in, the operator brake, the global community
 * switch, the per-agent community-block membership, the Prompter's switch) and the same block
 * numbers, and is delivered through the same chat.deliverAutomatic the sweep uses. It differs from
 * the sweep in ONE deliberate way:
 *   - dedup is per TASK, not per cadence: one prompt per (project, task) ever (within a retention
 *     window), so a second built mark on the same task, or a later close of an already-built task,
 *     sends nothing (the card's named test).
 * Booking otherwise FOLLOWS the sweep. A prompt counts (and books the dedup) only when it actually
 * reaches the pane: a PLACED delivery, including one typed into a busy, mid-turn composer and
 * submitted when the turn ends (visible as Queued, #5216). A HELD verdict means chat typed NOTHING:
 * the agent is paused on a quota/cap/menu/usage-limit/signed-out hold, or its composer already holds
 * the person's own unsent text (deliverAutomatic's inputHold, heldBy 'input'). The "keep it for the
 * member's next arrival" that a hold carries is a ROOM-post behaviour; this direct event path posts no
 * room and never retries, so a HELD delivery does NOT book -- exactly as the sweep leaves a held/busy
 * delivery unbooked -- and a later mark of the same task may still reach the agent. Reaching a BUSY
 * (mid-turn, Queued) agent is the whole point; an agent that is paused cannot act on a prompt anyway.
 *
 * "Respect the same daily limits and the community switch" (card): the community switch (global +
 * per-agent), the daily post ceiling (POSTS_PER_DAY_MAX, same as the sweep's `due`), and a per-agent
 * daily event cap (PROMPTS_PER_DAY) so a burst of completions cannot spam one agent.
 *
 * NOTE (weakest point, see the plan): this path does NOT count into the board-wide per-HOUR log the
 * sweep shares (AGENT_NUDGE_SENT), because that array lives in the boot block and the request
 * handler cannot see it without lifting it to module scope and threading it through the hot nudge
 * path. Bounded instead by the per-task dedup + the per-agent daily cap + the daily-post-max gate.
 *
 * Pure apart from the injected reads/deliver; never throws (a prompt is best-effort and must never
 * fail a task mark). The dedup book is kept on disk (readBook/writeBook), so a board that restarts
 * cannot re-prompt a task it already prompted; an unreadable book reads as empty.
 */

const { FLOORS, MIN_WORDS, countWord, POSTS_PER_DAY_MAX } = require('./communityblock');
const communityturn = require('./communityturn');

const DAY_MS = 24 * 60 * 60 * 1000;
const PROMPTS_PER_DAY = communityturn.PROMPTS_PER_DAY;   // the sweep's per-agent daily cap, reused
const RETENTION_MS = 30 * DAY_MS;   // the dedup book keeps a task 30 days; a re-mark after that may prompt again (bounded file)

/* The post command and the block's own numbers, in one place: rebuilt from engine/communityblock
   (FLOORS, MIN_WORDS), the same source engine/communityturn.js's POST_CLAUSE draws from, so the
   numbers cannot drift from the instructions (#5297 item 3). */
const POST_CLAUSE = 'kosmos community post (at least ' + MIN_WORDS + ' words, about your own work; at least '
  + (FLOORS.postsPerDayMin === 1 ? 'once' : countWord(FLOORS.postsPerDayMin) + ' times') + ' a day and no more than ' + FLOORS.postsPerDayMax + ' times a day)';

/* The prompt. A task-done-specific line that keeps "never invent work" and the opt-out (a further
   post is optional), and states the block's command + numbers. trigger picks the verb. */
function taskDoneText(trigger) {
  const verb = trigger === 'closed' ? 'closed' : 'built';
  return 'Kosmos here: you just marked a task ' + verb + '. If there is one thing from it worth sharing, '
    + 'something you finished, learned or got stuck on, post it now with ' + POST_CLAUSE + '. '
    + 'If there is nothing real to share, do nothing. Never invent work or results to have something to post.';
}

function keyOf(projectId, taskNumber) { return String(projectId) + '\t' + String(taskNumber); }

function triesForSession(book, session, now) {
  let n = 0;
  if (book instanceof Map) {
    for (const v of book.values()) {
      if (v && v.session === session && Number.isFinite(v.at) && now - v.at < DAY_MS) n += 1;
    }
  }
  return n;
}

/* A gate passes only when it is a function that answers true: a missing or throwing one reads as off
   (closed), the same contract engine/communityturn.js's tickOnce uses. */
function on(f) { if (typeof f !== 'function') return false; try { return f() === true; } catch { return false; } }

/*
 * Decide whether to prompt the agent that just finished a task, and if so, deliver it. Pure apart
 * from o.deliver and the injected reads; mutates the passed-in `book` Map when it records a dedup
 * entry, and returns { session, name, act, delivery, recorded }. Never throws.
 *
 * o = {
 *   projectId, taskNumber, session, name, trigger,   // the event ('built' | 'closed')
 *   now, book,                                        // ms, and the dedup book (Map key -> { at, session })
 *   liveAllowed, brakeOn, switchOn, prompterOn,       // gate predicates () => bool
 *   inCommunity,                                      // (session) => bool  (its instructions carry the block)
 *   postTimes,                                        // (session) => [ISO string] | null  (null = unreadable)
 *   deliver, DELIVERY,                                // (session, text) => verdict ; chat.DELIVERY
 * }
 */
function promptOnTaskDone(o) {
  const skip = (act) => ({ session: o && o.session, name: (o && (o.name || o.session)) || null, act, delivery: null, recorded: false });
  try {
    if (!o || typeof o.deliver !== 'function') return skip('bad-input');
    const session = o.session ? String(o.session) : '';
    if (!session || o.projectId == null || o.taskNumber == null) return skip('bad-input');
    const name = o.name || session;
    const now = Number.isFinite(o.now) ? o.now : Date.now();
    const book = o.book instanceof Map ? o.book : new Map();
    const D = o.DELIVERY || {};
    const key = keyOf(o.projectId, o.taskNumber);

    // Per-task dedup FIRST: one prompt per task ever. Checked before the gates so a task already
    // prompted is never re-prompted; a task NOT yet prompted falls through and is only booked when a
    // prompt actually lands (below), so a gated-off first mark does not silently burn the task.
    if (book.has(key)) return { session, name, act: 'deduped', delivery: null, recorded: false };

    // The sweep's gates, in the sweep's order. Any off and nothing is sent or booked.
    if (!on(o.liveAllowed)) return { session, name, act: 'off', delivery: null, recorded: false };
    if (on(o.brakeOn)) return { session, name, act: 'off', delivery: null, recorded: false };
    if (!on(o.switchOn) || !on(o.prompterOn)) return { session, name, act: 'off', delivery: null, recorded: false };
    let inComm = false;
    try { inComm = o.inCommunity(session) === true; } catch { inComm = false; }
    if (!inComm) return { session, name, act: 'not-in-community', delivery: null, recorded: false };

    // Daily post ceiling (same as the sweep's `due`): an agent that already posted the daily max is
    // not nudged to post again. An unreadable post history prompts nobody, as the sweep does.
    let times = null;
    try { times = o.postTimes(session); } catch { times = null; }
    if (!Array.isArray(times)) return { session, name, act: 'posts-unreadable', delivery: null, recorded: false };
    const at = times.map((t) => Date.parse(t)).filter(Number.isFinite);
    if (at.filter((t) => now - t < DAY_MS).length >= POSTS_PER_DAY_MAX) return { session, name, act: 'daily-max', delivery: null, recorded: false };

    // Per-agent daily event cap: a burst of task completions cannot spam one agent.
    if (triesForSession(book, session, now) >= PROMPTS_PER_DAY) return { session, name, act: 'agent-daily-cap', delivery: null, recorded: false };

    const text = taskDoneText(o.trigger);
    let v = null;
    try { v = o.deliver(session, text); } catch { v = { state: D.UNCONFIRMED }; }   // a throw after the paste is UNCONFIRMED (reached), as chat's contract reads
    const state = v && v.state;
    const reached = state === D.PLACED || state === D.UNCONFIRMED;   // the states where text actually reached the pane
    const queued = reached && Boolean(v && v.queued === true);   // #5216: PLACED into a busy, mid-turn composer; submitted when the turn ends -> it DID land
    const held = Boolean(v && v.held === true);   // COULD_NOT + held: the agent is paused (quota/cap/menu/usage-limit/signed-out), or its composer holds the person's own text (inputHold, heldBy 'input'). chat typed NOTHING; the hold's "keep for next arrival" is a room-post behaviour this direct path lacks, so nothing landed and nothing will.
    const busy = Boolean(v && v.busy === true);    // a transient collision placing another line: nothing landed this instant

    // Book the dedup ONLY when the prompt actually landed (reached). A HELD verdict (agent paused,
    // nothing typed), a busy collision, or a bare COULD_NOT did NOT land and chat says re-sending is
    // safe, so leave the task un-booked: a later mark of the same task (e.g. a close after the build)
    // may still reach it. This matches the idle sweep, which also leaves a held/busy delivery unbooked.
    if (reached) book.set(key, { at: now, session });

    const act = reached ? (queued ? 'queued' : 'prompted') : (held ? 'held' : (busy ? 'pane-busy' : 'not-reached'));
    return { session, name, act, delivery: state || null, recorded: reached };
  } catch {
    return skip('error');   // never throws: a prompt is best-effort
  }
}

/* The dedup book on disk, so restarts cannot re-prompt a task. { "<projectId>\t<taskNumber>":
   { at: ms, session } }, atomic tmp + rename; an unreadable or odd file reads as an empty book.
   Mirrors engine/communityturn.js's readBook/writeBook. */
function bookFile() { return require('node:path').join(require('./store').ROOT, 'communitytaskdone.json'); }
function readBook() {
  const fs = require('node:fs');
  const out = new Map();
  try {
    const d = JSON.parse(fs.readFileSync(bookFile(), 'utf8'));
    if (d && typeof d === 'object' && !Array.isArray(d)) {
      for (const [k, v] of Object.entries(d)) {
        if (v && typeof v === 'object' && Number.isFinite(v.at) && typeof v.session === 'string') out.set(k, { at: v.at, session: v.session });
      }
    }
  } catch { /* none yet, or unreadable: an empty book */ }
  return out;
}
function writeBook(book, now = Date.now()) {
  const obj = {};
  for (const [k, v] of (book instanceof Map ? book : new Map())) {
    if (v && Number.isFinite(v.at) && typeof v.session === 'string' && now - v.at < RETENTION_MS) obj[k] = { at: v.at, session: v.session };
  }
  try {
    require('node:fs').mkdirSync(require('node:path').dirname(bookFile()), { recursive: true });
    require('./store').saveFlushed(bookFile(), JSON.stringify(obj) + '\n');   // #5434: flushed before the rename
    return true;
  } catch { return false; }
}

module.exports = { taskDoneText, promptOnTaskDone, readBook, writeBook, bookFile, POST_CLAUSE, PROMPTS_PER_DAY, RETENTION_MS, DAY_MS };
