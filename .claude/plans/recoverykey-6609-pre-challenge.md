---
pre_challenge: true
method: challenge-loop
branch: recoverykey-6609
diff_hash: b4fa04e06250bdbd723160c302464b1b249de3e04ac913d9712d52bad8637ac7
validation: passed
subdir_audit: passed
timestamp: 2026-10-19T18:36:39Z
iterations: 14
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 14
**Converged:** Yes
**Total findings:** 1 BLOCKER, about 24 WARNINGs, 2 CONVENTIONs, many NITs
**Fixed:** most; **Deferred:** the repeats noted below | **Asked (awaiting user):** 0

Validation note: per-iteration checks were engine/manifest-verify.recovery-6609.test.js (17 tests at the end), engine.reachable.test.js, and the existing manifest tests (install.manifest-sig-6468, install.setup-sig-6468, install.tmux-sig-6473), with perturbation controls (removing the seq check, removing the post-link re-read: each turns a test red). 6j's full validation ran once on the converged and rebased HEAD cc35cb6ee3: PASSED (22236 tests, 0 fail), audit clean.

### Per-Iteration Breakdown (reviewer model alternated Opus / Sonnet)

#### Iteration 1 (opus)
- [BLOCKER] test file leaked temp folders into the suite leak check --> FIXED: test-support/tmpscope
- [WARNING] no state = any list accepted --> FIXED: MIN_KEY_LIST_SEQ floor
- [WARNING] header overclaimed what the key gives --> FIXED: stated exactly
- [WARNING] revocation test bypassed trustedKeys --> FIXED: chained, with control

#### Iteration 2 (sonnet)
- [WARNING] one key had several base64 spellings --> FIXED: canonical spelling only, tested
- [WARNING] a stolen-key release replaces the verifier --> FIXED: stated; phase 2 must fetch the list first
- [WARNING] damaged state read as none --> FIXED: refused

#### Iteration 3 (opus)
- [WARNING] a list at exactly the floor was never recorded --> FIXED, tested
- [WARNING] concurrent writes could move the record back --> FIXED (lock; replaced in iteration 5)
- [WARNING] no home = rollback protection off --> FIXED: refused
- [WARNING] no freshness --> DEFERRED: phase 2 (plan)
- [WARNING] tool accepted a non-recovery key once one is built in --> FIXED

#### Iterations 4 and 5 (sonnet, opus)
- [WARNING] lock takeover races (twice) --> FIXED by removing the lock: an add-only folder of seq-<n>.json files, fsynced then hard-linked
- [WARNING] type tag missing for domain separation --> FIXED: "type": "kosmos-release-keys"

#### Iterations 6 to 9
- [WARNING] no fsync --> FIXED; [WARNING] recovery key could also be a release key --> FIXED (verifier and tool); [WARNING] race windows untested --> FIXED (linkSync stub tests); [WARNING] mistyped home started a fresh record --> FIXED; [WARNING] signing tool crash on a null list --> FIXED

#### Iterations 10 to 13
- [WARNING] "remove that file" lowered the floor --> FIXED: a damaged top record keeps its seq and self-repairs at it
- [WARNING] power-loss residual and record limits --> FIXED: named in the plan (Limits of the record)
- [WARNING] tool self-check did not cover every recovery key --> FIXED

#### Iteration 14 (sonnet)
- 0 BLOCKERs; both WARNINGs duplicates (same-seq repair window: iterations 12 and 13, documented; fast-path timing: iteration 11, phase 2); NITs only
**Converged** - no new actionable findings.

### Deferred (documented in .claude/plans/recoverykey-6609.md)
- list freshness / expiry (phase 2)
- the record is unsigned (local write access can delete or plant files)
- power loss can lose the newest entry before the disk has it
- the same-seq repair relies on one list per seq (signing runbook)

### Strengths
- signature over exact bytes checked before parsing; canonical keys make string compare a key compare
- add-only record with no lock; a damaged record refuses or self-repairs, never lowers the floor
- inert while RECOVERY_KEYS is empty (frozen, pinned by a test); the signing tool never writes or prints the private key
