---
pre_challenge: true
method: challenge-loop
branch: composergrow-7817
diff_hash: e589972ab596f306aff8f663196a2db4bb32ec9ab6e4bf764bdb999530d76251
validation: passed
subdir_audit: passed
timestamp: 2026-11-03T03:35:43Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No: stopped at the 8-round review cap (Splinter's standing rule, 10-31: cap 8 rounds unless a BLOCKER is open). No BLOCKER was open after round 1; round 8 raised no new WARNING (its two were duplicates of documented residuals) and one CONVENTION, fixed after the cap and not reviewed.
**Total findings:** 37 (1 BLOCKER, 21 WARNINGs, 3 CONVENTIONs, 12 NITs)
**Fixed:** 13 | **Deferred:** 10 | **Asked (awaiting user):** 0

Validation: full suite passed on fc88c4352f (26528 tests, 0 fail). UI: ios/tools/ui-sample.sh 27 of 27 on a fresh iPhone 17e simulator, run at 21:25 CST on fc88c4352f (all 9 KeyboardSlideUITests). The new grow test failed on main's code (gap 90 to 46 pt after one line).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 4 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [BLOCKER] ios/tools/ui-sample.sh:30 — KeyboardSlideUITests count pinned at 7; an 8th test turns CI red --> FIXED (a44313c6fe): 9
- [WARNING] ios/tools/ui-keyboard.sh:51 — stale count 3 --> FIXED (a44313c6fe)
- [WARNING] KeyboardSlideUITests shrink arm may never shrink --> FIXED (a44313c6fe): deletes four pieces, asserts a line lost
- [WARNING] higher-up reader untested --> FIXED (a44313c6fe): testReadHigherUpStaysWhileTheBoxGrows
- [WARNING] iOS 16/17 atBottom cleared before the follow --> FIXED then reverted (see iteration 2); residual in plan
- NITs: appMoves bump (done), strip covers emoji and reply rows (comment), stale #7420 comment (done), unused TRACE

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] positionId == "end" a stale proxy, pulls a reader down --> FIXED (678814b58f): removed
- [WARNING] first measure fires at open --> FIXED (678814b58f), revised in iterations 4 and 7
- [WARNING] keyboard show/hide changes the strip --> DEFERRED: same unanimated move as keyboardDidShow at the newest; not a reader higher up

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] KeyboardHold window atBottom briefly true --> DEFERRED: residual in plan
- [WARNING] device symptom not proven --> DEFERRED: plan and PR say so; card stays open until a TestFlight build
- [CONVENTION] runner comments "three" --> FIXED (2a70ecd927)
- NITs: unmeasured plan sentence removed; double appMoves on iOS 16 (fixed); trace dump

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] capture-list old value unreliable --> FIXED (3ba11cb81c), superseded by iteration 7
- [WARNING] keyboard changes the strip --> duplicate of iteration 2
- [WARNING] no anchorLetGo guard --> FIXED (3ba11cb81c), reverted in iteration 5

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] anchorLetGo guard stops the follow after a scroll back down --> FIXED (be3d7ca1f6): guard removed
- [WARNING] new tests write the scroll trace other checks print --> FIXED (be3d7ca1f6)
- NITs: stripSeen across a switch (done), plan count, per-piece check in the higher-up test (done)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above
- [WARNING] stripSeen = 0 on a switch swallows the first wrap --> FIXED (a3ad337201), superseded by iteration 7
- [WARNING] keyboard changes the strip --> duplicate

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above
- [WARNING] the seen-height guard swallows the first wrap after a chat opens (the strip is measured before the list exists) --> FIXED (823206f6b8): guard and stripSeen removed
- NITs: no trace in the new tests (kept off, iteration 5), shrink arm not shown to fail alone, animated strip changes

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 4 NITs (2 WARNINGs were duplicates)
**Self-generated:** 0 of the above
- [CONVENTION] ios/tools/ui-keyboard.sh:56 — failure line says "of 3" --> FIXED after the cap (fc88c4352f), not reviewed
- Duplicates: keyboard changes the strip (iteration 2); first measure with a kept copy (plan)
**Stopped at the cap.**

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | ios/tools/ui-sample.sh:30 | BRANCH | class count | FIXED | a44313c6fe |
| 2 | 1 | WARNING | ios/tools/ui-keyboard.sh:51 | BRANCH | stale count | FIXED | a44313c6fe |
| 3 | 1 | WARNING | KeyboardSlideUITests.swift:177 | BRANCH | shrink never shrinks | FIXED | a44313c6fe |
| 4 | 1 | WARNING | ChatView.swift:767 | BRANCH | higher-up untested | FIXED | a44313c6fe |
| 5 | 1 | WARNING | ChatView.swift:560 | BRANCH | iOS 16/17 residual | DEFERRED | in plan |
| 6 | 2 | WARNING | ChatView.swift:771 | SELF | stale end proxy | FIXED | 678814b58f |
| 7 | 2 | WARNING | ChatView.swift:227 | BRANCH | first measure at open | FIXED | 823206f6b8 |
| 8 | 2 | WARNING | ChatView.swift:770 | BRANCH | keyboard changes strip | DEFERRED | same move as keyboardDidShow |
| 9 | 3 | WARNING | ChatView.swift:769 | BRANCH | KeyboardHold window | DEFERRED | in plan |
| 10 | 3 | WARNING | plan | BRANCH | device symptom unproven | DEFERRED | card stays open |
| 11 | 4 | WARNING | ChatView.swift:769 | SELF | capture old value | FIXED | superseded 823206f6b8 |
| 12 | 4 | WARNING | ChatView.swift:770 | BRANCH | anchorLetGo | FIXED | reverted be3d7ca1f6 |
| 13 | 5 | WARNING | ChatView.swift:775 | SELF | anchorLetGo stops follow | FIXED | be3d7ca1f6 |
| 14 | 5 | WARNING | ui-sample.sh:100 | BRANCH | trace pollution | FIXED | be3d7ca1f6 |
| 15 | 6 | WARNING | ChatView.swift:409 | SELF | reset swallows first wrap | FIXED | a3ad337201 |
| 16 | 7 | WARNING | ChatView.swift:775 | SELF | guard swallows first wrap at open | FIXED | 823206f6b8 |

### Strengths (across all iterations)
- the follow reuses keyboardDidShow's unanimated end move, guarded on visible, atBottom, not searching, no person scroll, no finger (every round)
- the grow test measures the gap to the box itself after each piece and a real shrink, and fails on main for the right reason (every round)
- the plan names each residual it did not close (rounds 3 to 8)
