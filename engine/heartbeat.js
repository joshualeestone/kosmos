'use strict';
/* #1722: the product heartbeat's periodic sweep -- the check-and-notify half.
 *
 * DETECTION IS NOT REBUILT HERE. Every agent on the board already carries a
 * `state` classified by engine/status.js `classify()` (WORKING / IDLE / STOPPED
 * / NEEDS_YOU / RATE_LIMITED / AUTH_FAILED / UNKNOWN), the detector the whole
 * product trusts. This sweep COMPOSES that: given the roster's already-classified
 * states and what it saw last tick, it decides who is in an open STALL and worth
 * a CHECK-IN. A second detector here would be the "two derivations of the fleet"
 * habit safeRoster's own comment (server.js:684) calls this codebase's worst,
 * and the detector #1722 warned about was the FLEET shell script (fixed in
 * #1657), not this one.
 *
 * THE NUDGE IS A QUESTION, NEVER AN ACCUSATION, NEVER SILENCE (Splinter). "A
 * question is cheap, an accusation is expensive, and 'nagging' collapses the
 * two." When an agent that WAS working is now anything but clearly-still-working,
 * the person is ASKED -- "mid-something, finished, or stopped?" -- not told a
 * verdict. The heartbeat never asserts "it stopped"; it asks, and the app renders
 * the question (the notify payload carries who + when, never the words).
 *
 * WE DO NOT FAIL TOWARD SILENCE. An unreadable pane is asked about, same as a
 * stop -- that is Kitty's 70-minute stall, a check that failed toward reassurance
 * while an agent sat idle. Silence has a cost too; it is paid by somebody not in
 * the room, and it collides with Josh's "agents are never idle" ruling. The
 * "never-UNKNOWN" rule survives as TONE: no stopped/unknown VERDICT, only the
 * question.
 *
 * 🛑 AN UNCONFIRMED ASK MUST NOT BURN THE SLOT (Splinter, from #1724's measured
 * finding). Injected/notified prompts do NOT reliably land: 278 of ~2479 sends
 * on this box tonight (11%) pasted into a composer and were NEVER submitted, with
 * no signal to the sender -- and our own notify.happened is fire-and-forget HTTP
 * with NO delivery confirmation at all (the relay endpoint does not exist yet).
 * A heartbeat that emits a check_in and ASSUMES it landed would mark the agent
 * "asked", never ask again, and leave it sitting stopped while the monitor
 * reports it handled -- the EXACT failure #1722 exists to remove. So the "asked"
 * slot advances ONLY on CONFIRMED delivery, which is the RUNNER's job after the
 * send returns (this pure module never sets it true). With no confirmation
 * channel today, an open stall is re-asked every tick -- at the heartbeat's
 * minute cadence that is the intended "chase anyone stopped", not a 5-second nag,
 * and it fails toward asking. When a real receipt exists (the relay's notify
 * ACK), the runner flips `asked` on receipt and the re-asking stops on its own.
 *
 * TWO WAYS AN EPISODE OPENS -- and the second one is tonight's actual incident,
 * not an edge case. (1) THE EDGE: the working -> not-working transition opens an
 * episode immediately -- a working agent that just stopped is a confident stall.
 * (2) THE PERSISTENT STALL: an agent that was NEVER working (no edge to catch)
 * but is still stalled after STARTUP_STALL_TICKS consecutive ticks opens one too.
 *
 * 🛑 WHY (2) EXISTS. An earlier draft opened ONLY on the edge and named the
 * came-up-stalled agent as its weakest premise. That premise IS the worst failure
 * this fleet had tonight: Splinter was restarted at 21:31, came up BLOCKED on a
 * trust prompt, and sat dead -- it never worked, so it never made a
 * working->stopped transition, so an edge-only model has no episode for it and
 * would stay silent about a bot that was dead from the moment it started (two
 * independent monitors were). A never-worked agent still stalled after a couple
 * of intervals has earned a QUESTION. The N-tick wait is deliberate: a freshly
 * started agent may be legitimately mid-boot, so a stopped/unknown reading on tick
 * one is not yet evidence of a stall -- but a persistent one is, and the nudge is
 * still "mid-something, finished, or stopped?", never a verdict.
 *
 * An episode stays open until the agent works again (or is handed to the person
 * via needs_you). Within an open episode we ask until an ask is confirmed
 * delivered. An agent parked idle on purpose is still asked once per persistent
 * stall -- fail toward asking; the person can turn the heartbeat off.
 *
 * SAMPLING. classify() warns a working pane can read non-working "between
 * frames" -- a sub-second concern for the 5s status tick. The heartbeat samples
 * MINUTES apart, where a non-working reading is a real state. If false check-ins
 * appear, require two consecutive non-working ticks before opening -- a one-line
 * refinement, noted.
 *
 * PURE. No timer, no tmux, no network, no setting read, and it never sets
 * `asked` true (only the runner does, post-delivery). Unit-testable over
 * synthetic rows.
 */

// Leaving WORKING for one of these is a stall worth a check-in: not working, with
// no OTHER notify path, and not merely transient. UNKNOWN is in the set on purpose
// (a working agent gone unreadable is asked about, not passed over). AUTH_FAILED is
// too: a rejected token means the agent is dead until the person reconnects, and
// unlike needs_you it has NO other path to the person -- silently closing its
// episode would leave exactly the "agent stopped working" this feature exists to
// surface un-surfaced. NEEDS_YOU (its own notify path) and RATE_LIMITED (transient,
// the account works again on its own) are deliberately NOT here -- see the else
// branch in tick().
const ASK_ON_EXIT_TO = new Set(['stopped', 'idle', 'unknown', 'auth_failed']);

// Consecutive stall ticks a NEVER-worked agent must show before a persistent
// stall opens an episode for it (see "TWO WAYS AN EPISODE OPENS", case 2). Two
// gives a freshly started agent a boot grace of ~1 interval before the first
// question, which at the 17-min default is generous. Tunable; the edge opener
// (case 1) is unaffected and stays immediate.
const STARTUP_STALL_TICKS = 2;

function isStallState(state) { return ASK_ON_EXIT_TO.has(state); }

/**
 * Normalise a classified row to the state the sweep reasons about. An
 * unreadable reading (missing state, or CONFIDENCE.NONE that is not 'working')
 * becomes 'unknown' -- an ask target, never silently dropped.
 */
function stateOf(a) {
  const noConf = !a.confidence || a.confidence === 'none';
  if (a.state === undefined) return 'unknown';
  if (noConf && a.state !== 'working') return 'unknown';
  return a.state;
}

/**
 * One heartbeat tick. Pure: no timer, no tmux, no network. NEVER sets a record's
 * `asked` to true -- confirmed delivery is the runner's responsibility.
 *
 * @param {Array<{sessionName:string,state:string,confidence?:string}>} roster
 *   the board's agents, each already classified by status.js `classify()`.
 * @param {Map<string,{prev?:string,open:boolean,asked:boolean,streak:number}>} prev
 *   per-agent record from last tick. `open` = in a stall episode; `asked` = a
 *   CONFIRMED-delivered ask exists for this open episode; `streak` = consecutive
 *   stall ticks with no episode yet (the persistent-stall counter).
 * @returns {{toAsk: Array<{session:string,from?:string,to:string}>, next: Map}}
 *   toAsk: agents to ask NOW (fire one question-shaped notify.happened each; on
 *          CONFIRMED delivery the runner sets next.get(session).asked = true).
 *   next: the record map to carry into the following tick.
 */
function tick(roster, prev) {
  const previous = prev instanceof Map ? prev : new Map();
  const next = new Map();
  const toAsk = [];
  const rows = Array.isArray(roster) ? roster : [];
  for (const a of rows) {
    const key = a && a.sessionName;
    if (!key) continue;
    const state = stateOf(a);
    const rec = previous.get(key) || { prev: undefined, open: false, asked: false, streak: 0 };
    let open = rec.open;
    let asked = rec.asked;
    let streak = rec.streak || 0;
    if (state === 'working') {
      // Resumed: episode over, streak reset, any future stall is a fresh one.
      open = false;
      asked = false;
      streak = 0;
    } else if (isStallState(state)) {
      if (open) {
        // A still-open episode stays open and keeps its `asked`.
        streak = 0;
      } else if (rec.prev === 'working') {
        // (1) THE EDGE: a working agent just stopped -- open immediately.
        open = true;
        asked = false;
        streak = 0;
      } else {
        // (2) THE PERSISTENT STALL: never-worked (or long-idle) agent. Give it a
        // boot grace of STARTUP_STALL_TICKS before opening, so a normal boot is
        // not nagged but a came-up-dead bot (Splinter, 21:31) is not missed.
        streak += 1;
        if (streak >= STARTUP_STALL_TICKS) {
          open = true;
          asked = false;
          streak = 0;
        }
      }
    } else {
      // needs_you / rate_limited: not a stall this sweep chases. needs_you already
      // reaches the person on its own notify path; rate_limited is transient (the
      // account works again on its own). Close the episode so we neither chase them
      // nor, later, count them as a fresh stall. (auth_failed is NOT here -- it is
      // in ASK_ON_EXIT_TO, because it is dead-until-reconnect with no other path.)
      open = false;
      asked = false;
      streak = 0;
    }
    if (open && !asked) {
      toAsk.push({ session: key, from: rec.prev, to: state });
    }
    next.set(key, { prev: state, open, asked, streak });
  }
  return { toAsk, next };
}

/**
 * Map the board's roster (snapshot().agents / safeRoster()) to the rows tick()
 * reads. The board carries the classifier's confidence as `stateConfidence`, not
 * `confidence`, so a straight pass would drop it and make every reading look
 * fully confident. Tolerates a null roster (safeRoster returns null when tmux
 * cannot be asked) by yielding [] -- a tick over nothing, never a throw.
 * @param {Array|null} roster
 * @returns {Array<{sessionName:string,state:string,confidence?:string,name?:string}>}
 */
function rowsFrom(roster) {
  if (!Array.isArray(roster)) return [];
  return roster
    .filter((a) => a && a.sessionName)
    .map((a) => ({ sessionName: a.sessionName, state: a.state, confidence: a.stateConfidence, name: a.name }));
}

/**
 * One heartbeat step for the runner. When the setting is OFF, the baseline is
 * reset (an empty `next`) so turning it back on starts fresh: a state carried
 * across an off period would fabricate a stale working -> stall edge the moment
 * the person re-enables the heartbeat. When ON, it is tick() over the mapped
 * rows. The runner (server.js) supplies `on` from heartbeat-setting and does the
 * notify + timing; this stays pure.
 * @param {Map} prev
 * @param {Array|null} roster  the board roster (unmapped)
 * @param {boolean} on
 */
function step(prev, roster, on) {
  if (!on) return { toAsk: [], next: new Map() };
  // A NULL roster is a READ FAILURE (safeRoster returns null when tmux cannot be
  // asked), NOT "no agents exist" (which is an empty array). Preserve the prev
  // memory and skip this tick: wiping every agent's open/asked/streak on one
  // transient failure would make a confirmed-asked stall re-ask a few ticks
  // later, and treat a momentary blind spot as if the fleet had emptied.
  if (roster === null || roster === undefined) {
    return { toAsk: [], next: prev instanceof Map ? prev : new Map() };
  }
  return tick(rowsFrom(roster), prev);
}

module.exports = { tick, step, rowsFrom, stateOf, isStallState, ASK_ON_EXIT_TO, STARTUP_STALL_TICKS };
