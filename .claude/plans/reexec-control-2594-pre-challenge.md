---
pre_challenge: true
method: challenge-loop
branch: reexec-control-2594
diff_hash: 8c2f75c44b49e432091b763075daefbb726e99b51b8a00125842eedddaab8c02
validation: passed
subdir_audit: passed
timestamp: 2026-09-09T20:55:12Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes
**Total findings:** 8 (0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 6 NITs)
**Fixed:** 5 | **Deferred:** 0 | **Asked (awaiting user):** 0

Release-gate test fix, so a multi-model witness was deliberate (Opus + Sonnet). Every iteration's
reviewer ran the test under the actual bug env (ambient KOSMOS_HARNESS_IGNORE_CUT=1), so the
convergence is measured, not just argued.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above (findings cite the pre-loop base commit a7780ca5, not this loop's fix commits)
- [WARNING] the SUBJECT arm did not clear KOSMOS_PW_NODE_PATH (control/common_env do) --> FIXED (e095e7d2)
- [WARNING] asymmetry: control clears FROZEN_RUNNER but ARM 1 (which needs it unset) did not --> FIXED (e095e7d2): ARM 1 now -u FROZEN_RUNNER
- [NIT] control assertion `browser-checks.sh` looser than the refuse reason --> FIXED (e095e7d2): tightened to `already live`

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the WARNING targets the in-code comment this loop wrote in a7780ca5/e095e7d2)
**Duplicates of prior findings:** ran the test under the bug env, all pass (confirmation)
- [WARNING] in-code comment falsely stated "the cut EXPORTS KOSMOS_HARNESS_IGNORE_CUT"; release.sh only READS it (:242). Comes from the invoking env. --> FIXED (200a7749): comment + plan reworded (a SELF prose claim corrected, kosmos#120 class)
- [NIT] "BOTH arms clear the two vars" overstated (subject clears only IGNORE_CUT) --> FIXED (200a7749)
- [NIT] neither arm cleared KOSMOS_BC_SELF_PID (a guard input) --> FIXED (200a7749): -u SELF_PID on both
- [NIT] env -u portability only exercised on macOS --> noted (POSIX; not a real risk on a Darwin fleet)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 2 of the above (both target ARM-1 comment line-refs this loop wrote in e095e7d2)
**Converged** -- no new actionable findings. Reviewer measured pre-fix = FAILURE under the env, fixed = 0 failures.
- [NIT] ARM-1 comment: "frozen runner copy" assertion actually passes; the failing ones are "Frozen at"/frozen-path-distinctness --> FIXED (1a6de315)
- [NIT] ARM-1 comment cited :131 as the freeze block; it is the elif at :140 --> FIXED (1a6de315)
- [NIT] plan portability macOS-only note (no change; accurate as stated)

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | tools/test-runner-reexec-1818.sh (subject) | BRANCH | SUBJECT missing KOSMOS_PW_NODE_PATH= | FIXED | e095e7d2 |
| 2 | 1 | WARNING | tools/test-runner-reexec-1818.sh (ARM 1) | BRANCH | ARM 1 didn't clear FROZEN_RUNNER | FIXED | e095e7d2 |
| 3 | 1 | NIT | tools/test-runner-reexec-1818.sh (control) | BRANCH | loose assertion token | FIXED | e095e7d2 |
| 4 | 2 | WARNING | tools/test-runner-reexec-1818.sh (comment) | SELF | false "cut exports" claim | FIXED | 200a7749 |
| 5 | 2 | NIT | tools/test-runner-reexec-1818.sh (comment) | SELF | "both arms" overstatement | FIXED | 200a7749 |
| 6 | 2 | NIT | tools/test-runner-reexec-1818.sh (arms) | BRANCH | SELF_PID not cleared | FIXED | 200a7749 |
| 7 | 3 | NIT | tools/test-runner-reexec-1818.sh (ARM-1 comment) | SELF | wrong-assertion line ref | FIXED | 1a6de315 |
| 8 | 3 | NIT | tools/test-runner-reexec-1818.sh (ARM-1 comment) | SELF | :131 vs :140 line ref | FIXED | 1a6de315 |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- All 6 NITs above were fixed (comment precision + SELF_PID hygiene); none deferred.

### Strengths (across all iterations)
- Core fix load-bearing and minimal: `env -u` clears the guard-skip vars (no-op when absent, portable), so the CONTROL's live-probe refusal is immune to a cut-inherited IGNORE_CUT/FROZEN_RUNNER. Measured every iteration: pre-fix FAILS under the env, fixed = 0 failures.
- The tightened `already live` assertion verified against cut-guard.sh:301 (guard's own wording, emitted only on the probe rc==0 path, symmetric with the SUBJECT's negative).
- Env hygiene complete and per-arm attributable (control/subject/ARM1 each assert their own condition regardless of ambient env); ARM 2 correctly needs no -u.
- All comment claims verified against source (release.sh READ-not-EXPORT; :140/:216/:242 line refs).
