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

Additive only: no gate, no behavior, no existing output changes. The `step "== N ..."` call sites and
`_STEP` are untouched (the `_step_before_7a="$_STEP"` save/restore around step 7a still works).

## Fail-safe contract (load-bearing)

`step()` also renews the machine claim and is on the critical path, so timing MUST never break it. A
clock that cannot be read leaves `_STEP_START` empty, and every consumer returns before it can fault;
both stamps are integer-guarded with a `case ... *[!0-9]*` check so the `$(( ))` subtraction can never
run on garbage. Verified in isolation: a broken `date` leaves the header printed, no timing line, exit
0.

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
