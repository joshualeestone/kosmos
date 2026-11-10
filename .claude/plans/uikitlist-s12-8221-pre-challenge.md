---
pre_challenge: true
method: challenge-loop
branch: uikitlist-s12-8221
diff_hash: a9b05228c382dd7bb362124b75a689a70a6ccb0a53978a4185461c6df588bc68
validation: passed
subdir_audit: passed
timestamp: 2026-11-10T03:44:38Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No (stopped at the standing 8-round review cap, Splinter 2026-10-31, with no BLOCKER open; not a user stop)
**Total findings:** 47 (1 BLOCKER, 26 WARNINGs, 0 CONVENTIONs, 20 NITs), plus 1 synthetic validation BLOCKER
**Fixed:** 34 | **Deferred:** 13 (6 of them carried to the card as follow-ups from iteration 8) | **Asked (awaiting user):** 0

Reviewed diff: the slice 12 commits (stacked on slice 11 during review, rebased onto main after slice 11 merged as #8343;
the slice 12 change itself compared identical before and after the rebase). Origin column: BRANCH throughout, the
fail-safe value; 6c-bis blame classification was not run per finding, so the Self-generated lines below are not
measured. By reading, most findings from iteration 2 on were in code an earlier iteration of this loop wrote.

Tests run alongside: A11yFocusUITests (12) on iOS 26.5 after each round's fixes; final run on the rebased head 28 of 28
(A11yFocus 12, A11yScroll 7, ChatGap 3, EndPull 6); all 12 iOS logic suites; full validation passed (hash
a9b05228c382) after one earlier red (kosmos#7420 trace allow-list) fixed in iteration 1.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 4 WARNINGs, 0 CONVENTIONs, 3 NITs (+1 synthetic validation BLOCKER)
**Self-generated:** not measured
- [BLOCKER] ChatList.swift focusFollow: the newest-row guard compared against the hidden "end" spacer and never matched --> FIXED (5e7d93fa)
- [BLOCKER] validation: room suite kosmos#7420, a trace line interpolated the mode string --> FIXED (5e7d93fa)
- [WARNING] atEnd set false unconditionally, never re-read --> FIXED (5e7d93fa)
- [WARNING] row-frame trigger snapped tall rows and nudged clipped top rows --> FIXED (5e7d93fa), element frame used
- [WARNING] reused cell after a pin-back can name the wrong row --> DEFERRED: not observable on a simulator; in the plan's weakest premise
- [WARNING] tests did not cover the newest row, a tall row, or below --> FIXED (5e7d93fa), newest and below checks
- [NIT] sampleA11yDone comment, found comment, no-element report --> FIXED (5e7d93fa)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** not measured
- [WARNING] a message clipped by under the 40 pt slack was pinned back --> FIXED (f6bd0857), heldByFocus and endReached
- [WARNING] visibility measured inside the list's padding --> FIXED (f6bd0857), safe area
- [WARNING] the list itself as the focused element mapped to a middle row --> FIXED (f6bd0857)
- [WARNING] plan and test header stale --> FIXED (f6bd0857)
- [NIT] forced wasAtEnd, shadowed newest, observer not replaced, trailing comments --> FIXED (f6bd0857, e2285c0a)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** not measured
- [WARNING] no way back to the newest by swiping --> FIXED (d7753056, a1bc8798 after measuring the 53 pt gap)
- [WARNING] VoiceOver's own focus after a jump to the newest followed --> FIXED (d7753056), 1 s grace
- [NIT] fling not guarded, stale comments (x2), plan timing wording --> FIXED (d7753056)
- [NIT] the agrees field is a weak signal --> DEFERRED: kept as a consistency check; the onScreen, pins and moved asserts carry the weight

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** not measured
- [WARNING] re-read back on the newest gave up while moving --> FIXED (694458a4)
- [WARNING] refocus after an update followed --> FIXED (694458a4)
- [WARNING] frame read after a layout that can move the list --> FIXED (694458a4)
- [NIT] snapshot copy, comment wrap --> FIXED (694458a4)
- [NIT] tall-newest check has no fix-off control --> DEFERRED: it fails if the guard goes; carried to the card

Measured between iterations 4 and 5 (a1bc8798): the below check found a bottom-aligned message pushed 16 pt off by rows
drawn for the first time (place now held by the focused row); the back check found the list 53 pt short of its end with
the newest fully in view (newestShown).

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** not measured
- [WARNING] a chat opening not covered by the grace --> FIXED (4b53acb1)
- [WARNING] no guard against slice 11's scroll without a finger --> FIXED (4b53acb1)
- [WARNING] row not measured again after the move's layout --> FIXED (4b53acb1)
- [NIT] clipped comment and bound, refocus comment --> FIXED (4b53acb1)
- [NIT] debug closures hold the list strongly --> DEFERRED: DEBUG only, at most 1.2 s

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** not measured
- [WARNING] scrolled() replaced the focused-row place with top() --> FIXED (46d454dc), focusPlace
- [WARNING] refocus and jump grace untested --> FIXED (46d454dc), two checks
- [WARNING] re-read chain never cancelled --> FIXED (46d454dc), rereadGen
- [NIT] clipped comment, non-cell list subviews --> FIXED (46d454dc)
- [NIT] "padding kept" comment wrong --> DEFERRED: the adjusted inset includes the padding, so the padding is kept

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** not measured
- [WARNING] refocus keyed on the row skipped other parts of the same message --> FIXED (0677e599), keyed on the place within the row
- [WARNING] second measure unreachable --> FIXED (0677e599), runs for the list's own element
- [WARNING] laidOut took top() after a scroll with no end --> FIXED (0677e599)
- [NIT] strict-end trade-off unstated, too-few-rows message, comment --> FIXED (0677e599)
- [NIT] on-screen kind may be a UIView; guards (composer, finger) untested --> DEFERRED: carried to the card

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** not measured
**Stopped here: the standing 8-round cap, no BLOCKER open.** All carried to kosmos#8221 as follow-ups:
- [WARNING] the 1 s grace after a jump or an open is a timing guess --> DEFERRED: card
- [WARNING] the newest message is never moved for, however tall --> DEFERRED: card (deliberate, the newest check pins it)
- [WARNING] a SwiftUI element's own frame is not measured again after the layout --> DEFERRED: card
- [WARNING] refocus rule skips a return to the very element after an update --> DEFERRED: card (documented in the plan)
- [WARNING] lastFocusRow follows on-screen focuses too --> DEFERRED: card
- [NIT] back check asserts only the end state; on-screen check has no control --> DEFERRED: card

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | ChatList.swift focusFollow | BRANCH | newest guard never matched | FIXED | 5e7d93fa |
| 2 | 1 | BLOCKER | validation | BRANCH | trace allow-list (mode string) | FIXED | 5e7d93fa |
| 3 | 2 | WARNING | ChatList.swift focusFollow | BRANCH | clipped row pinned back | FIXED | f6bd0857 |
| 4 | 3 | WARNING | ChatList.swift focusFollow | BRANCH | no way back to the newest | FIXED | d7753056, a1bc8798 |
| 5 | 6 | WARNING | ChatList.swift scrolled | BRANCH | place lost on scroll end | FIXED | 46d454dc |
| 6 | 7 | WARNING | ChatList.swift focusFollow | BRANCH | refocus too broad | FIXED | 0677e599 |
| 7 | 8 | WARNING | ChatList.swift | BRANCH | five iteration-8 warnings | DEFERRED | card follow-ups |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- debug closures hold the list for up to 1.2 s (iteration 5)
- the agrees field is a consistency check, not a threshold check (iteration 3)

### Strengths (across all iterations)
- Nothing changes for people not using assistive technology: heldByFocus is set only by the focus notification, and endReached is the old expression without it (iterations 5, 7, 8)
- Fix-off control arms on above and after read the defect (iterations 1 to 8)
- Observer captured weakly, replaced if made again, removed in deinit (iterations 1, 4, 8)
- DEBUG hooks gated; trace values on the allow-list; no em dashes (every iteration)
