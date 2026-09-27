# ktfixture-4206: the run-tests.sh sandbox rule reaches the cut and browser guards (#4206 follow-up)

## Why

#4211 (merged as 478f03df) made the concurrent-cut guard ignore a release.sh fixture with a
`node --test` ancestor. It shared that one rule with heavy-gate through tools/lib/process-fixture.sh.
heavy-gate has a second fixture rule the guards did not share: a process whose cwd or script is in
tools/run-tests.sh's kt<digits> sandbox, because some fixtures detach from node --test.

Baron (review of #4211): in the default suite every release.sh fixture is spawnSync'd under node
--test, so the gap is latent. The next fixture that detaches would trip the cut guard again, while
heavy-gate would already drop it. Two points follow up (1 and 4 of #4219, rebased on 478f03df):
1. move the kt rule into process-fixture.sh;
4. apply the fixture filter to the browser-run guard as well.

## The change

- tools/lib/process-fixture.sh: `_kosmos_path_in_kt_sandbox` (heavy-gate's in_kt_sandbox, moved
  unchanged) and `_kosmos_pid_is_test_fixture pid [script]`: a node --test ancestor, OR a cwd or script
  in the sandbox. An unreadable cwd is not a fixture.
- tools/heavy-gate.sh: `in_kt_sandbox` delegates to the library. heavy-gate's behaviour is unchanged.
- tools/lib/cut-guard.sh: `_kosmos_drop_node_test_fixtures` asks `_kosmos_pid_is_test_fixture`
  (the script word is read in the guard's own line shape); renamed `_kosmos_drop_test_fixtures`
  since it no longer drops only node fixtures. The load-failure stand-in covers the new predicate too
  (without it a missing library still refuses, via command-not-found; the stand-in removes the noise).
- tools/lib/cut-guard.sh: kosmos_refuse_if_browser_run_live applies the same filter after its
  self-subtree exclusion.
- tools/test-cut-guard.sh, in #4211's style (live sleeps through the probe seams, nothing
  pgrep-visible named release.sh or browser-checks.sh):
  - a kt-sandbox fixture (no node ancestor) is not a cut, and the same candidate from / still refuses
    and is named;
  - on the browser guard: a node --test fixture and a kt fixture are not runs, and the same candidate
    with no ancestry still refuses. The browser guard's self pid is one that does not exist, so
    self-exclusion cannot be what drops a candidate.
  - the SCRIPT half: a pid whose script is in a kt folder (cwd /) is not a cut, and the same pid with a
    script outside any sandbox still refuses.
  - a REAL cut running from its frozen build tree, ${TMPDIR}/kosmos-release.<X>/kosmos-<sha> (Baron,
    measured on the 0.7.03 cut), with TMPDIR set to its parent, still refuses and is named.

## Evidence

- test-cut-guard.sh: 0 failures. heavy-gate tests: 39 pass, 0 fail, 1 opt-in live test skipped.
  test-browser-run-guard.sh: all clear.
- Mutations:
  - kt cwd check dropped: the two kt arms go red.
  - browser guard filter dropped: the two browser fixture arms go red.
  - every pid a fixture: the negative controls and the pre-existing refusal arms go red (9 failures).
  - the script check dropped: the kt-script arm goes red.
  - the sandbox rule widened to any child of TMPDIR: the frozen-build-tree arm goes red (a real cut
    dropped), which is the mistake that arm exists to catch.

## Review 2's set -e finding, measured

Review 2 reported that an lsof failure on a pid gone since the snapshot would, under release.sh's
`set -euo pipefail`, end the filter loop and drop a real cut listed after it. Measured in exactly that
shape (a dead pid first, a live one second): both lines kept, the guard refused. The call site
`_kosmos_pid_is_test_fixture ... && continue` puts the predicate in an && context, where bash ignores
-e. A control showed the same unguarded assignment outside such a context does kill the shell. So it
is not live today, but the predicate's safety should not depend on its caller: the lsof and the two
ps assignments now end in `|| x=""`. No test can separate the two (any caller of the predicate is in
such a context), so the measurement is the evidence.

## Review 3

- The frozen-tree arm was rooted under the test's `$T`, which sits in a kt folder where `mktemp`
  honours TMPDIR (Linux under run-tests.sh), so the real-cut control would have gone red there. It is
  now rooted under /tmp by name. Latent here: macOS mktemp ignores TMPDIR, and no Linux job runs
  test:shell.
- The arms wait (up to 3s) for each sleep to reach its cwd instead of a fixed 0.3s, so a late process
  cannot make a control pass for the wrong reason.
- The browser guard's kt arm gained a live-pid negative control.

## Review 4

- A real browser-checks.sh from its own frozen tree (`${TMPDIR}/kosmos-bc-freeze.<X>/kosmos-<sha>`) still
  refuses: the browser guard's counterpart of the cut guard's frozen-tree control.

## Review 5

- The fixed probe pid 86263 is now 99999, which cannot be live on macOS (pids stop at 99998): the
  filter runs a real lsof on each pid, and a live 86263 in someone's kt folder would flake the
  controls red.
- The frozen arms set TMPDIR in its resolved form, the form lsof reports a cwd in, so the cwd half
  reaches the "directly under TMPDIR" branch, not only the script half. The same resolution gap exists
  in production on macOS (TMPDIR /var/..., lsof /private/var/...), where only the regex decides for an
  lsof cwd; that errs toward counting, predates this branch, and is now named in the function comment.
- #4211's older live sleeps run from /, so their cwd can never be a kt folder.
- test-browser-run-guard.sh's temp dir is made under /tmp by name (review 6): its opt-in real-path
  decoy, a genuine browser-checks.sh run from that dir, would otherwise sit in a kt folder on Linux under
  run-tests.sh and be dropped as a fixture by the new browser-guard filter, so it would stop testing.

## Review 7

- #1050's probe-two pid 9191 is now 99998, which cannot be live either: it too goes through a real
  lsof and ancestry walk now.
- The live-pid sandbox arms SKIP loudly where lsof is missing, rather than going red on the tool.
- The frozen arm's comment no longer claims the double slash reaches the matcher.

## Weakest premise

The negative control runs from `/` so it cannot sit in a kt folder. A machine whose $TMPDIR were `/`
would make `/kt<digits>` a sandbox path, but `/` itself still is not one, so the control holds. The kt
arm's directory is under the test's mktemp dir, whose path contains `tmp/kt4206` on every platform.
