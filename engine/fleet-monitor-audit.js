'use strict';

/* #3239: pure verdict for the fleet-monitor audit - given the DECLARED expected
 * monitors and the set of launchd labels actually LOADED on a box, which
 * expected monitors are MISSING. No I/O (the launchctl half is
 * tools/fleet-monitor-audit.js), so it is deterministically testable.
 *
 * Turns silent monitor-loss (a rebuild drops a monitor and nothing notices, the
 * exact class the at-rest builder-check itself suffers from) into a caught signal.
 *
 * Directional contract: it reports only expected-but-NOT-loaded. A label loaded
 * on the box that is NOT in the expected set is deliberately ignored - this
 * detector is about a monitor going missing, not about extra jobs, and flagging
 * unknown labels would make it noisy about every unrelated LaunchAgent.
 */

/**
 * @param {Array<{label:string}>} expected  the declared monitors (engine/fleet-monitors.js)
 * @param {Iterable<string>} loadedLabels    launchd labels currently loaded on the box
 * @returns {{ok:boolean, missing:Array, present:Array, expectedCount:number}}
 */
function auditVerdict(expected, loadedLabels) {
  const exp = Array.isArray(expected) ? expected : [];
  const loaded = new Set(loadedLabels || []);
  const missing = exp.filter((m) => m && !loaded.has(m.label));
  const present = exp.filter((m) => m && loaded.has(m.label));
  return { ok: missing.length === 0, missing, present, expectedCount: exp.length };
}

module.exports = { auditVerdict };
