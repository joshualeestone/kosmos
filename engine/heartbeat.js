'use strict';
/* #1722: the product heartbeat's periodic sweep -- the check-and-notify half.
 *
 * DETECTION IS NOT REBUILT HERE. Every agent on the board already carries a
 * `state` classified by engine/status.js `classify()` (WORKING / IDLE / STOPPED
 * / NEEDS_YOU / RATE_LIMITED / AUTH_FAILED / UNKNOWN), the detector the whole
 * product trusts. This sweep COMPOSES that: given the roster's already-classified
 * states and the states it saw last tick, it decides who left the working state
 * and is worth a CHECK-IN. A second detector here would be the "two derivations
 * of the fleet" habit safeRoster's own comment (server.js:684) calls this
 * codebase's worst, and the detector #1722 warned about was the FLEET shell
 * script (fixed separately in #1657), not this one.
 *
 * THE NUDGE IS A QUESTION, NEVER AN ACCUSATION, NEVER SILENCE (Splinter, and it
 * corrects an earlier draft of this file). "A question is cheap, an accusation
 * is expensive, and 'nagging' collapses the two." When an agent that WAS working
 * is now anything but clearly-still-working, the person is ASKED -- "are you
 * mid-something, finished, or stopped?" -- not told a verdict. The heartbeat
 * never asserts "it stopped"; it asks, and the app renders the question (the
 * notify payload carries who + when, never the words -- notify.js).
 *
 * WHY WE DO NOT FAIL TOWARD SILENCE. An unreadable pane is exactly the case an
 * earlier draft carried forward silently. That is Kitty's 70-minute stall: a
 * check that failed toward reassurance while an agent sat idle. Silence has a
 * cost too; it is just paid by somebody who is not in the room, and it collides
 * with Josh's "agents are never idle" ruling. So a working -> UNREADABLE edge is
 * asked about, same as working -> stopped. The "never-UNKNOWN" rule survives as
 * TONE: we never send a stopped/unknown VERDICT, only the question.
 *
 * WHY AN EDGE, NOT A LEVEL. A level ("is it non-working right now") re-asks every
 * tick for the same idle agent and trains the person to ignore the heartbeat.
 * The sweep asks once, on the working -> not-working TRANSITION, exactly as
 * wouldping.saw suppresses a re-fire with `was === state`: the next tick's `was`
 * is the new state, not 'working', so it cannot ask again until the agent works
 * and leaves working afresh.
 *
 * WHICH EXITS FROM WORKING WE ASK ABOUT. STOPPED (Claude process gone), IDLE
 * (finished, sitting at its prompt) and UNKNOWN/unreadable -- the "finished a
 * step, never started the next, or went dark" shapes. NOT needs_you: that is the
 * person's to act on and already has its own notify path (server.js:4569, kind
 * 'needs_you'). NOT rate_limited / auth_failed: account problems with their own
 * meaning, out of v1's "is this agent still moving" scope. NOT working.
 *
 * WEAKEST PREMISE, named not buried: we only ask on a working -> not-working
 * EDGE, so an agent ALREADY idle when the sweep started (`was === undefined`) is
 * not asked about -- no working frame to leave. This matches Josh's intent
 * ("checks which agents ARE WORKING and prompts to chase anyone stopped") and
 * avoids nagging about agents parked idle on purpose. What would change it: to
 * also ask about a currently-idle agent on the first tick, drop the
 * `was === 'working'` guard to `was !== undefined && was === 'working'`-style
 * entry plus a first-sighting policy -- deliberately not taken in v1.
 *
 * NOTE ON SAMPLING. classify()'s spinner comment warns a working pane can read
 * non-working "between frames". That is a sub-second concern for the 5s status
 * tick; the heartbeat samples MINUTES apart, where a non-working reading is a
 * real state, not a frame gap. If false check-ins ever appear, require two
 * consecutive non-working ticks before asking -- a one-line refinement, noted.
 *
 * PURE. This module holds NO timer, NO tmux, NO network, NO setting read. The
 * interval, the live roster capture (snapshot/safeRoster), the on/off setting
 * and the notify.happened call all live in the caller. That keeps the decision
 * unit-testable over synthetic rows.
 */

// Leaving WORKING for one of these warrants a check-in question. UNKNOWN is in
// the set on purpose: an agent that was working and is now unreadable is asked
// about, not passed over in silence.
const ASK_ON_EXIT_TO = new Set(['stopped', 'idle', 'unknown']);

// States that are NOT "still clearly working" for the purpose of the edge. Used
// only to keep the carry-forward of `was` honest; the ask itself keys on
// ASK_ON_EXIT_TO so needs_you / rate_limited / auth_failed never trigger it.
function leftWorking(was, state) {
  return was === 'working' && ASK_ON_EXIT_TO.has(state);
}

/**
 * One heartbeat tick. Pure: no timer, no tmux, no network.
 *
 * @param {Array<{sessionName:string,state:string,confidence?:string}>} roster
 *   the board's agents, each already classified by status.js `classify()`. A
 *   missing/undefined `state` is treated as 'unknown' (unreadable), which is an
 *   ask target from working, never silently dropped.
 * @param {Map<string,string>} prev  sessionName -> the state seen last tick.
 * @returns {{toAsk: Array<{session:string,from:string,to:string}>, next: Map<string,string>}}
 *   toAsk: agents that left the working state this tick; the caller fires one
 *          question-shaped notify.happened per entry. next: the state map to
 *          carry into the next tick.
 */
function tick(roster, prev) {
  const previous = prev instanceof Map ? prev : new Map();
  const next = new Map();
  const toAsk = [];
  const rows = Array.isArray(roster) ? roster : [];
  for (const a of rows) {
    const key = a && a.sessionName;
    if (!key) continue;
    // An unreadable reading (missing state, or CONFIDENCE.NONE) is 'unknown' --
    // a real ask target from working, not a reason to go quiet.
    const noConf = !a.confidence || a.confidence === 'none';
    const state = (a.state === undefined || (noConf && a.state !== 'working'))
      ? 'unknown'
      : a.state;
    const was = previous.get(key);
    next.set(key, state);
    if (leftWorking(was, state)) {
      toAsk.push({ session: key, from: was, to: state });
    }
  }
  return { toAsk, next };
}

module.exports = { tick, leftWorking, ASK_ON_EXIT_TO };
