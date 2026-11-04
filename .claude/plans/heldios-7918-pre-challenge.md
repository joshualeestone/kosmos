---
pre_challenge: true
method: challenge-loop
branch: heldios-7918
diff_base: origin/heldcount-7916 (stacked; 937f76544c)
diff_hash: 26811e7a66f8fa7195e2ac52a6d7ad76bc58f3a3281539bb0e7c87df5ef73a4f
validation: passed (iOS LogicTests, all eight runners that compile the changed files; ios.board-parity-7084 11/11)
subdir_audit: not run (iOS-only diff plus its plan)
timestamp: 2026-11-04T09:47:50Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (opus, sonnet, opus, sonnet; one reviewer at a time)
**Converged:** Yes. Round 4 raised no BLOCKER and no WARNING; its two NITs were a plan wording gap (fixed) and a
parity note that needs no change.
**Asked (awaiting user):** 0
**Self-generated:** round 2 corrected a premise round 1 and I had both accepted ("#7916 does not mark task rows").

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] the card names waitingOn task rows; I read #7916 as not marking them --> accepted at the time (WRONG, see round 2)
- [WARNING] depends on #7916's field names --> in the plan; Renet confirmed no renames (03:29)
- [NIT] unreadable-agents control asserted only "not held" --> FIXED (exact nil)
- [NIT] web wording pin for the held words; remaining NITs low value --> resolved by the maps' two-way pin once stacked

#### Iteration 2
**Reviewer model:** sonnet
- [NIT] #7916 also words held in PJ_NEEDS_WHY --> led to the finding that #7916 marks held on waitingOn entries
  (tskRow) and members (pjNeedsNotice) too --> FIXED: task rows and the needs notice read held; branch stacked on
  heldcount-7916 because the phone's maps are pinned both ways against PJ_NEEDS_WHY (measured: #7916 alone failed the
  room suite 1 of 812 before Renet added the phone map entries)

#### Iteration 3
**Reviewer model:** opus
- [WARNING] base carried four pre-merge starfirst-7684 commits and lagged heldcount-7916 --> FIXED (rebased onto the tip, my commits only)
- [WARNING] merge window between #7916 and this --> moot after Renet took the map entries into #7916; merge back to back
- [NIT] pill's needsYouQuestions arm unpinned --> FIXED (now on #7916 with the pill); held ask with no start untested --> FIXED (heldNoStart)
- [NIT] tasks map pin one-way --> pre-existing, the room pin is two-way

#### Iteration 4
**Reviewer model:** sonnet
- [NIT] plan did not list heldNoStart and the askWait words source --> FIXED
- [NIT] a held task row with no known start shows no line --> parity with the web, no change

### Validation
On a2d3b3930b, a still tree: room 825/825, tasks 139/139, main 1917/1917, actions 99/99, newtask 108/108, taskpage
112/112, files 119/119, settings 42/42; ios.board-parity-7084.test.js 11/11. Mutants: removing the task-row held arm
(2 fails) or the needs-notice held arm (1 fail) goes red. The full node suite was not run: the diff is Swift and a plan,
and a release cut (0.7.88) was in progress; iOS CI runs on the PR.

### Strengths
- Each condition mirrors the web branch exactly, including "every" on the wait line and question-only held.
- Strict boolean reads (`isTrue`), so `1` is not held, as the web's `=== true`.
- Absent fields read as the plain words, so an older board is unchanged.
