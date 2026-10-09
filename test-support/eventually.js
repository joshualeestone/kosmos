'use strict';
// #5727: the ONE shared wall-clock poll helper for the test suite. It replaces the
// ~88 hand-rolled until()/waitFor()/poll() copies (47 files), each a private loop
// that polls a logical condition against a fixed wall-clock deadline. Under host
// load those fixed deadlines false-red: the work is correct but gets descheduled,
// so a full local suite on a contended box reds about one timing test per run (see
// #5727 for the measurement). This helper polls the same way but scales its deadline
// by KOSMOS_TEST_TIME_SCALE, which tools/run-tests.sh computes ONCE per run from the
// box's load-per-core (tools/lib/test-time-scale.sh) and exports for the whole suite.
//
// Why scaling UP is safe, and does not weaken any assertion: a wall-clock budget here
// is a LIVENESS ceiling ("this should become true soon"), never a performance floor.
// Giving a logical predicate more time on a slow box cannot make a FALSE predicate
// look true -- a condition that never holds still times out at any scale, so a real
// hang is still caught. At scale 1 (CI, an unloaded box, or the variable unset) every
// budget is byte-identical to the loops this replaces. The one thing a wall-clock
// budget must never do is get SHORTER, so the scale is floored at 1 here regardless
// of what the environment says; the 4x cap lives in the runner that sets the value.

// Read ONCE at module load (the suite's scale is fixed for the whole run; #2749's
// "read the moving load once" lesson). A value <= 1, absent, or non-numeric means 1.
const RAW = Number(process.env.KOSMOS_TEST_TIME_SCALE);
const SCALE = Number.isFinite(RAW) && RAW > 1 ? RAW : 1;

// Scale a wall-clock LIVENESS budget in ms. Math.ceil so a scaled budget is never a
// fraction of a millisecond short of the literal (and scaleBudget(n) === n at scale 1).
function scaleBudget(ms) {
  return Math.ceil(ms * SCALE);
}

// Poll probe() every stepMs until pred(value) is truthy, then return that value.
// Throw once the SCALED budget elapses, naming the scale and the last value so the
// reader of a red sees both why it timed out and whether the box was loaded. probe
// may be sync or async. The first probe+pred check happens before the deadline is
// ever consulted, so a predicate already true returns without waiting (as the
// hand-rolled loops did). opts.describe(value) formats the last value for the error.
async function eventually(probe, pred, opts = {}) {
  const { timeoutMs = 4000, stepMs = 20, describe } = opts;
  const budget = scaleBudget(timeoutMs);
  const start = Date.now();
  for (;;) {
    const value = await probe();
    if (pred(value)) return value;
    if (Date.now() - start > budget) {
      let detail;
      try {
        detail = describe ? describe(value) : `last value: ${JSON.stringify(value)}`;
      } catch {
        detail = 'last value: <unprintable>';
      }
      throw new Error(
        `eventually: condition not met within ${budget}ms (KOSMOS_TEST_TIME_SCALE ${SCALE}x); ${detail}`
      );
    }
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

module.exports = { eventually, scaleBudget, SCALE };
