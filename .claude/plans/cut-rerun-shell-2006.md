# Plan: #2006 shell-stage extension of the cut's isolation-rerun

## Problem

`tools/release.sh` step 3 runs `yarn test` on the frozen trunk and gates the cut on
it. Under the load a cut creates on this shared 18-agent box, a load-sensitive test
can red for a reason unrelated to the change. #2006 built `kosmos_isolation_rerun_verdict`
(tools/lib/cut-rerun-guard.sh) to auto-apply the standard discriminator: rerun a
failing test FILE alone, dismiss only on a green (contention makes false reds, never
false greens).

That handles NODE test files. It does NOT handle the SHELL stage. Baron Draxum,
2026-09-05 00:03, on two live 0.6.30 staging-cut aborts: the failing tests were the
browser-run-guard SHELL tests (`test-browser-run-guard.sh`: "does not refuse itself",
"#1391 descendant not excluded"), which correctly refuse when another Playwright run
is live on the box. `yarn test` runs the node suite green, then `yarn -s test:shell`
reds, so node's `ℹ fail N` tally is 0, and the current guard hits its fail-0 branch
and ABORTS without trying:

```
isolation-rerun: node reported 0 failing tests, so this red is a later stage
(a shell test, the browser-check gate, or the coverage assertion), not an
isolable node test file. Not dismissing; the cut aborts.
```

So the auto-dismiss has a gap exactly where the MOST contention-sensitive tests live.
The workaround tonight was a brokered browser-quiet window; this is the durable fix.

## What "done" looks like

- A fail-0 red during a cut (node's tally is 0, so the red is not an isolable node
  file) is handled by re-running the WHOLE `yarn test` gate ALONE up to `max` attempts;
  DISMISSED only on a green, a persistent red still aborts.
- The change never dismisses a real red: re-running the exact gate reproduces a real
  red in ANY stage (a node process-error, a shell test, or the browser-check gate). A
  coverage mismatch (fires before node -> empty tally) still aborts before this branch.
- Unit-tested off-box (test-cut-rerun-guard.sh) with a contention case (dismiss), a
  persistent-red control (abort), a transient red-then-green case (dismiss on retry),
  a cwd check, and errexit-safety on BOTH the dismiss and the multi-attempt abort paths;
  both verdicts perturbation-verified.

## Safety argument (why a fail-0 dismiss is sound)

The first design re-ran only `yarn -s test:shell` on the fail-0 path, on the premise
that a fail-0 red is necessarily the shell stage. Blind review found the hole: node's
`ℹ fail 0` TALLY is not node's EXIT status. node can exit non-zero while printing
`ℹ fail 0` and no `test at` line (a top-level unhandled rejection, a lingering handle),
in which case run-tests.sh stops AT node, the shell stage never runs, and re-running
only `test:shell` would pass on a quiet box and wrongly dismiss a genuine node-stage red.

Fix: do not guess which stage failed. Re-run the EXACT gate the cut ran (`yarn test`),
which reproduces a real red in any stage, and dismiss only when the whole gate goes
green. The asymmetry still carries the safety (contention makes false reds, never false
greens). A coverage mismatch fires BEFORE the node suite (no tally at all) and is caught
by the existing empty-tally abort, so it never reaches this branch. Re-running through
run-tests.sh from inside the cut is safe: its #1962 machine-claim consult is
cookie-excluded, so the cut's own `yarn test` self-excludes and runs rather than
refusing (run-tests.sh:54-62, verified).

Cost accepted: the fail-0 rerun re-runs the node suite too (heavier than a shell-only
rerun). In the common shell-contention case node already passed, so it re-passes; the
node re-run is the price of not guessing the stage, and it is bounded (`max` attempts).
Under persistent external load a node concurrency test may starve on the rerun and abort
-- the SAFE direction (a stall, never a false dismiss), matching the #2017 external-load
scope note.

## Changes

- `tools/lib/cut-rerun-guard.sh`: add `kosmos_whole_suite_rerun_verdict`; route the
  fail-0 branch to it instead of an unconditional abort. Seams `KOSMOS_SUITE_RERUN_CMD`
  (default `yarn test`) and `KOSMOS_SUITE_RERUN_SLEEP` (default 5s between attempts;
  external contention clears with time). Errexit-safe.
- `tools/test-cut-rerun-guard.sh`: rewrite the fail-0 section to drive the new behavior
  via the seam (no real 2-minute suite); cases above plus a multi-attempt errexit test.
- `tools/release.sh`: comment + two narration strings updated to say the guard now
  covers the fail-0 whole-gate rerun too. No behavior change at the call site (it
  already passes 2 args; `max` defaults to 3).

## Release-path coordination (NOT box-gated code, but merge IS sequenced)

- Building + unit-testing is off-box (test-cut-rerun-guard.sh is a pure unit test).
- The change touches release.sh; Splinter confirmed (2026-09-05 ~00:22) Baron is
  EXECUTING release.sh (the 0.6.30 re-cut), not editing it, and I am in a worktree,
  no collision. MERGE only AFTER Baron's 0.6.30 re-cut lands (so his re-cut runs the
  current release.sh, not this in-progress step-3 change), and flag Splinter to
  coordinate the release.sh handoff. His NEXT cut then runs this shell-stage rerun.
- No web/ change, so no browser-check gate chain; the full-suite validation is held for
  a quiet box only to avoid starving the pending re-cut, not because the change needs it.
