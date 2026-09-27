# cutfixture-4206: the cut guard ignores yarn test's release.sh fixtures, by heavy-gate's own rule (#4206)

## Why

The Mac 0.7.03 cut would not start on Mortals (2026-09-27 ~09:15 CDT). kosmos_refuse_if_cut_live
counts any `bash .../tools/release.sh` process, and three agents' `yarn test` validations were
running release.sh stubs under a `node --test` runner. tools/heavy-gate.sh (#3805) already ignored
those fixtures; the cut guard used a different rule. That drift is the defect.

## The change

1. tools/lib/fixture-classify.sh (new): heavy-gate's fixture rules, moved unchanged. A process is a
   fixture if an ancestor is a node test runner (node with a bare --test among its own options), or
   its cwd or script is in run-tests.sh's kt<digits> sandbox. Plus kosmos_fx_pid_is_fixture and
   kosmos_fx_drop_fixtures for guard lines. Anything unreadable is NOT a fixture (errs toward refusing).
2. tools/heavy-gate.sh sources it; has_test_runner, in_kt_sandbox and the ancestry walk delegate to
   it. One classifier, two callers.
3. tools/lib/cut-guard.sh sources it and drops fixture lines in kosmos_refuse_if_cut_live and
   kosmos_refuse_if_browser_run_live, after self-exclusion. A line the filter empties reads as "no
   other run", as self-exclusion already did.
4. tools/test-cut-guard.sh: three end-to-end arms through the real pgrep with stubs named
   tools/release.sh: a node --test fixture is not a cut, a kt-sandbox fixture is not a cut, and the
   negative control, a plain release.sh outside any sandbox, is still refused and named. Their
   directory is made under /tmp by name (Linux mktemp honours TMPDIR, which run-tests.sh points at a
   kt folder). The existing self-check's "a real cut is live" skip now ignores fixtures too, so
   another agent's yarn test no longer silently disarms it.

## Evidence

- test-cut-guard.sh: 0 failures. Mutations: filter removed makes both fixture arms red; every pid
  called a fixture makes the negative control red.
- heavy-gate tests: 39 pass, 0 fail (1 skip, pre-existing). test-browser-run-guard.sh, including the
  deliberate KOSMOS_BC_REALPATH=1 real-path control: all clear. test-machine-claim-1962.sh: 22 arms.

## Not in this change

- The run-marker arm (_kosmos_marker_other_live) is unchanged. A fixture that runs the REAL release.sh
  with a real marker dir would still count; the tests isolate KOSMOS_RUN_MARKER_DIR, and the card's
  incident was the name arm.
- kosmos_refuse_if_harness_live (test-install.sh) is unchanged: the card names release.sh and
  browser-checks.sh.

## Weakest premise

The ancestor walk stops at 10 hops, and past that a fixture reads as a real run. That fails toward
refusing, which is the direction the incident was already in, so it can never let a real cut through.
Measured: a fixture under node --test is found within 3 hops.

## Merge condition (Splinter, 09:27)

Do not merge while a cut runs. Merge after Baron posts the 0.7.03 cut's completed line.
