---
pre_challenge: true
method: challenge-loop
branch: scrub-cpu-3710
diff_hash: d4c752bcff1b35589b708e363547989dbf994712c0ddcd482b0b32a1711f4cac
validation: passed
subdir_audit: passed
timestamp: 2026-09-25T11:51:32Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes (iteration 5 returned no BLOCKER, WARNING or CONVENTION)
**Total findings:** 9 actionable (0 BLOCKERs, 8 WARNINGs, 1 CONVENTION) plus NITs
**Fixed:** 7 | **Deferred:** 2 | **Asked (awaiting user):** 0

Origin note: recorded from which commit introduced the cited text, not from a
6c-bis blame run. Iterations 3 and 4 were mostly SELF prose (numbers and
assurances an earlier fix wrote); they were fixed by DELETING the claims, per 6e,
not by writing more careful ones.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] engine/feedbacksend.test.js - regex control passes only because V8 interprets a regex on first use (86ms once native) --> FIXED (65a6dbdb: fixed CPU loop control)
- [WARNING] engine/feedbacksend.test.js - comment claimed load stretches wall time only; CPU rose ~1.7x --> FIXED (65a6dbdb)
- [NIT] sibling long-run test used the same wall-time shape --> FIXED (65a6dbdb, now CPU-bounded)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
- [WARNING] CI runner speed never measured --> DEFERRED as not-an-issue with evidence: CI (macos-26-arm64) ran the degenerate scrub at 510ms wall on main; recorded, and later corrected to "inferred" (iteration 3)
- [WARNING] engine/feedguard.test.js - same wall-time shape --> DEFERRED: filed kosmos#3715 listing all 10 CPU-shaped sites (Renet took it)
- [NIT] helper name abbreviation --> FIXED (3105d740, cpuMillisecondsOf)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 3
- [CONVENTION] control comment's "~170ms on an M4" measured ~88ms in the test's shape --> FIXED (38c5178d, figure deleted)
- [WARNING] plan claimed CI CPU "at most" wall, which GC threads can break --> FIXED (38c5178d, marked inferred)
- [WARNING] "wide enough for a much slower machine" untrue under --jitless --> FIXED (38c5178d, assurance deleted)
- [NIT] always-true observability assertion --> FIXED (38c5178d, removed)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 1
- [WARNING] control floor 20ms is hardware-speed dependent --> FIXED (6e58a3ce, floor 1ms: only has to separate ms from seconds and never-ran)
- [NIT] inline bound literals --> FIXED (6e58a3ce, named constants with rationale)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
**Converged** - no new actionable findings. The reviewer measured the degenerate scrub at 360 to 370ms CPU at load 27.6 (~8x headroom).

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/feedbacksend.test.js | BRANCH | regex control depends on V8 tiering | FIXED | 65a6dbdb |
| 2 | 1 | WARNING | engine/feedbacksend.test.js | BRANCH | "wall time only" claim | FIXED | 65a6dbdb |
| 3 | 2 | WARNING | CI runner | BRANCH | runner speed unmeasured | DEFERRED | evidence recorded; inferred |
| 4 | 2 | WARNING | engine/feedguard.test.js | BRANCH | same class elsewhere | DEFERRED | kosmos#3715 |
| 5 | 3 | CONVENTION | engine/feedbacksend.test.js | SELF | unmeasured CPU figure | FIXED | 38c5178d |
| 6 | 3 | WARNING | .claude/plans/scrub-cpu-3710.md | SELF | CPU <= wall inference | FIXED | 38c5178d |
| 7 | 3 | WARNING | engine/feedbacksend.test.js | SELF | slower-machine assurance | FIXED | 38c5178d |
| 8 | 4 | WARNING | engine/feedbacksend.test.js | SELF | speed-dependent floor | FIXED | 6e58a3ce |
| 9 | 4 | NIT->fixed | engine/feedbacksend.test.js | SELF | inline literals | FIXED | 6e58a3ce |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] the control loop could be 1e7 instead of 1e8 and still separate all three failure modes (iteration 5)
- [NIT] the plan's 88 to 151ms control figure carries no load/config (iteration 5)
- [NIT] the helper's comment could say process CPU includes GC and threadpool work (iteration 5; in the plan's weakest premise)

### Strengths (across all iterations)
- Measures the property the guard is about: backtracking is CPU work (all iterations)
- Perturbations run: exponential regex planted in scrub reds the test (11677ms); the units control reds on microseconds, seconds, and fn never called
- The wider class filed as kosmos#3715 instead of converted unperturbed
