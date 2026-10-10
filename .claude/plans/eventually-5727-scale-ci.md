# Plan: eventually-5727-scale-ci (#5727 follow-up 2)

## Scope (Liu m4906)
Follow-up 2: a CI-run test that `tools/run-tests.sh` really (a) EXPORTS a clamped
`KOSMOS_TEST_TIME_SCALE` to the test processes it spawns (so `test-support/eventually.js` reads
it) and (b) PRINTS the clamped scale where a reader of a red sees it. This closes Sonya's
review note on #5738: the runner's compute/export/banner wiring was unit-tested
(`tools/test-time-scale-5727.sh` pins the math) but never exercised end-to-end in CI.

Also carries Liu's one-line marker above `engine/connect.test.js`'s `until` (the file excluded
from the migration, with the evidence on #5727), so nobody re-migrates it without reading why.

## Change
- `tools/test-runner-scale-export-5727.sh` (new, wired into `test:shell`): drives the REAL
  runner with `--only` (#4929) against tiny temp probe test files, with `KOSMOS_FAKE_LOAD` forced
  so the scale is deterministic (`cut-load-guard.sh` honors the seam; `test-time-scale.sh` clamps
  to [1.00, 4.00]). It asserts:
  - a PASSING probe records the `KOSMOS_TEST_TIME_SCALE` its own process was handed; under a
    saturating load that value is `4.00` (export reached the child AND was capped), and under a
    near-idle load it is `1.00` (floored). This is the "exports to the test processes" half.
  - a FAILING probe reds the `--only` run, so the #708 "when this run started" banner prints,
    and the output contains `wall-clock test time-scale 4.00x`. This is the "prints the clamped
    scale" half, on the red path where a reader of a timing red actually needs it. A control
    asserts the #708 banner header really rendered, so the grep is not matching stray text.
- `engine/connect.test.js`: a 6-line comment above `until()` saying it is deliberately excluded
  from the `eventually()` migration (the #3326 cadence sensitivity + the 1400ms discriminator),
  pointing at the #5727 exclusion comment. No code change to the helper.
- `package.json`: wire `bash -n` + a run of the new test into `test:shell`, next to
  `test-time-scale-5727.sh`.

## Why --only, and the refusals it must neutralize
`--only` runs just the named files with no queue wait and no suite-live check. But it DOES refuse
in a few cases the nested call must handle, or the test false-passes:
- `KOSMOS_TEST_PART` / `KOSMOS_SHELL_SHARD`: the CI shell-shard job exports these
  (.github/workflows/test.yml), and `run-tests.sh` refuses `--only` when either is set (exit 2).
  The nested call resets them to `KOSMOS_TEST_PART=all KOSMOS_SHELL_SHARD=`, exactly as
  `tools/test-cut-guard.sh` does when it nests the runner. (Without this the test passes locally,
  where the vars are unset, and fails in CI, where they are set -- the failure mode a blind pass
  caught before merge.)
- A foreign machine claim / live install harness: absent on a CI runner, overridden with
  `KOSMOS_IGNORE_MACHINE_CLAIM=1 KOSMOS_TESTS_IGNORE_HARNESS=1`.
- An INHERITED, already-exported `KOSMOS_TEST_TIME_SCALE`. In CI (and a local `yarn test`) this
  test runs inside the outer `run-tests.sh`, which has already EXPORTED the var; bash keeps the
  export attribute across a plain reassignment, so a dropped `export` in the runner would still
  reach the child via the inherited attribute and the regression would pass green. `run_only`
  therefore `unset`s it inside a subshell first, which makes the runner's own `export` the only
  thing that reaches the child (a `VAR=val ... bash` prefix cannot unset). Proven both ways: with
  the var unset, a non-exported inner assignment yields `undefined` in the child; with `export`,
  `4.00`.
Rather than trust that list to be complete, `reached_runner()` asserts the runner printed its
`--only: 1 named file(s)` acceptance line; ANY remaining refusal (a light side turn, a
glob-bearing TMPDIR path, a future gate) then fails the test loudly instead of passing
vacuously. The red-path check also pins the exit to exactly 1 (a test red), since a refusal
exits 2. The probe files live in a `mktemp -d` dir, not the repo tree, so the ordinary suite
glob never picks them up; `--only` takes their absolute paths.

## Respecting follow-up 3
The banner is red-only today (the #708 design). Follow-up 2 does NOT change that; it tests the
scale is printed on the red path as-is. Whether the banner should show on a green run too is
follow-up 3, decided separately with evidence on the card.

## What "done" looks like
- The new shell test passes locally and on CI (both shards' union still proven by the shard
  test). It fails loudly if the runner ever stops exporting the scale to children or stops
  printing it on a red.

## Weakest part (named)
The test depends on `--only` staying a no-queue, no-suite-check path and on the #708 banner
wording `wall-clock test time-scale <n>x`. If either changes, the test reds honestly (it is not a
silent pass): the control on the banner header, and the explicit `4.00` / `1.00` value checks,
mean a wording drift or a missing export surfaces as a failure rather than a false green.

Because it drives the REAL runner (the point of the test, versus a stub), it inherits the
runner's own non-determinism: each nested `--only` run snapshots `~/Library/LaunchAgents` for the
leak guard, so on the self-hosted CI Mac a concurrently-rewritten agent plist could, rarely, flip
a pass arm red (a false-FAIL, not a false-pass). The `#5092` live-root skip mitigates it, and a
false-FAIL is the safe direction (it never greens a real regression); accepted as the cost of an
end-to-end test over a stubbed one.
