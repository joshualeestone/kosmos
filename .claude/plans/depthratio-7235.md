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
- Test-only: warm both depths once, then alternate five samples of each (500, 2000, 500, 2000, ...) and keep each
  side's minimum. A burst lands on both sides, or on neither best. The bound stays 7.5.
- After the change, alone: 3.70 to 3.85, 12 of 12 (it measures the same thing).

## Rejected
- Raising the bound: the quadratic check this guards measured about 13; a looser bound weakens the guard.
- Skipping the test under load: hides the regression it exists to catch.

## Weakest premise
- That load drift between blocks is the cause. It fits (failures only inside full suites, none in 24 runs alone) but
  a full suite cannot be made to reproduce a failure on demand, so the fix is reasoned, not measured, against the
  failing case.

## What would change my mind
- A failure of the new version inside a full suite: then the ratio itself moves under load and the test needs a
  different shape (for example a fit across three depths).
