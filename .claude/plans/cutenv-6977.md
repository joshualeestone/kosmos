# cutenv-6977: shell tests run in a cut's shape on CI, so cut-only failures fail on their pull request

Card: kosmos#6977 (the 0.7.64 cut aborted twice at step 3 on shell tests that passed every validation). Claimed:
pigeonpete.

## What a cut's step 3 has that a validation does not (measured from release.sh and tools/lib/cut-guard.sh)
- `AGENT_WORKFORCE_HOME` exported: release.sh's cut-only home, an empty folder at `$TMPDIR/kosmos-cut-home`.
- A live `bash tools/release.sh` that is NOT an ancestor of the tests: the subshell release.sh backgrounds to run step
  3b's page checks beside the node suite (#2760) carries the cut's command line. The guard's name arm
  (`kosmos_running_lines`) drops the caller's ancestors, so this subshell, not the cut itself, is what the
  pointer-freeze test's sandboxed release.sh saw. Its marker arm could not have: that test sandboxed HOME, and the
  cut's marker lives in the real `$HOME/.cache/kosmos-run-markers`.

## Decision
- `tools/lib/cut-shape.sh` `kosmos_cut_shape_run [--base DIR] <cmd...>`: a fresh empty `AGENT_WORKFORCE_HOME` (a
  cut's own, if exported, is kept) and a stand-in `bash tools/release.sh` (a sleep loop, started from a scratch folder,
  that ends when the shell that started it ends); runs the command; stops the stand-in and removes the folder,
  red or green; returns the command's status (2 when the shape could not be set up).
- `tools/run-tests.sh`: with `KOSMOS_SHELL_CUT_ENV=1` the shell part (both shard arms) runs through it, with the
  scratch folder beside the kt<pid> sandbox, never in it (a process working there is a test fixture to the guard and
  would not count). The flag is refused outside CI (`GITHUB_ACTIONS`), and any value but 0/1 is refused.
- `.github/workflows/test.yml`: `KOSMOS_SHELL_CUT_ENV` is 1 for the shell jobs only.

Rejected:
- Turning it on in local validation (mortals-validate / `yarn test`). The stand-in is visible to every cut guard on
  the computer, so for the ~20 minutes of a shell part every other agent's suite or cut would wait or refuse. CI runs
  each job on its own runner, and every pull request passes CI before it merges, which is where both 0.7.64 failures
  needed catching.
- Writing a cut marker for the stand-in: not needed to reproduce either failure class, and the marker folder is
  machine-wide.
- Running the shell part twice (plain and cut-shaped): doubles ~17 minutes of CI for coverage the local run already
  gives (local validation stays plain, so the non-cut environment is still tested on every validation).

## Proof
- `tools/test-cut-shape-6977.sh`: a cut-only test (needs AGENT_WORKFORCE_HOME unset) fails under the shape, CONTROL
  passes outside it, a cut-neutral test passes under it, the exit status comes back; the home is absolute, empty,
  kept if a cut's own, removed after (red too); the stand-in is live inside, gone after (red too), and ends when the
  run is killed -9; locally the guard's process match lists the stand-in and the fixture filter then drops it (so the
  test never reads as a cut to anyone); on CI the cut guard refuses inside the shape and not after (CONTROL); the
  run-tests.sh and test.yml wiring.
- Real reproduction, the #6922 class: `tools/test-staging-agent-online-check.sh` on current main (its fix #6976 not
  yet merged) passes plain (rc=0) and fails under `kosmos_cut_shape_run` (rc=1, its launchctl arm).

## Weakest premise
That step 3b's backgrounded subshell is live when the shell tests run. It is the measured mechanism of the
pointer-freeze abort, but 3b can finish first; the stand-in is live for the whole shell part, so the shape is at least
as strict as a cut. A test that the stand-in reds but a real cut would not (3b already done) would be a false red, and
the fix there is still to make the test cut-proof (KOSMOS_HARNESS_IGNORE_CUT=1 on its sandboxed call), as #6969 did.

## Consequence for every pull request after this lands
Every cut-only red still on main reds the shell shards: today test-staging-agent-online-check until #6976 merges, and
whatever Baron Draxum's sweep of tests 222-284 finds. The shard stops at its first red, so they surface one at a time.
