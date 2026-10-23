# cutenv-6977: shell tests run in a cut's shape on CI, so cut-only failures fail on their pull request

Card: kosmos#6977 (the 0.7.64 cut aborted twice at step 3 on shell tests that passed every validation). Claimed:
pigeonpete.

## What a cut's step 3 has that a validation does not (measured from release.sh and tools/lib/cut-guard.sh)
- `AGENT_WORKFORCE_HOME` exported: release.sh's cut-only home, an empty folder at `$TMPDIR/kosmos-cut-home`.
- A live `bash tools/release.sh` that is NOT an ancestor of the tests: the machine-claim renewer release.sh starts at
  every step (#5134, `_cut_renew_start`, release.sh:125-164) is a `( ... ) &` subshell, so it carries the cut's
  command line, in a serial step 3 and a parallel one alike (its own comment says the cut-live guard reads it). The
  guard's name arm (`kosmos_running_lines`) drops the caller's ancestors, the cut among them, so the renewer is what
  the pointer-freeze test's sandboxed release.sh could see. Its marker arm could not have: that test sandboxed HOME,
  and the cut's marker lives in the real `$HOME/.cache/kosmos-run-markers`.
  - Correction (review 1, then Baron Draxum's logs): I first named step 3b's page-layer subshell. That exists only on
    the parallel path, and the 22:58 abort ran step 3 SERIAL (its log: "== 3. the whole suite"). The renewer is the
    one present in both. The suite log on Mortals does not show which guard stopped the sandboxed release.sh (the test
    hides its output), so this is reasoned from source, not measured.

## Decision
- `tools/lib/cut-shape.sh` `kosmos_cut_shape_run [--base DIR] <cmd...>`: a fresh empty `AGENT_WORKFORCE_HOME` (a
  cut's own, if exported, is kept) and a stand-in `bash tools/release.sh` (a sleep loop, started from a scratch folder,
  that ends when the shell that started it ends); runs the command; stops the stand-in and removes the folder,
  red or green; returns the command's status (2 when the shape could not be set up).
- `tools/run-tests.sh`: with `KOSMOS_SHELL_CUT_ENV=1` the shell part (both shard arms) runs through it, with the
  scratch folder beside the kt<pid> sandbox, never in it (a process working there is a test fixture to the guard and
  would not count). The flag is refused outside CI (`GITHUB_ACTIONS`), and any value but 0/1 is refused. On a
  self-hosted runner (`RUNNER_ENVIRONMENT=self-hosted`) the shape is not used and the part runs plain, saying so:
  test.yml can route shell shards to the shared kosmos-ci Mac (#4601, `KOSMOS_CI_SHELL_SHARDS`, unset today), and a
  stand-in there would read as a cut to every agent on it (review 2). Not a refusal, so such a job still runs.
- The stand-in removes its scratch folder when the shell that started it dies, so a cancelled run leaves nothing.
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
That the renewer is what the 22:58 sandboxed release.sh saw. It is the one non-ancestor `bash tools/release.sh` a
serial step 3 has, and it lives for every step, so the stand-in matches a real cut for the whole shell part; but the
failing run's own output never said which guard stopped it. If another guard did (the harness guard, the light-side
wait), the stand-in still reproduces the cut guard's class, and a test red for another cause would need its own seam.

## Consequence for every pull request after this lands, and the order to merge in
Every cut-only red still on main reds the shell shards. Tonight's two real cuts measured the blast radius: every shell
test before each abort point passed in a real cut's environment (the 01:30 re-cut ran through test 221), and Baron
Draxum is sweeping 222-284 in a cut-like environment. So this merges AFTER #6976 (test-staging-agent-online-check) and
after each test on his list is fixed or carded; its own CI run on the pull request is the check that the list is
complete. The shard stops at its first red, so anything missed surfaces one at a time.

## Known test limit
The killed-run arm can tell a stand-in that watches its caller from one that watches itself only on bash 4+ (CI's
Linux runners): macOS's /bin/bash 3.2 has no BASHPID, so both read `$$` there.
