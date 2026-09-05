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

- A fail-0 red during a cut (node passed, shell stage red) is re-run ALONE (`yarn -s
  test:shell`) up to `max` attempts and DISMISSED only on a green; a persistent red
  still aborts.
- The change never dismisses anything that is not the shell stage: a coverage
  mismatch (fires before node -> empty tally) still aborts; the browser-check gate is
  fail-soft on the frozen trunk (cannot red here) so a fail-0 red is necessarily the
  shell stage.
- Unit-tested off-box (test-cut-rerun-guard.sh) with a contention case (dismiss), a
  persistent-red control (abort), a transient red-then-green case (dismiss on retry),
  a cwd check, and errexit-safety; both verdicts perturbation-verified.

## Safety argument (why a fail-0 dismiss is sound)

run-tests.sh order after a green node suite: (1) `yarn -s test:shell` then (2) the
repo-local browser-check gate. The coverage assertion fires BEFORE the node suite, so
a coverage red yields no node tally at all -> caught by the existing empty-tally abort,
never reaching the fail-0 branch. The browser-check gate diffs `origin/main...HEAD` and
is FAIL-SOFT (returns 0 when it cannot diff or there is no web/ change), so on the cut's
frozen trunk it cannot red. Therefore a fail-0 red during a cut is the SHELL stage, and
the same asymmetry applies: a single green rerun of the shell stage alone proves the red
was starvation.

Weakest premise: "the browser-check gate cannot red on the cut's frozen trunk." It rests
on the gate being fail-soft and the trunk having no web/ diff against origin/main. If a
cut ever ran on a tree with a real web/ diff against origin/main AND that change lacked
a browser-check assertion, the gate could red and a shell-stage rerun going green would
wrongly dismiss it. Mitigation: cuts run the frozen trunk (an ancestor of / equal to
origin/main), where that diff is empty; and any such web/ gap would already have been
refused at PR time by the same gate. Documented in the lib.

## Changes

- `tools/lib/cut-rerun-guard.sh`: add `kosmos_shell_stage_rerun_verdict`; route the
  fail-0 branch to it instead of an unconditional abort. Seams
  `KOSMOS_SHELL_RERUN_CMD` (default `yarn -s test:shell`) and `KOSMOS_SHELL_RERUN_SLEEP`
  (default 5s between attempts; external contention clears with time, not by removing
  the cut's own parallelism (test:shell is sequential)). Errexit-safe.
- `tools/test-cut-rerun-guard.sh`: rewrite the fail-0 section to drive the new behavior
  via the seam (no real 2-minute suite); add the six cases above.
- `tools/release.sh`: comment + two narration strings updated to say the guard now
  covers the shell stage too. No behavior change at the call site (it already passes
  2 args; `max` defaults to 3).

## Release-path coordination (NOT box-gated code, but merge IS sequenced)

- Building + unit-testing is off-box (test-cut-rerun-guard.sh is a pure unit test).
- The change touches release.sh; Splinter confirmed (2026-09-05 ~00:22) Baron is
  EXECUTING release.sh (the 0.6.30 re-cut), not editing it, and I am in a worktree,
  no collision. MERGE only AFTER Baron's 0.6.30 re-cut lands (so his re-cut runs the
  current release.sh, not this in-progress step-3 change), and flag Splinter to
  coordinate the release.sh handoff. His NEXT cut then runs this shell-stage rerun.
- No web/ change, so no browser-check gate chain; the full-suite validation is held for
  a quiet box only to avoid starving the pending re-cut, not because the change needs it.
