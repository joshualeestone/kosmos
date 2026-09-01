'use strict';
/* #1722: the working/stopped classifier for the product heartbeat -- Arm A.
 *
 * Ported from the fleet reference ~/.claude/bin/builder-progress-check.sh, whose
 * detector was fixed 2026-08-31 after the old `ctx [0-9]+%.*active` form matched
 * the IDLE status footer (e.g. `... ctx 83%        /rc active`) and scored
 * stopped agents as WORKING -- 3 of 6 panes, and it never flagged an agent stalled
 * for 70 minutes. A heartbeat that fails toward "everything is fine" is worse than
 * none, because it stops you looking.
 *
 * The validated form matches ONLY the live spinner's elapsed timer -- `(12s · ` or
 * `(3m 26s · ` -- which the idle footer never carries. It is deliberately NOT
 * anchored on `tokens)`: the spinner has a longer variant, and an anchored form
 * false-passed a 12-pane control as 3/9. Verified 6/6 against known truth on the
 * fleet, with a negative control (a pane that cannot exist -> stopped) and a
 * positive control (a synthetic spinner -> working).
 *
 * This module is Arm A ONLY and is PURE: a classifier over a single pane-capture
 * string. Arm B (a short pane DELTA across ~6s) needs two captures and belongs to
 * the periodic heartbeat job, not here. An agent is WORKING if EITHER arm fires;
 * STOPPED only when neither does. Biasing toward working is deliberate: a false
 * stop is a harmless nudge, while a genuinely stopped agent fires neither arm and
 * is still caught.
 */

// The live spinner's elapsed timer: `(<Ns> · ` with an optional `<Nm> ` ahead of
// it. The middle dot is U+00B7, part of the spinner's own rendering. One frame
// only -- an agent caught between spinner renders looks idle here, which is why
// Arm B (the pane delta) exists in the periodic job.
const SPINNER_RE = /\(([0-9]+m )?[0-9]+s · /;

/**
 * Arm A of the heartbeat's working detection. Returns true when this pane capture
 * shows the live spinner's elapsed timer. A false result is NOT "stopped" on its
 * own -- the caller must still consult Arm B (the pane delta) before concluding an
 * agent is stopped.
 * @param {string} paneText a single tmux capture-pane of the agent's pane
 * @returns {boolean}
 */
function spinnerActive(paneText) {
  return typeof paneText === 'string' && SPINNER_RE.test(paneText);
}

module.exports = { SPINNER_RE, spinnerActive };
