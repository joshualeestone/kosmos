---
pre_challenge: true
method: challenge-loop
branch: port-selftest-3854
diff_hash: ea5bed61a7d66887cdb4c880ee630f5493958403dd3855709a50b5731f39393d
validation: passed
subdir_audit: passed
timestamp: 2026-09-26T01:49:53Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6 (reviewer models alternated opus / sonnet)
**Converged:** Yes (iteration 6: no BLOCKER; its two WARNINGs are a PID-reuse concern judged not an issue on macOS, and the residual flakes the plan already accepts; NITs only otherwise)
**Total findings:** 0 BLOCKERs, 12 WARNINGs, 3 CONVENTIONs, many NITs
**Fixed:** every WARNING that changed behaviour or a claim | **Deferred:** 2 (see ledger) | **Asked:** 0

Validation: full run on this head, passed (hash ea5bed61a7d6). The self-test itself: 15/15 PASS, and each
guard was proven by mutation: a 3s-slow answering stub (main: 3 FAIL, branch: 0), a launcher-only kill
(2 FAIL), the same with a slow fork and with a late exec (2 FAIL each; both passed green earlier in the
loop), a bound always waited out (1 FAIL), a dropped rc (1 FAIL), a stub that never forks (2 FAIL).
Baron Draxum (the test's author) approved the card to Angel and asked for the nonzero-rc control, added.

### Per-Iteration Breakdown
- **1 (opus):** reap check passed with nothing to reap when the kill beat the fork; BEHIND arms could pass on a timeout; bounded_run setpgrp race (product code) -> fork marker + 10s rerun, raw-answer asserts, quick-answer timing, longer wait_gone; race filed as #3859.
- **2 (sonnet):** a never-forked reap still read PASS -> reports never-forked (FAIL); Baron's nonzero-rc control added; rebased.
- **3 (opus):** at 2s the #3859 race can HANG the test under load; timing ceiling not tied to QUICK_T -> hang bound 5s, ceiling = 2/3 of QUICK_T, RERUN_T named, stale comments fixed.
- **4 (sonnet):** plan did not say why only one hang arm reruns, nor name the timing residual -> plan clarified; timing check moved beside what it times.
- **5 (opus):** the marker proved the fork, not the exec the reap searched for, so a launcher-only kill in that window passed -> reap keyed on the child's PID; EXIT trap kills this run's own sleeps; 2s mentions corrected.
- **6 (sonnet):** no actionable findings. **Converged.**

### Final Ledger (highest severity)
| # | Iter | Category | File | Description | Status |
|---|------|----------|------|-------------|--------|
| 1 | 1 | WARNING | tools/test-app-port-selftest.sh | reap passes when the kill beats the fork | FIXED |
| 2 | 1 | WARNING | tools/lib/app-port-selftest.sh | bounded_run hangs if the bound beats setpgrp | DEFERRED: product code, filed #3859 |
| 3 | 1 | WARNING | tools/test-app-port-selftest.sh | BEHIND answer arms could pass on a timeout | FIXED |
| 4 | 2 | WARNING | tools/test-app-port-selftest.sh | never-forked reap reads PASS | FIXED |
| 5 | 3 | WARNING | tools/test-app-port-selftest.sh | 2s hang arms exposed to the #3859 hang | FIXED (5s; residual in plan) |
| 6 | 3 | WARNING | tools/test-app-port-selftest.sh | timing ceiling not tied to QUICK_T | FIXED |
| 7 | 4 | WARNING | plan | why only one hang arm reruns; timing residual | FIXED |
| 8 | 5 | WARNING | tools/test-app-port-selftest.sh | reap keyed on command line misses a pre-exec orphan | FIXED (PID) |
| 9 | 5 | WARNING | plan, comments | stale 2s mentions | FIXED |
| 10 | 6 | WARNING | tools/test-app-port-selftest.sh | kill -0 could see a reused PID | DEFERRED: macOS assigns PIDs sequentially to 99999; reuse within the 20s poll needs ~99k new processes. A zombie is reaped on reparenting, which the poll waits out. |
| 11 | 6 | WARNING | tools/test-app-port-selftest.sh | single-shot residual flakes (rerun, ceiling) | DUPLICATE of the plan's accepted residuals |
