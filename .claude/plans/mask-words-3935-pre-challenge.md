---
pre_challenge: true
method: challenge-loop
branch: mask-words-3935
diff_hash: 15f1d8b54c0fda60bd773f9aa2f925932e41b9ff0e6427a339b40a640a184eba
validation: passed
subdir_audit: passed
timestamp: 2026-09-26T18:00:59Z
iterations: 34
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 34 (reviewer model alternating Opus and Sonnet throughout)
**Converged:** Yes (iteration 34 raised one WARNING that deduplicates against the plan's weakest premise, plus CONVENTIONs and NITs already settled or left with reasons)
**Total findings:** 176 tagged across the rounds (19 BLOCKERs, 76 WARNINGs, 15 CONVENTIONs, 66 NITs; counted from the plan's per-round sections)
**Fixed:** 85 | **Deferred:** 23 (three limits of origin/main's own behaviour are filed as #3995) | **Decided (kept, reasoning recorded):** 1 | **Asked (awaiting user):** 0

The full ledger, one entry per finding with what was done and the commit, is the plan: `.claude/plans/mask-words-3935-20260926T0555.md` ("Review round 1" to "Review round 34"). Every fix there carries a test and a mutation that turns it red.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Detail:** the plan's "Review round 1" section, each finding with its resolution and commit.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 1 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Detail:** the plan's "Review round 2" section, each finding with its resolution and commit.

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Detail:** the plan's "Review round 3" section, each finding with its resolution and commit.

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 2 CONVENTIONs, 1 NITs
**Detail:** the plan's "Review round 4" section, each finding with its resolution and commit.

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 2 CONVENTIONs, 1 NITs
**Detail:** the plan's "Review round 5" section, each finding with its resolution and commit.

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Detail:** the plan's "Review round 6" section, each finding with its resolution and commit.

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Detail:** the plan's "Review round 7" section, each finding with its resolution and commit.

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 1 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Detail:** the plan's "Review round 8" section, each finding with its resolution and commit.

#### Iteration 9
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Detail:** the plan's "Review round 9" section, each finding with its resolution and commit.

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 1 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NITs
**Detail:** the plan's "Review round 10" section, each finding with its resolution and commit.

#### Iteration 11
**Reviewer model:** opus
**New findings:** 1 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Detail:** the plan's "Review round 11" section, each finding with its resolution and commit.

#### Iteration 12
**Reviewer model:** sonnet
**New findings:** 1 BLOCKERs, 0 WARNINGs, 1 CONVENTIONs, 1 NITs
**Detail:** the plan's "Review round 12" section, each finding with its resolution and commit.

#### Iteration 13
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Detail:** the plan's "Review round 13" section, each finding with its resolution and commit.

#### Iteration 14
**Reviewer model:** sonnet
**New findings:** 1 BLOCKERs, 1 WARNINGs, 1 CONVENTIONs, 1 NITs
**Detail:** the plan's "Review round 14" section, each finding with its resolution and commit.

#### Iteration 15
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Detail:** the plan's "Review round 15" section, each finding with its resolution and commit.

#### Iteration 16
**Reviewer model:** sonnet
**New findings:** 1 BLOCKERs, 1 WARNINGs, 0 CONVENTIONs, 1 NITs
**Detail:** the plan's "Review round 16" section, each finding with its resolution and commit.

#### Iteration 17
**Reviewer model:** opus
**New findings:** 1 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Detail:** the plan's "Review round 17" section, each finding with its resolution and commit.

#### Iteration 18
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 0 NITs
**Detail:** the plan's "Review round 18" section, each finding with its resolution and commit.

#### Iteration 19
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 2 NITs
**Detail:** the plan's "Review round 19" section, each finding with its resolution and commit.

#### Iteration 20
**Reviewer model:** sonnet
**New findings:** 1 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NITs
**Detail:** the plan's "Review round 20" section, each finding with its resolution and commit.

#### Iteration 21
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTIONs, 5 NITs
**Detail:** the plan's "Review round 21" section, each finding with its resolution and commit.

#### Iteration 22
**Reviewer model:** sonnet
**New findings:** 1 BLOCKERs, 1 WARNINGs, 0 CONVENTIONs, 2 NITs
**Detail:** the plan's "Review round 22" section, each finding with its resolution and commit.

#### Iteration 23
**Reviewer model:** opus
**New findings:** 1 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 2 NITs
**Detail:** the plan's "Review round 23" section, each finding with its resolution and commit.

#### Iteration 24
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Detail:** the plan's "Review round 24" section, each finding with its resolution and commit.

#### Iteration 25
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTIONs, 4 NITs
**Detail:** the plan's "Review round 25" section, each finding with its resolution and commit.

#### Iteration 26
**Reviewer model:** sonnet
**New findings:** 2 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NITs
**Detail:** the plan's "Review round 26" section, each finding with its resolution and commit.

#### Iteration 27
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTIONs, 4 NITs
**Detail:** the plan's "Review round 27" section, each finding with its resolution and commit.

#### Iteration 28
**Reviewer model:** sonnet
**New findings:** 1 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Detail:** the plan's "Review round 28" section, each finding with its resolution and commit.

#### Iteration 29
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 6 WARNINGs, 0 CONVENTIONs, 1 NITs
**Detail:** the plan's "Review round 29" section, each finding with its resolution and commit.

#### Iteration 30
**Reviewer model:** sonnet
**New findings:** 1 BLOCKERs, 1 WARNINGs, 1 CONVENTIONs, 0 NITs
**Detail:** the plan's "Review round 30" section, each finding with its resolution and commit.

#### Iteration 31
**Reviewer model:** opus
**New findings:** 1 BLOCKERs, 2 WARNINGs, 2 CONVENTIONs, 1 NITs
**Detail:** the plan's "Review round 31" section, each finding with its resolution and commit.

#### Iteration 32
**Reviewer model:** sonnet
**New findings:** 2 BLOCKERs, 1 WARNINGs, 2 CONVENTIONs, 1 NITs
**Detail:** the plan's "Review round 32" section, each finding with its resolution and commit.

#### Iteration 33
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTIONs, 2 NITs
**Detail:** the plan's "Review round 33" section, each finding with its resolution and commit.

#### Iteration 34
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 2 CONVENTIONs, 2 NITs
**Detail:** the plan's "Review round 34" section, each finding with its resolution and commit.
**Converged:** no new actionable findings in iteration 34.

### Self-generated findings (defects this loop introduced and a later round caught)
- Round 21's NAME=value exclusion matched padded base64 (round 23, BLOCKER, fixed).
- Round 22's fragment test used a repeating PRNG and could not fail (caught while writing it; fixed before commit).
- Round 27's comment exclusion left a commented-out key unheld (round 28, BLOCKER, fixed).
- Round 28's token rule held timestamps and issue URLs (round 29, fixed); round 29's name stripping removed a padded key (round 31, BLOCKER, fixed) and a key before its note (round 32, BLOCKER, fixed). Round 33 replaced the side-guessing with a per-piece shape rule.
- Round 31's hash cache turned the round-1 timing test into a cache hit (round 33, fixed; the test now asserts a fresh run).

### Final validation (6j)
- Earlier runs: 3548b18 passed; 12cc1aa failed only on openaiaccounts.devicecode-3436 (not touched here; fixed on main by #3993; branch rebased); runs on superseded commits were stopped when a later fix replaced them.
- Final run on 0f087c3: PASSED (validation rc=0, subdir audit rc=0), 2026-09-26 12:59 CDT. The commit after it changes only the plan. origin/main has moved 3 commits since, with no conflict.

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### Not covered (recorded in the plan and on #3995)
- A key cut into chunks of 3 characters or fewer with words between (the weakest premise).
- Keys grouped with / + = between chunks; pieces spread past the reach limit; a symbol-bearing password given without its opening.
- A single-case letter-only secret inside a line with spaces; an identifier with a one-letter case piece is held (masking direction).

### Strengths (across all iterations)
- Fail-closed at every bound: an exhausted search withholds the reply (UNCHECKED) rather than passing it through.
- One parser (knownsecrets.assignedValue, keyTokens) shared by the collector and the mask.
- Reviewer fuzzing in the last rounds: 500 random splits and 4,200 guide-prose trials, no leak and no false positive.
