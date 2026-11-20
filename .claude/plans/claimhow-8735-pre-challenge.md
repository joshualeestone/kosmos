---
pre_challenge: true
method: challenge-loop
branch: claimhow-8735
diff_hash: fd97c316205cab6552db45cba373c8580b6337262b5b361ada72a81cbb5a02f4
validation: passed
subdir_audit: passed
timestamp: 2026-11-20T13:55:14Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes (iteration 3 raised only NITs; after the rebase onto main, iteration 4 reviewed the whole branch and
found the plan stale, iteration 5 found the re-read note needed a version gate, iteration 6 raised no new actionable
finding)
**Total findings:** 24 (0 BLOCKERs, 8 WARNINGs, 0 actionable CONVENTIONs, 16 NITs)
**Fixed:** 6 WARNINGs and 8 NITs | **Deferred:** 2 WARNINGs | **Asked (awaiting user):** 0

Iterations 1 to 3 reviewed this branch's own commits while it was stacked on PR #8814 (diff 42c0c34694...HEAD); #8814
merged and the branch was rebased onto main; iterations 4 to 6 reviewed the whole branch against origin/main.
Validation ran after convergence on the final head: 30,304 tests, 0 failed, validation PASSED, worktree clean; subdir
audit rc 0. Two earlier validation runs were stopped on purpose to fix the plan and the re-read gate (their orphaned
stub servers were found by Splinter's liveness check and stopped).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/defaults.js:247 : the person's raised hand left the brief, though an agent decides it at the moment of claiming --> FIXED (ec5353af11 after rebase): kept in the brief, pinned
- [NIT] "when it is done, keep it claimed" and the full release command left the brief --> FIXED
- [NIT] tools/windows-tests.js comment --> FIXED; [NIT] --how only as the first word (same as task --how)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/defaults.js:245 : what to do when Kosmos does not answer a claim lived only in the guide --> FIXED (24bb11380c): kept in the brief, the guide's copy dropped
- [NIT] re-read test did not check the re-wrapped lines stay marked --> FIXED; [NIT] guide comment --> FIXED

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [NIT] the Left out count was not pinned --> FIXED (de6985c2a4): exactly 10
- [NIT] the plan's Call paragraph --> FIXED; [NIT] movedClaim had no version gate (as movedTask) --> later WARNING, fixed in iteration 5; [NIT] --how first word

#### Iteration 4 (whole branch, after the rebase)
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 2 of the above (the plan text written while stacked)
- [WARNING] plan: the stacking section still read as future work --> FIXED (96e783914c)
- [WARNING] plan: the figures were pre-rebase --> FIXED (96e783914c): re-checked on the rebased tree, said so
- [NIT] guide comment on which lines stay marked --> FIXED; [NIT] movedClaim trade-off as movedTask

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (the movedClaim entry, written in the first commit)
- [WARNING] engine/instructionreread.js:486 : the claim note stayed on for every later change to a section that also holds posting and reacting rules --> FIXED (57f9615108): fires only for the v55 move; control added, perturbed red
- [WARNING] the tests could not catch that --> FIXED (57f9615108): the control
- [NIT] log and guide comments on the raised hand --> FIXED; [NIT] stale-claim and say-so-in-the-room moves recorded in the plan --> FIXED

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] install/kosmos:5522 : --how is recognised only as the first word --> DEFERRED: the same as task --how and community --how; changing claim alone would make the three differ, and the worst case is the board refusing an unknown post id, taking nothing
- [WARNING] engine/instructionreread.js:490 : the pinned count depends on the guide lines staying word for word --> DEFERRED: the reviewer judged the failure direction safe (an edit makes the lines show as removed, and the pinned test goes red)
- [NIT] size-test comment wrap; [NIT] raised-hand comment wording; [NIT] --status recorded only in the plan
**Converged** : no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/defaults.js:247 | SELF | raised hand left the brief | FIXED | ec5353af11 |
| 2 | 2 | WARNING | engine/defaults.js:245 | SELF | Kosmos-not-answering only in the guide | FIXED | 24bb11380c |
| 3 | 4 | WARNING | .claude/plans/claimhow-8735.md:15 | SELF | stacking section stale | FIXED | 96e783914c |
| 4 | 4 | WARNING | .claude/plans/claimhow-8735.md:27 | SELF | pre-rebase figures | FIXED | 96e783914c |
| 5 | 5 | WARNING | engine/instructionreread.js:486 | SELF | claim note not version-gated | FIXED | 57f9615108 |
| 6 | 5 | WARNING | engine/instructionreread-changes-7149.test.js:318 | SELF | no control for a later change | FIXED | 57f9615108 |
| 7 | 6 | WARNING | install/kosmos:5522 | SELF | --how only as the first word | DEFERRED | matches task and community --how |
| 8 | 6 | WARNING | engine/instructionreread.js:490 | SELF | count depends on verbatim lines | DEFERRED | safe failure direction, pinned |

### NITs (non-blocking, across all iterations)
- keep-it-claimed and the full release command (iteration 1, fixed)
- windows-tests comment (iteration 1, fixed)
- --how only as the first word (iterations 1, 3, 6; deferred)
- re-wrapped lines not asserted (iteration 2, fixed)
- guide comments (iterations 2, 4, 5, fixed)
- Left out count not pinned (iteration 3, fixed)
- plan Call paragraph (iteration 3, fixed)
- raised hand in both places (iteration 5, recorded)
- stale-claim and say-so-in-the-room moves (iteration 5, recorded)
- size-test comment wrap, --status only in the plan (iteration 6)

### Strengths (across all iterations)
- Every rule an agent needs at the moment of claiming stays in the brief, pinned per platform (iterations 1 to 6)
- Both CLIs match each other and the task --how pattern byte for byte (iterations 1, 3, 6)
- The re-read note leaves out exactly the ten verbatim lines, only for the v55 move, with three controls (iterations 3, 5, 6)
