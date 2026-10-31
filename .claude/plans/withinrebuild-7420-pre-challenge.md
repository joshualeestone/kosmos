---
pre_challenge: true
method: challenge-loop
branch: withinrebuild-7420
diff_hash: 2c52827f742151a7d80c26d4aabd4a51f18d728553fa14e418d7e809449bda60
validation: passed
subdir_audit: passed
timestamp: 2026-10-31T19:49:40Z
iterations: 4
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (the bound the plan set before round 1)
**Converged:** No. Stopped at the plan's 4-round bound; round 4's remaining WARNINGs are on kosmos#7688 (claimed, built on
branch rebuildfollow-7688, which goes after this).
**Total findings (actionable):** 1 BLOCKER, about 12 WARNINGs, plus NITs
**Fixed:** the BLOCKER and every round 1 to 3 WARNING | **Deferred:** 5 (round 4, on #7688) | **Asked (awaiting user):** 0

Notes, stated plainly:
- Validation (full suite) passed on the pre-rebase base (79bc473eaa: REAL_EXIT=0, AUDIT_EXIT=0, 13:53 CDT). The branch was
  then rebased onto main 9cf6c3d426 (12 commits replayed, no conflicts). After the rebase: iOS LogicTests 1770/1770 and
  every ios/LogicTests run-*.sh green (room 744, composer 108, others), and the six node tests that read the Swift
  sources 26/26. CI on this PR runs against current main and decides the merge.
- Simulator, on 79bc473eaa before the rebase: a Release build succeeded; KeyboardSlideUITests 7/7 on iOS 27 and 7/7 on
  iOS 26.5; the control (KOSMOS_SAMPLE_NOREBUILD=1) failed all 3 rebuild checks, so the checks can fail.
- The phone cause of the empty list is NOT reproduced on the simulator; the UI checks call the real recovery through a
  debug hook. The card stays open for Josh's next report (Addresses, not Fixes).
- CI on PR #7692 (first push): the "ui tests (sample board)" job ran all 19 UI checks with 0 failed, and failed only on
  ui-sample.sh's per-class count (KeyboardSlideUITests ran 7, the script expected 3). The count is now 7. Then rebased
  again onto main 026c2de6b1 (14 more commits, no conflicts): iOS LogicTests 1770/1770 and all 8 run-*.sh green.
- A hyphen is used where the template shows an em dash (house rule).

### Per-Iteration Breakdown

#### Iteration 1 (opus)
- [BLOCKER] Release did not compile: sampleNoRebuild's Release value sat inside a DEBUG-only block. Fixed (4691054be3), pinned by a room check.
- [WARNING] the rebuilt list inherited the old list's onScreen / end-shown / settledAtEnd, so its top could ask for an earlier page. Fixed.
- [WARNING] rows counted for any list, not the one they were drawn in. Fixed (epochAtDraw / listEpoch).
- [WARNING] the asks scheduled after a rebuild did not check the chat was still the same. Fixed.
- [WARNING] the keyboard-down check did not assert the rebuild came after the keyboard went down. Fixed.

#### Iteration 2 (sonnet)
- [WARNING] a rebuilt list that drew no row never set off an empty check. Fixed: one check scheduled after the grace (0f282dc386).
- [WARNING] the top and end markers answered for any list. Fixed: only for the list they were drawn in.
- [WARNING] diagCapture's comment did not say when a later reading rebuilds; the plan did not say the cap is per open. Fixed.

#### Iteration 3
- [WARNING] the rebuild budget did not reset when the chat was shown again. Fixed (ddb94c94b3).
- [WARNING] the test marker was read before the rebuild's own scheduled checks. Fixed.
- [WARNING] the plan and emptyRecovery overstated where the recovery runs (effectively iOS 18 and later). Fixed.

#### Iteration 4 (stopped here, at the bound)
- [WARNING] grace and spacing tied only by their values -> #7688 item 1.
- [WARNING] the "did not draw properly" line after a rebuild that cured the chat -> #7688 item 2.
- [WARNING] a rebuilt list whose scroll view is not found again cannot rebuild again -> #7688 item 3 (decided out of scope there).
- [WARNING] testRebuiltAfterTheKeyboardWentDown leaned on a fixed 14 s delay -> #7688 item 4.
- [WARNING] testComposerGrowingKeepsMessagesDrawn is a regression guard only -> #7688 item 5.

Second CI red, 19:36Z, after the rebase: ui-sample 19 of 19 ran, 1 failed on iOS 26.5, testRebuiltListShowsTheNewestMessage
(the rebuild marker never showed). The previous CI run passed all 7 of that class. The run kept no log, so the cause is
reasoned, not measured: the hook fired at a fixed 3 s and a long chat on a loaded runner may not yet be at the newest. The
hook now waits for the newest (up to 15 s) and the marker carries the rebuild count, so none and two differ on a recurrence.
Weakest premise: if the real cause was a second rebuild, this does not fix it, and the next red will say "sample rebuilt 2".
After the change: iOS LogicTests 1770/1770 and room 744/744, Debug and Release typechecks clean. Test hook and test only;
no Release behaviour changed. The UI run itself is CI's.
