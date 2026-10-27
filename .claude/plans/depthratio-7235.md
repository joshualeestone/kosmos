# depthratio-7235: the depth-ratio test samples both depths interleaved

Card kosmos#7235 (filed by Ice Cream Kitty): engine/backuprestore.test.js's "collision check scales linearly with path
depth" test (bound 7.5) failed about 1 run in 4 inside full suites, with ratios of 8 to 9, on branches that do not
touch it.

## Measured
- Alone (12 runs of only this test, light lane, other suites on the Mac): ratio 3.75 to 3.88, 12 of 12 pass. So the
  trie and the bound are fine, and warm-up landing in the first (deeper) measurement is NOT the cause: it would show
  alone too.
- The old test took all three depth-2000 samples, then all three depth-500 samples (best of each). Inside a full
  suite, a load burst during one block lands on one side of the ratio only.

## The call
- Test-only, as it stands after round 5: build each depth's fixture once (untimed), warm up deep then shallow, then five
  adjacent pairs with the order alternating inside them, timed in CPU time (process.cpuUsage, user + system), and the
  MEDIAN of the five pair ratios against the unchanged bound of 7.5. The failure message lists the pairs in the order
  taken.
- First version (min of each side, wall time), alone: 3.70 to 3.85, 12 of 12. Superseded by rounds 1 and 2 below.

## Rejected
- Raising the bound: the quadratic check this guards measured about 13; a looser bound weakens the guard.
- Skipping the test under load: hides the regression it exists to catch.

## Weakest premise
- That load drift between blocks is the cause. It fits (failures only inside full suites, none in 24 runs alone) but
  a full suite cannot be made to reproduce a failure on demand, so the fix is reasoned, not measured, against the
  failing case.

## What would change my mind
- A pair reading high in CPU time inside a suite: the same work costs more CPU on an efficiency core or with caches
  contended. The median absorbs two such pairs; three in one run would need a fit across more samples.
- A failure of the new version inside a full suite: then the ratio itself moves under load and the test needs a
  different shape (for example a fit across three depths).

## Review rounds
- Round 1 (blind, 17:40): applied. The fixtures are built once per depth and only run() is timed (building them was
  inside the timed region). The ratio is now the MEDIAN of five adjacent (shallow, deep) pair ratios. Not min/min:
  each side's best can come from different moments. Not the minimum of the pair ratios: one slow shallow sample would
  drag it down and hide a real regression. A median of adjacent pairs needs three of five pairs to be disturbed
  before it moves. Comments reworded so the fix reads as reasoned, not measured, against the failing case.
- After round 1, alone (12 runs, light lane, 18:1x CDT): median ratio 3.72 to 3.88, 12 of 12 pass; per-pair spread
  3.43 to 4.14. The bound stays 7.5 (the quadratic check measured about 13).
- Round 2 (blind, sonnet, 18:2x): (1) WARNING, the median of five still lets a deep-biased burst win when bursts hit
  most pairs: applied by timing CPU time instead of wall time, which removes preemption (time another process held
  the core). Round 3 corrected the overclaim: it does not remove core migration or cache contention (see round 3). (3) the plan's "The call" was stale: rewritten. (4) the failure message now lists
  every pair ratio. DECLINED (2), a depth^1.5 regression may land near 7.5: the bound is inherited from #5536, and the
  card is the flake, not the guard's sensitivity; tightening it is new scope and would make load matter more again.
- After round 2, alone (12 runs, light lane, 19:4x CDT), CPU time: median ratio 3.58 to 3.98, 12 of 12; per-pair spread
  2.93 to 4.60. Whole engine/backuprestore.test.js 24 of 24. Printed from an untracked copy of the test with one
  console.log added, deleted after; the committed test was never edited for the measurement.
- Round 3 (blind, default model, 19:5x CDT): no BLOCKER. Applied:
  (1) WARNING: my comment and this plan said CPU time removes the cause. It removes preemption only. On Apple silicon,
  work costs 2 to 3 times the CPU time on an efficiency core, and cache contention inflates it. My own numbers showed a
  WIDER per-pair spread in CPU time (2.93 to 4.60) than in wall time (3.43 to 4.14). Reworded: the median is what
  absorbs load. Added to what would change my mind.
  (2) WARNING (minor): always shallow-after-deep charges the deep run's GC to the next shallow sample, a steady pull
  down that hides a regression. The order now alternates inside pairs.
  (3, 4) NITs: the 10-08 range restated as measured (x3.8 to x4.5), and the "reads about 3.8" line is attributed to the
  old test.
  Measured after round 3, 12 runs, with the Mac at 1-minute load 38.6 on 12 cores (19:55 CDT, other agents' suites):
  median 3.54 to 3.98, 12 of 12 under 7.5; per-pair spread 2.94 to 4.97. Whole file 24 of 24. This is close to the
  loaded condition the card failed under, which the earlier measurements were not. Printed from an untracked copy, as
  before, which was deleted afterwards.
- Round 4 (blind, sonnet, 19:5x CDT): no BLOCKER or WARNING. NITs applied:
  (1) alternation alone left 3 shallow samples and 2 deep after a deep run. The warm-up now runs deep then shallow, which
  makes it 2 and 2, and the comment says exactly that.
  (2) the failure message lists the pairs in the order taken, not sorted.
  (3) the comment cites the round-3 range (3.54 to 3.98 at load 38).
  (4) review-round narration was trimmed from the code.
- Round 5 (blind, default model, 19:5x CDT): no BLOCKER or WARNING. NITs applied:
  (1) "The call" described round 2's order; it now describes the code as it stands.
  (2) The comment's range was measured before round 4's warm-up change. Re-measured with the final order, 12 runs at
  load 13 to 22: median 3.22 to 4.12, 12 of 12 under 7.5, single pairs as high as 6.0 (the median absorbed them). Whole
  file 24 of 24. The comment cites this run.
