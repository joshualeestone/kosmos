---
pre_challenge: true
method: challenge-loop
branch: linux-promote-ci-verb-7941
diff_hash: 4118b0c8b97a31506d351a0b1092837254674d7435372975b9c7829d0ce13a06
validation: partial (scanning guards and the contract test locally; the leg only runs in CI; the full suite is left to CI)
subdir_audit: not run (no subdir CLAUDE.md in the diff)
timestamp: 2026-11-04T22:38:28Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes, on iteration 6: no new BLOCKER, WARNING or CONVENTION. One comment-only commit followed (`# gnu-ok:` on the sed the guard flagged), not re-reviewed.
**Total findings:** 0 BLOCKERs, about 19 WARNINGs, 2 CONVENTIONs, about 18 NITs
**Asked (awaiting user):** 0

Measured on stock ubuntu-24.04:
- Run 41917651504, stamped mode: reached the install path and found #7981.
- Run 41923993749, `old_version=0.7.86`: installed that exact build, whose own CLI refused the update, and the leg went red for that reason. So the pinned install is real, and a build without the verb is a working control.

Not measured: **any PASS.** Everything after the verb has never run in old-version mode. Read the first green's log line by line.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 7 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] the leg fetched prod and went red right after a promote --> FIXED (0d9b2a2b75)
- [WARNING] real mode had no caller --> FIXED: docs name the dispatch
- [WARNING] pinned mode never run --> FIXED: run 41923993749
- [WARNING] the verb not pointed at $SITE --> FIXED
- [WARNING] nothing pinned the rule --> FIXED: contract checks in test-linux-check-runs-7942.sh
- [WARNING] no beacon checks --> FIXED
- [WARNING] PASS named a version, not bytes --> FIXED: installer hash checked, build sha printed
- [CONVENTION] plan name has no timestamp --> DEFERRED: nothing enforces it and the gate finds it by branch

#### Iteration 2
**Reviewer model:** sonnet, whole-branch, no plan file
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above
- [WARNING] docs did not say what the previous cut must be --> FIXED (e2eb3320e9)
- [WARNING] the verb is a convention, not enforced --> DEFERRED: by design, stated in docs

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 3 of the above
- [WARNING] "came back up" was one sample --> FIXED: 30 s hold (8af74398a6)
- [WARNING] stamped PASS read the same --> FIXED: the output names the mode
- [WARNING] no PASS ever seen --> DEFERRED: stated in the plan; cannot happen before 0.7.90
- [WARNING] a red verb stops less than the plan said --> FIXED: plan corrected
- [WARNING] the old side is laid down by today's installer --> FIXED: plan names the diff to make before trusting a PASS

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 2 of the above
- [WARNING] the stay-up check could pass on empty --> FIXED (c1c6ebff6d)
- [WARNING] an early crash is inside the baseline --> FIXED by logging; limit stated next round

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above
- [WARNING] a first-boot crash can pass --> DEFERRED: the plan states it, and tightening needs a real green to set the number

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Converged:** no new actionable findings.

### Outstanding questions (ASKED)
None.

### Strengths
- The leg requires the verb's own answer, a new systemd process owning the listener, the version that process loaded, the version on disk, and all of it still true 30 s later.
