---
pre_challenge: true
method: challenge-loop
branch: uikitlist-s2-8221
diff_hash: ca824b6b479a1008c7c06ae5f4e7381dc3829becfd68b7293ac35f882fe0f43a
validation: passed
subdir_audit: passed
timestamp: 2026-11-08T12:38:11Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7 (cap was 8 by Splinter's 10-31 rule; no BLOCKER was ever open)
**Converged:** Yes
**Total findings:** 21 actionable (0 BLOCKERs from reviewers, 1 BLOCKER from validation, 15 WARNINGs, 5 CONVENTIONs), plus NITs
**Fixed:** 17 | **Deferred:** 5 | **Asked (awaiting user):** 0

Every iteration's fixes were also run on the simulator (iPhone 17 Pro Max, iOS 26.5) on both lists, and each primary
check was shown red under a perturbation on the UIKit arm. Counts and perturbations are in the plan's Measured table.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 7 NITs
**Self-generated:** 0 of the above
- [WARNING] ios/Kosmos/ChatList.swift:64 - the scroll-up hook bypasses the scroll delegate, so the capsule check never exercised the real "person scrolled up" path --> FIXED (aa5f6d8bc5): a second capsule check driven by a real drag; shown red with endSlack 100000
- [WARNING] ios/Kosmos/ChatList.swift:18,62 - comments said "nothing in the simulator can drag" and "counts as the person's own scroll" --> FIXED (aa5f6d8bc5): comments say what the hook skips
- [WARNING] .claude/plans/uikitlist-s2-8221.md:6 - "shown able to fail" claimed beyond what was measured --> FIXED (19bcc4ca24): claims narrowed, per-arm table
- [WARNING] ios/KosmosUITests/UIKitListArm.swift:7 - CI runs none of this; say so --> FIXED (19bcc4ca24): plan states it; PR body will too
- [WARNING] ios/KosmosUITests/NewMessagesUITests.swift:63 - the next-arrival wait waited on a count, result discarded --> FIXED (aa5f6d8bc5): waits on the arrival's number, then settles it
- NITs fixed alongside: flash-catching control, search waits for the keyboard, drag ends clear of the home indicator, Release-closure comment

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 2 of the above (test lines written by iteration 1's fix; code, fixed normally)
- [WARNING] ios/KosmosUITests/NewMessagesUITests.swift:56 - "arrivals stay below the screen" skipped when nothing drawn --> FIXED (e4eab8c171)
- [WARNING] ios/KosmosUITests/NewMessagesUITests.swift:84 - drag control could be fooled by a newer arrival --> FIXED (e4eab8c171): re-reads the newest after the drags
- [WARNING] ios/Kosmos/ChatList.swift:171 - hook could fire again on a rebuilt list --> FIXED (e4eab8c171), refined in iterations 3 and 4

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 3 CONVENTIONs, 3 NITs
**Self-generated:** 2 of the above
- [WARNING] ios/KosmosUITests/NewMessagesUITests.swift:33 - arrivals read by query index, which can shift --> FIXED (291a4d3e90): re-queried by their own number
- [WARNING] ios/KosmosUITests/ChatSearchUITests.swift - lazy-arm search failures unexplained beside the code --> FIXED (291a4d3e90): class comment names the lazy list's known blank
- [WARNING] ios/Kosmos/ChatList.swift:174 - done-flag set at scheduling, so a torn-down list drops the scroll for good --> FIXED (291a4d3e90): set once it has scrolled
- [CONVENTION] NewMessagesUITests header claimed "not moved", which is slice 3 --> FIXED (291a4d3e90): claim removed, header says only what is checked
- [CONVENTION] plan finish bar vs search not perturbed --> FIXED (95b0db437d): search shown red with chatFilter ignoring the query
- [CONVENTION] plan's CI reason incomplete --> FIXED (95b0db437d)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 3 NITs; plus 1 BLOCKER from validation
**Self-generated:** 3 of the above
- [BLOCKER] validation (6g): room suite red, "sampleNoRebuild has a Release value outside the DEBUG-only block" (my static inserted between its #if and #else) --> FIXED (12e0b82c34): own DEBUG block with a Release value; room 843/843
- [WARNING] NewMessagesUITests:49 - "still higher up" was only an absence --> FIXED (12e0b82c34): an older message on screen, Message 260 not
- [WARNING] NewMessagesUITests:56 - press not shown to move the reader --> FIXED (12e0b82c34): the older message leaves the screen
- [WARNING] NewMessagesUITests:60 - capsule-back read once --> FIXED (12e0b82c34): polled 6 s
- [WARNING] ChatList.swift:170 - a second list in the window schedules a second scroll --> FIXED (12e0b82c34): the flag is re-checked when the scroll fires
- [CONVENTION] ChatView.swift:86 - sampleScrollUp had no Release value --> FIXED (12e0b82c34)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
- [WARNING] ios/Kosmos/ChatList.swift:73,78 - trace lines wrote a row id (ids carry agent names) and the #7420 allow-list guard did not read ChatList.swift --> FIXED (b2b519fd3b): ids dropped; guard reads ChatList.swift with a CONTROL; with the id put back it fails "not allowed: id"
- [WARNING] ChatSearchUITests:47 - "newest match on screen" never shown able to fail --> FIXED (deda581a83): shown red with the matches reversed on the UIKit list
- [WARNING] plan:11 - "these query only the few rows" was false --> FIXED (deda581a83); NIT count of long-chat CI classes corrected to three

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 2 of the above
- [WARNING] NewMessagesUITests - arrival could change during its settle --> FIXED (bd27800668): read again until stable
- [WARNING] NewMessagesUITests - held row "not hittable" could be the capsule covering it --> FIXED (bd27800668): it must also have moved 200 pt or more
- [WARNING] ChatDragUITests - messages-drawn half is weak --> DEFERRED: the plan states it was not perturbed; the dismissal half carries the check
- [WARNING] ChatList.swift - rested closure may write stale state --> DEFERRED: @State storage persists across rebuilds; Debug-only; reviewer rated it harmless
- [CONVENTION] no CI coverage --> DEFERRED: stated in the plan; the runner is owed by a later slice (slice 1's plan)

#### Iteration 7
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
**Duplicates of prior findings:** 3 (6 s capsule window: a known limit, covers a 5 s read; held-row label uniqueness: the sample's "Message N of 260." labels are unique; missing-row hook: the rested marker never shows, so the check fails at its CONTROL naming the cause)
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | ios/Kosmos/ChatList.swift:64 | BRANCH | hook bypasses delegate; capsule never tested a real scroll | FIXED | aa5f6d8bc5 |
| 2 | 1 | WARNING | ios/Kosmos/ChatList.swift:18 | BRANCH | comments overstate the hook | FIXED | aa5f6d8bc5 |
| 3 | 1 | WARNING | .claude/plans/uikitlist-s2-8221.md:6 | BRANCH | plan over-claims "able to fail" | FIXED | 19bcc4ca24 |
| 4 | 1 | WARNING | ios/KosmosUITests/UIKitListArm.swift:7 | BRANCH | no CI coverage unstated | FIXED | 19bcc4ca24 |
| 5 | 1 | WARNING | NewMessagesUITests.swift:63 | BRANCH | wait on a count | FIXED | aa5f6d8bc5 |
| 6 | 2 | WARNING | NewMessagesUITests.swift:56 | SELF | arrivals check skips when nothing drawn | FIXED | e4eab8c171 |
| 7 | 2 | WARNING | NewMessagesUITests.swift:84 | SELF | drag control fooled by newer arrival | FIXED | e4eab8c171 |
| 8 | 2 | WARNING | ChatList.swift:171 | BRANCH | hook re-fires on rebuild | FIXED | e4eab8c171 |
| 9 | 3 | WARNING | NewMessagesUITests.swift:33 | SELF | read by index | FIXED | 291a4d3e90 |
| 10 | 3 | WARNING | ChatSearchUITests.swift | BRANCH | lazy flake unexplained | FIXED | 291a4d3e90 |
| 11 | 3 | WARNING | ChatList.swift:174 | SELF | flag at scheduling | FIXED | 291a4d3e90 |
| 12 | 3 | CONVENTION | NewMessagesUITests.swift:3 | SELF | header claim beyond the check | FIXED | 291a4d3e90 |
| 13 | 3 | CONVENTION | plan:6 | BRANCH | search not perturbed | FIXED | 95b0db437d |
| 14 | 3 | CONVENTION | plan:8 | BRANCH | CI reason incomplete | FIXED | 95b0db437d |
| 15 | 4 | BLOCKER | ios/Kosmos/ChatView.swift:87 | BRANCH | final-validation: room suite sampleNoRebuild check | FIXED | 12e0b82c34 |
| 16 | 4 | WARNING | NewMessagesUITests.swift:49 | SELF | higher-up only an absence | FIXED | 12e0b82c34 |
| 17 | 4 | WARNING | NewMessagesUITests.swift:56 | SELF | press not shown to move | FIXED | 12e0b82c34 |
| 18 | 4 | WARNING | NewMessagesUITests.swift:60 | BRANCH | capsule-back read once | FIXED | 12e0b82c34 |
| 19 | 4 | WARNING | ChatList.swift:170 | SELF | duplicate scroll | FIXED | 12e0b82c34 |
| 20 | 4 | CONVENTION | ChatView.swift:86 | SELF | no Release value | FIXED | 12e0b82c34 |
| 21 | 5 | WARNING | ChatList.swift:73 | BRANCH | trace lines carry a row id; guard blind to ChatList | FIXED | b2b519fd3b |
| 22 | 5 | WARNING | ChatSearchUITests.swift:47 | BRANCH | newest-match half not shown to fail | FIXED | deda581a83 |
| 23 | 5 | WARNING | plan:11 | SELF | false claim about queries | FIXED | deda581a83 |
| 24 | 6 | WARNING | NewMessagesUITests.swift | SELF | arrival changes during settle | FIXED | bd27800668 |
| 25 | 6 | WARNING | NewMessagesUITests.swift | SELF | held row could be covered | FIXED | bd27800668 |
| 26 | 6 | WARNING | ChatDragUITests.swift | BRANCH | messages-drawn half weak | DEFERRED | documented in plan as not perturbed |
| 27 | 6 | WARNING | ChatList.swift | BRANCH | rested closure stale state | DEFERRED | @State persists; Debug-only |
| 28 | 6 | CONVENTION | (whole branch) | BRANCH | no CI coverage | DEFERRED | owed by a later slice, stated in plan |

### NITs (non-blocking, across all iterations)
- Int passed to %d in a predicate (iteration 1; removed with the rewrite)
- 0.6 s rest timer comment (iterations 1, 4, 5; comment kept minimal by choice)
- sampleScrollRested never reset on the UIKit path (iteration 1; moot once the hook runs once a launch)
- lazy hook still reads its env var inline (iteration 5; left alone so the lazy list is untouched)
- heldRow lookup by subscript (iteration 5; changed to a label predicate in bd27800668)
- allow-list comment placement (iteration 6; fixed in bd27800668)
- drag end point over the keyboard deserves a comment (iteration 7)

### Strengths (across all iterations)
- Every app change is Debug-only; the Release build and the lazy list are unchanged (all iterations)
- atEnd set before the scroll so layout cannot pin the reader back (iterations 1, 5, 7)
- Real controls in every check, and each primary check perturbed red on the UIKit arm (iterations 3, 5, 7)
- The side-lock check was dropped because it could not fail, and recorded (iterations 1 to 7)
- The search check found a real blank on the current list (3 of 7 runs), recorded on #8221
