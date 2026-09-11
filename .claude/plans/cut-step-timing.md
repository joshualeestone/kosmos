# Cut wall-time: make each step self-report its duration (the measurement foundation)

## Why

The cut (`tools/release.sh`) runs the node suite, ~150 headless render checks, the build, sign,
notarize, staple, deploy and a served-artifact verify SERIALLY. The 0.6.55 cut took 23 minutes
(02:19 -> 02:42), but nothing in the log says where those minutes went: `step()` (release.sh:70) only
echoes the phase header. So the serial suite/render/build have been tuned by guessing.

This is the first, safe lever of the "get cuts out faster" initiative (Josh greenlit): you cannot
optimize a 23-minute serial pipeline you cannot measure. This change adds per-step and total wall-time
so a cut self-reports its own bottleneck; the targeted optimization (caching preferred over
parallelization, because the serial structure partly exists to avoid the contention flakes the render
step hit on a loaded box) follows in later PRs against real, measured numbers.

## What

- `step()` records a start stamp on each phase header and, because it runs at the START of each step,
  emits the wall-time of the step that just ended.
- `cut_record_done()` (runs on exit) emits the final step's wall-time and the whole-cut total.
- Helpers `_step_now()` (epoch seconds, or empty on failure) and `_step_emit_duration()`.

Additive only: no gate, no change to the persisted `cut-suite-runs.log` schema (the new wall-time lines
go to stdout only). The `step "== N ..."` call sites are untouched. Two small existing-behaviour edits
are part of making the timing fail-safe and clean: `step()`'s header `echo "$1"` gains `|| true` (a
broken stdout must not abort the step before its machine-claim renewal -- the same gap the timing
echoes guard); and the step-7a region saves `_STEP_START` alongside `_STEP`, CLEARS it before the 7a
sub-step's `step` call (so 7a emits no spurious partial "step 7" line), and restores it after, so step
7 reports one full wall-time line with 7a's time folded in, not a confusing partial-then-full pair.

## Fail-safe contract (load-bearing)

`step()` also renews the machine claim and is on the critical path, so timing MUST never break it.
release.sh runs under `set -euo pipefail`, so the guard is TWO layers, and the first is the important
one: every `_x=$(_step_now)` capture ends in `|| true`, because under errexit a clock that fails
NON-ZERO (a missing/erroring `date`, not the empty-on-exit-0 case) would otherwise abort the whole
assignment BEFORE any guard could run -- which inside step() would skip the `kosmos_claim_machine`
renewal and inside cut_record_done would suppress the #1388 completion line and flip exit 0 to 1. With
`|| true` the assignment always succeeds (empty value on failure), and the second layer takes over: a
`[ -n ... ]` check plus integer `case ... *[!0-9]*` guards on both stamps, so the `$(( ))` subtraction
can never run on garbage. This is the errexit-safe pattern `tools/lib/cut-rerun-guard.sh` already
mandates. Verified under `set -euo pipefail`: a `date` returning 127 leaves the header printed, the
machine-claim renewal run, the completion line written, and exit 0; no timing line, no abort.

## Precision

Integer-second `date +%s`, so a sub-second step can read +/-1s (a 1s sleep measured 2s in the isolated
test). Negligible for the minutes-scale steps this exists to measure; not worth the non-portable
`%s%N` (macOS `date` has no usable nanoseconds).

## Emitted shape

Lines are prefixed `   (step wall-time -- <label>: <n>s)` and `   (cut wall-time total: <n>s)`,
distinct from every existing log key (`== `, `CUT_EXIT`, `duration_ms`, `PASS`/`FAIL`/`✖`), so no
log parser (#1388 completion decode, #2006 isolation-rerun) can collide with them.

## Validation

- Isolated behavioural test: normal two-step timing emits durations; a broken-clock step still prints
  its header and exits 0.
- `bash -n` and `zsh -n` clean (release.sh is `#!/bin/bash`).
- Release-touching tests green: tools.release-gate.test.js, test-versions-entry-gate.sh,
  test-pending-entry-1455.sh (which asserts the `_STEP` save/restore this change preserves).
- The end-to-end proof is the next real cut printing per-step + total lines; not run here (a 23-minute
  cut is not a unit test), and the change cannot alter cut behavior, only add log lines.

## Next (not this PR)

With real per-step numbers from the next cut, target the true bottleneck: cache the installer .pkg and
node-runtime fetches, memoize unchanged render inputs, and only then consider bounded parallelism with
explicit contention guards (the render step already flakes under load, so parallelism there must be
gated, not naive).
