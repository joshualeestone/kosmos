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
 * EDGE OPENS THE EPISODE, DELIVERY CLOSES THE ASK. An episode OPENS on the
 * working -> not-working transition and stays open until the agent works again
 * (or is handed to the person via needs_you). Within an open episode we ask
 * until an ask is confirmed delivered. So a startup-idle agent (never worked, no
 * episode) is never asked -- the WEAKEST PREMISE, named: an agent parked idle on
 * purpose is left alone, matching Josh's "checks which agents ARE WORKING".
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

// Leaving WORKING for one of these is a stall worth a check-in. UNKNOWN is in the
// set on purpose: a working agent gone unreadable is asked about, not passed over.
const ASK_ON_EXIT_TO = new Set(['stopped', 'idle', 'unknown']);

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
 * @param {Map<string,{prev?:string,open:boolean,asked:boolean}>} prev
 *   per-agent record from last tick. `open` = in a stall episode that began from
 *   working; `asked` = a CONFIRMED-delivered ask exists for this open episode.
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
    const rec = previous.get(key) || { prev: undefined, open: false, asked: false };
    let open = rec.open;
    let asked = rec.asked;
    if (state === 'working') {
      // Resumed: the episode is over, and any future stall is a fresh one.
      open = false;
      asked = false;
    } else if (isStallState(state)) {
      // Open a new episode only on the working -> stall EDGE. A still-open
      // episode stays open (and keeps its `asked`); a startup-idle agent
      // (rec.prev !== 'working') never opens one.
      if (!open && rec.prev === 'working') {
        open = true;
        asked = false;
      }
    } else {
      // needs_you / rate_limited / auth_failed: not a stall this sweep chases.
      // needs_you already reaches the person on its own path; close the episode
      // so we neither chase it nor, later, count it as a fresh stall.
      open = false;
      asked = false;
    }
    if (open && !asked) {
      toAsk.push({ session: key, from: rec.prev, to: state });
    }
    next.set(key, { prev: state, open, asked });
  }
  return { toAsk, next };
}

module.exports = { tick, stateOf, isStallState, ASK_ON_EXIT_TO };
