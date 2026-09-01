'use strict';
/* #1724 (the integration / consume half): the periodic sweep that turns the
 * auto-handoff SETTING into ACTION. Mona Lisa built the capture + decision core
 * (engine/autohandoff.js: shouldPrompt, handoffPrompt, fillBand, settingFrom),
 * the store/route and the UI; this sweep CONSUMES them. It is what makes
 * autohandoff.shouldPrompt reachable (engine.reachable.test.js was telling the
 * truth: an exported, tested decision that nothing called). It is ADD ONLY --
 * it never modifies her committed autohandoff.js; it composes it.
 *
 * WHAT IT DOES. On each pass, if the setting is enabled, it reads every agent's
 * live context-window fill (the board already computes it per agent as
 * `agent.context.percent`, status.js readContext) and asks
 * autohandoff.shouldPrompt whether this agent has crossed into a new fill band.
 * If so it injects the handoff prompt into the agent's pane (chat.deliver), so a
 * long piece of work is captured before the window fills -- the card's whole
 * point.
 *
 * 🛑 AN UNCONFIRMED INJECT MUST NOT ADVANCE THE BAND (Splinter, measured 08-31,
 * and the single decision that keeps this from being a false-green monitor).
 * Injected sends do not reliably land: 11% pasted into a composer and were never
 * submitted, with no signal. chat.deliver returns a three-state verdict
 * (PLACED / UNCONFIRMED / COULD_NOT). The band advances ONLY on PLACED. On
 * UNCONFIRMED or COULD_NOT the band is left untouched, so the NEXT sweep retries
 * -- an unconfirmed inject that burned the band would silence the next prompt and
 * leave an agent filling its window while the monitor reported it handled. This
 * is exactly the "advance the band only on PROOF" rule, and it is the same rule
 * the #1722 heartbeat uses for its own check_in ("asked" advances only on
 * confirmed delivery); the two features share the finding, not the code.
 *
 * BAND HYGIENE. When an agent's fill drops below the threshold (a reset, a fresh
 * session), its band is cleared, so a later climb re-prompts rather than being
 * suppressed by a stale high-water band. shouldPrompt fires per-iteration while
 * climbing but only once per 5-point band, so a steady 86% is prompted once.
 *
 * PURE. No timer, no tmux, no disk, no network: every effect is an injected dep
 * (the roster, the deliver function, the path builder), so one pass is
 * unit-testable with a stubbed roster and a scripted deliver -- the demonstration
 * the card asks for. The server wires the real deps and the interval.
 */

/**
 * One auto-handoff sweep pass. Pure over injected deps.
 *
 * @param {object} o
 * @param {{enabled:boolean,threshold:number}} o.setting  from autohandoff.settingFrom
 * @param {Array<{sessionName:string,context?:{percent:?number}}>} o.roster  the board's agents
 * @param {Map<string,number>} o.lastBand  per-agent last-prompted band (mutated + returned)
 * @param {(session:string,text:string)=>{state:string}} o.deliver  injects the prompt; returns a verdict
 * @param {(session:string)=>string} o.pathFor  the handoff path for an agent
 * @param {object} o.autohandoff  Mona's engine/autohandoff (shouldPrompt, handoffPrompt, fillBand)
 * @param {object} o.DELIVERY  chat.DELIVERY ({PLACED, UNCONFIRMED, COULD_NOT})
 * @returns {{prompted: Array<{session:string,fill:number,verdict:?string,advanced:boolean}>, lastBand: Map}}
 */
function sweepOnce({ setting, roster, lastBand, deliver, pathFor, autohandoff, DELIVERY }) {
  const bands = lastBand instanceof Map ? lastBand : new Map();
  const prompted = [];
  if (!setting || setting.enabled !== true) return { prompted, lastBand: bands };
  const rows = Array.isArray(roster) ? roster : [];
  for (const a of rows) {
    const key = a && a.sessionName;
    if (!key) continue;
    const fill = a.context && typeof a.context.percent === 'number' ? a.context.percent : null;
    if (fill === null) continue; // unreadable / not-yet: no basis to prompt on
    if (fill < setting.threshold) {
      // Below the trigger: clear any stale band so a fresh climb re-prompts.
      bands.delete(key);
      continue;
    }
    const was = bands.has(key) ? bands.get(key) : null;
    if (!autohandoff.shouldPrompt(setting.enabled, setting.threshold, fill, was)) continue;
    const verdict = deliver(key, autohandoff.handoffPrompt(fill, pathFor(key)));
    const state = verdict && verdict.state;
    // Advance the band ONLY on confirmed delivery. See the docblock.
    const advanced = state === DELIVERY.PLACED;
    if (advanced) bands.set(key, autohandoff.fillBand(fill));
    prompted.push({ session: key, fill, verdict: state || null, advanced });
  }
  return { prompted, lastBand: bands };
}

module.exports = { sweepOnce };
