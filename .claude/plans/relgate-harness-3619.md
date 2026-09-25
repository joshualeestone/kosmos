# Plan: #3619, release-gate tests refused by another suite's stand-in harness

## Finished looks like
`tools.release-gate.test.js` passes whether or not an install harness (or test-cut-guard.sh's
stand-in for one) is running elsewhere on the Mac.

## Cause (measured)
`release.sh` refuses to cut while any `tools/test-install.sh` runs on the machine (step 0,
`cut-guard.sh`). `tools/test-cut-guard.sh` starts a real stand-in, `bash tools/test-install.sh
--sleep 4`, so whenever another agent's suite is inside it, the release-gate arms that drive
release.sh past the guard get the harness refusal instead of the answer they test. The test
already sets `KOSMOS_HARNESS_IGNORE_CUT=1` (the guard in the other direction) for the same reason,
but not `KOSMOS_CUT_IGNORE_HARNESS=1`.

Reproduced on demand: with a stand-in `bash tools/test-install.sh --sleep 4` running, the file
fails 12 of 26 with the card's exact message; with the fix, 26 of 26 pass. Tonight's full-suite run
on another branch had the same shape (5 failures, 26 of 26 alone).

## Change
`tools.release-gate.test.js`: set `KOSMOS_CUT_IGNORE_HARNESS: '1'` next to
`KOSMOS_HARNESS_IGNORE_CUT` in the env of the spawn that reaches the guards. None of these arms
tests the harness guard; `tools/test-cut-guard.sh` does, and is unchanged. The first spawn helper
(`run`) is untouched: its arms stop at the version gate or the site check, both before the libs
are sourced and the guards run.

Rejected: pointing the harness probe at a stub. It needs the probe seam threaded into this test,
for no gain over the documented escape the guard itself names.

Same family, found in review and fixed here: the arms that pass step 2 reach the load guard (step
2b), which waits up to 600 s on a loaded Mac, so `KOSMOS_FAKE_LOAD=0`; and release.sh recreates
`$TMPDIR/kosmos-cut-home`, so TMPDIR is kept inside the sandbox (as tools.cut-home-2724.test.js
does) rather than the per-user one a real cut uses.

## Not in scope, surveyed
Other tests mention release.sh; `tools.cut-home-2724.test.js` already sets both. The card's
failure is this file.

## Weakest premise
That no arm in this file means to exercise the harness guard. Read every arm: none asserts the
harness refusal.
