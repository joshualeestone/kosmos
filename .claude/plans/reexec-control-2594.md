# reexec-control-2594: fix the runner-reexec-1818 control false-red inside a cut

Card: joshualeestone/kosmos#2594 (claimed:pigeonpete). Surfaced by Baron, blocked the 0.6.51 P0 re-cut.

## Root cause (reproduced, not hypothesized)

`tools/test-runner-reexec-1818.sh`'s ARM-3 CONTROL runs `browser-checks.sh` with a live probe and
asserts the live-run guard (browser-checks.sh:110) REFUSES. That guard is skipped when
`KOSMOS_HARNESS_IGNORE_CUT=1` OR `KOSMOS_BC_FROZEN_RUNNER` is set. The control used `env VAR=val`,
which ADDS to but does NOT clear the inherited environment.

During a release cut, step 3's `yarn test` (release.sh:514, which runs this shell test) inherits
`KOSMOS_HARNESS_IGNORE_CUT=1` from the INVOKING environment, and $REPO is release.sh's frozen
DETACHED-HEAD checkout. (release.sh does NOT export that var -- it only READS it as an operator
escape hatch at release.sh:242; a reserved-box cut invocation commonly runs with it set, and the
plain `yarn test` subshell inherits it. Verified end-to-end that release.sh has no export line.)
The control inherited `KOSMOS_HARNESS_IGNORE_CUT=1`, the :110 guard was skipped, and
browser-checks.sh fell through to the detached-HEAD branch (:216 "isolated by release.sh's own
freeze, #597/#611") and exited 0 -- so the control's expected refuse never fired and it FALSE-RED
the cut.

Measured, all arms, from a detached-HEAD worktree:
- plain (no guard-skip var): rc=1, refuses -> control would PASS (detached-HEAD ALONE is not the cause; the guard runs before the freeze block).
- KOSMOS_HARNESS_IGNORE_CUT=1 inherited: rc=0, hits the :216 detached branch -> the exact card failure.
- The fix (`env -u KOSMOS_HARNESS_IGNORE_CUT -u KOSMOS_BC_FROZEN_RUNNER`) under that same env: rc=1, refuses -> control PASSES.
- Also reproduced on a symbolic-HEAD box with ambient IGNORE_CUT=1 (freeze path instead of :216); the unfixed test 1 FAILURE, the fixed test 0 failures. Same root, both fixed.

## Fix

`tools/test-runner-reexec-1818.sh`, ARM 3:
- CONTROL: `env -u KOSMOS_HARNESS_IGNORE_CUT -u KOSMOS_BC_FROZEN_RUNNER ...` so the :110 guard
  ALWAYS runs regardless of the ambient cut env -- the control validly asserts a live probe refuses.
- SUBJECT: `env -u KOSMOS_HARNESS_IGNORE_CUT ...` (it sets FROZEN_RUNNER=1 itself) so its skip is
  attributable to the FROZEN_RUNNER it sets, not a stray inherited IGNORE_CUT.
- A comment records the mechanism and that detached-HEAD alone is not the cause.

## Why `env -u` over "skip the control inside a cut"

The card offered "detect-and-skip the control when inside a cut". `env -u` is stronger: the control
keeps EXERCISING the guard even during a cut (a skip would lose that coverage on exactly the runs
that matter), and it makes each arm assert its own condition rather than the ambient env's.

## Weakest premise (resolved during the challenge loop)

Originally: "release.sh puts `KOSMOS_HARNESS_IGNORE_CUT=1` in step 3's env" was unverified. A blind
reviewer traced release.sh end-to-end: it never exports that var, only READS it (release.sh:242).
So the var reaches the test from the INVOKING environment (a reserved-box cut invocation carrying
it), not from release.sh. Either way the reproduction shows the FAILURE requires only that var (or
FROZEN_RUNNER) in the ambient env, and the fix is correct regardless of which layer sets it --
clearing the guard-skip vars is right whenever the arm's intent is "the guard runs (or is skipped)
because of what THIS arm sets, not what the ambient env carries". Portability of `env -u` was
exercised only on macOS (this fleet's CI + dev boxes are Darwin); `-u` is POSIX and works on GNU
env too, but that was not run here.
