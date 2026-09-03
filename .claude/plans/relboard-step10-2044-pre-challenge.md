---
pre_challenge: true
method: challenge-loop
branch: relboard-step10-2044
diff_hash: 5ea69273d44d275f57cc0c63c743355d4154dc67aa530386772fa8f63e0825f9
validation: passed
subdir_audit: passed
timestamp: 2026-09-03T17:58:40Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 blind passes + the full-suite (6j) gate
**Converged:** Yes
**Total findings:** 1 WARNING (test did not reproduce the regression), 1 WARNING (octal hole in the knob guard), plus NITs; 1 real suite-integration failure caught by 6j
**Fixed:** all actionable | **Deferred:** 2 NITs (no upper bound on the knob; a cosmetic port-fallback spelling in the test seam) | **Asked:** 0

The change fixes release.sh step 10 (`tools/restart-local-board.sh`): it capped the
wait for the restarted local board at a fixed ~10s, which races launchd's default 10s
respawn throttle, so a healthy board answering at ~10-13s exited 1 and aborted a
served+verified cut under release.sh's `set -e`. The fix verifies the OUTCOME (the board
serving the code on disk) on a generous 45s deadline, keeping exit 1 on genuine failure.

### Per-Iteration Breakdown

#### Iteration 1 (commit cffa3609)
**New findings:** 1 WARNING, 2 NITs
- [WARNING] test-restart-local-board.sh - the "slow-but-healthy" arm flipped the served version at ~2s, WITHIN the old 10s cap, so it did not actually reproduce the regression, and no arm timed a healthy board returning PAST the old cap --> FIXED (arm now flips at ~11s with a 20s deadline and asserts elapsed >= 10s; measured 12s)
- [NIT] restart-local-board.sh - an empty wanted version would make a down board's empty answer a false "back on " success --> FIXED (empty-want guard returns 1; exposed to the test via the `+set` idiom on KOSMOS_BOARD_WANT)
- [NIT] restart-local-board.sh - non-numeric KOSMOS_BOARD_WAIT_SECS would abort the arithmetic under set -e --> FIXED (digit-check `case` guard; new bad-knob arm)

#### Iteration 2 (commit e0a6a051)
**New findings:** 1 NIT
- [NIT] restart-local-board.sh - the wait-failure message went to stdout while the two new guards go to stderr --> FIXED (all failure messages to stderr)

#### Iteration 3 (commit bb150bed)
**New findings:** 1 WARNING
- [WARNING] restart-local-board.sh - the digit-check guard accepted zero-padded values like `08`/`09`, which then hit `$(( ))` as OCTAL and aborted with "value too great for base" (the exact cryptic abort the guard claims to prevent); `010` silently became 8 --> FIXED (normalise once with `WAIT_SECS=$(( 10#$WAIT_SECS ))`; verified `08`->8, `010`->10, no abort; new zero-padded-knob arm)

#### Iteration 4 (converged on code; commit 402af348 for the 6j finding)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs (deferred)
The fresh blind pass found no actionable code findings. The full-suite validation gate
(6j) then caught a real suite-integration failure the diff-only reviews could not see:
- [BLOCKER] 6j full-suite - `tools.every-test-runs.test.js` requires every `tools/test-*.sh` to be EXECUTED by `test:shell` (the "unarmed guard" rule as a meta-test); my new test was named nowhere --> FIXED (wired `bash tools/test-restart-local-board.sh` into test:shell next to its sibling step-11 test; full suite re-run green, my test executes)
- [NIT] restart-local-board.sh - WAIT_SECS has no upper bound; an absurd deliberate override could hang --> DEFERRED: operator/test-only knob, defaults to 45, release.sh never sets it
- [NIT] restart-local-board.sh - the POLL_ONLY seam's default URL spells the port fallback as `${KOSMOS_PORT:-16180}` vs the real path's discovered PORT --> DEFERRED: cosmetic; the seam default is never taken (the test always sets KOSMOS_BOARD_STATUS_URL)

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | test-restart-local-board.sh | slow arm flipped inside the old cap; nothing timed past it | FIXED | cffa3609 |
| 2 | 1 | NIT | restart-local-board.sh | empty want -> false success | FIXED | cffa3609 |
| 3 | 1 | NIT | restart-local-board.sh | non-numeric knob aborts arithmetic | FIXED | cffa3609 |
| 4 | 2 | NIT | restart-local-board.sh | failure message on stdout not stderr | FIXED | e0a6a051 |
| 5 | 3 | WARNING | restart-local-board.sh | zero-padded knob -> octal abort | FIXED | bb150bed |
| 6 | 4 | BLOCKER | package.json | new test not wired into test:shell (6j) | FIXED | 402af348 |
| 7 | 4 | NIT | restart-local-board.sh | no upper bound on the knob | DEFERRED | override-only footgun |
| 8 | 4 | NIT | restart-local-board.sh | port-fallback spelling in the seam default | DEFERRED | cosmetic, never taken |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking)
- No upper bound on KOSMOS_BOARD_WAIT_SECS (iter 4) - deliberate-override-only
- POLL_ONLY seam default-URL port spelling (iter 4) - cosmetic, never taken

### Strengths (across all iterations)
- The wait is clock-based (a wall-clock deadline, not an iteration count), so per-request latency cannot silently shorten it; polls at least once even at WAIT_SECS=0
- The past-the-old-cap arm is genuinely red-capable: a real 11s flip + an elapsed >= 10s assertion means it can only pass by actually waiting past where the old cap gave up (the old code would have exited 1 on this exact healthy board)
- `WAIT_SECS=$(( 10#$WAIT_SECS ))` is an arithmetic assignment (set -e-safe even at 0) and defuses the octal trap; the `${KOSMOS_BOARD_WANT+set}` idiom honours an explicit-empty override while a normal unset reads package.json
- Regression surface intact: --check still report-only, launchd discovery / WD-match / PORT parse / BEFORE line preserved, the `launchctl stop gui/... || launchctl stop LABEL` fallback kept, and release.sh's step-10 fatal gating deliberately unchanged (diff touches only these files)
- The fix removes the false positive without weakening the genuine-failure path (failure, not-answering arms still exit 1)
