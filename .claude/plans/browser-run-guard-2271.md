# Plan: #2271 - test-browser-run-guard.sh reds the cut on a real concurrent browser run

## Problem
test-browser-run-guard.sh runs in the cut's test:shell (step 3). The concurrent-page-layer guard it
tests (kosmos_refuse_if_browser_run_live) checks TWO inputs: the process scan (seamed by
KOSMOS_BC_PROBE) AND the run-markers (_kosmos_marker_other_live, line 273/299). The test seams only the
PROCESS input, so on a shared box a foreign `bash tools/browser-checks.sh` run's MARKER leaked past the
probe: the "passes when nothing is live" arm (KOSMOS_BC_PROBE=probe-quiet) still saw the real marker
and the guard refused -> the arm FAILED -> the cut RED at step 3. Measured on the 0.6.36 cut twice
(pids 53967, 36115); the #2178 isolation-rerun clears TRANSIENT contention but not a persistent foreign
run, so only a brokered fleet browser-quiet window let the cut through.

## Decision (mine, reversible) - test-only, no source change
The marker-dir seam ALREADY exists: _kosmos_marker_dir honors KOSMOS_RUN_MARKER_DIR (cut-guard.sh:107).
The test just never set it. Fix: point KOSMOS_RUN_MARKER_DIR at an empty temp dir for the whole test,
so the probe seam fully controls what "live" means and the real machine's markers cannot leak in.
Add two arms so isolating the dir does not lose marker coverage: (1) a live marker in the controlled
dir refuses even under a quiet probe (detection still fires); (2) with the marker gone + a quiet probe,
the guard passes on ANY box (the cut-red fix).

Rejected: a source change to the guard - unnecessary, the seam exists; and a SKIP-on-busy-box arm -
worse than full isolation (a SKIP loses coverage every busy run; isolation keeps every arm running).

## Verification
- test passes fully on the busy box (12 existing arms + 2 new), including the previously-failing
  "passes when nothing is live". test-cut-guard.sh PASS; every-test-runs 3/0; zsh-tied-names PASS.
- Red-capability (direct): guard with a live marker in the dir -> rc=1 (refuse, the pre-fix
  mechanism); empty dir -> rc=0 (pass, the fix). The two new test arms encode both directions.
- Keeps the guard's real job provable: the "refuses while a page layer is live" and the
  KOSMOS_BC_REALPATH arms are untouched; a real concurrent page layer still refuses.
