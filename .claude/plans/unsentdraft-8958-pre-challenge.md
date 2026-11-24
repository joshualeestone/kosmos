---
pre_challenge: true
method: challenge-loop
branch: unsentdraft-8958
diff_hash: 1328ec963700a33b9296938f463def55462a9b57ffde4b76710b5b672e30ab7a
validation: passed
subdir_audit: passed
timestamp: 2026-11-24T13:16:18Z
iterations: 9
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 9 (8 in the loop, then 1 on a CI red)
**Converged:** No (stopped at the 8-round cap, Splinter's standing usage rule of 10-22 and 10-26: stop at 8 unless a BLOCKER is open; none was open after iteration 8)
**Total findings:** 15 actionable (0 BLOCKERs, 12 WARNINGs, 3 CONVENTIONs) plus NITs
**Fixed:** 13 | **Deferred:** 3 | **Asked (awaiting user):** 0

Validation: one full run through the heavy queue after the loop (validation_rc=0, audit_rc=0 at 04:34 CST), and again after iteration 9 and a rebase onto origin/main aa24bd6f4 (validation_rc=0, audit_rc=0, rc=0 at 07:16 CST). Between rounds: all 13 ios/LogicTests runners and a swiftc typecheck of every ios/Kosmos source at iOS 16, since a queued full run cannot share the tree with edits.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 2 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] ios/Kosmos/ChatView.swift:3434 - the 44 pt frame sat outside a bordered button, so the tap target was smaller --> FIXED (814bf219bc): frame and hit shape on each label
- [WARNING] ios/Kosmos/ChatView.swift:2744 - the busy mark was cleared after the epoch check, so a sign-out mid-dismiss left Dismiss off for good --> FIXED (814bf219bc)
- [CONVENTION] .claude/plans/unsentdraft-8958.md:34 - plan stale against the sample-draft commit --> FIXED (814bf219bc)
- [CONVENTION] ios/Kosmos/ChatView.swift:3416 - the way-through comment sat above the new view --> FIXED (814bf219bc)
- [NIT] draft id regex and a trailing newline (measured: already refused; the added length check was redundant and removed, 0e63d7ce41); [NIT] a test for a bad session name (added); [NIT] the refill-guard coincidence (recorded in the plan)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs (DEFERRED), 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] plan claims runners pass, unverified by the reviewer --> DEFERRED: measured by the author each round (all 13 runners PASS)
- [WARNING] no thread-level test --> DEFERRED: a parsed thread with a draft row through withoutDraft is tested
- [NIT] large-text button row (ViewThatFits added, e94de43fc7); [NIT] the row as one accessibility container (added); [NIT] dark-mode check of the disabled Dismiss (for the design shots)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] .claude/plans/unsentdraft-8958.md:23 - the plan's "no length limit" was false (Board.maxMessage 10000; a draft can be 64 KB) --> FIXED (d65c302239): Put in the message box says the board's too-long sentence at once
- [NIT] announce a successful Dismiss; [NIT] dictation during Put in; [NIT] runner names in the plan (named)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (the too-long note, written in iteration 3)
- [WARNING] ios/Kosmos/ChatView.swift:2735 - the too-long note outlived its reason --> FIXED (e8096e0d8c): set as the chat's blocked note, so the next edit clears it; decided by length only, so an empty draft is never "too long"

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] ios/Kosmos/ChatView.swift:2759 - a second refusal in a row was not heard by VoiceOver --> FIXED (a8d3af214b): announced, as Try again does; the failure haptic added

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING (DEFERRED), 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] a stale dismiss-failed note can outlast the draft --> DEFERRED: the board behaves the same (parity), low impact
- [NIT] the overOneMessage comment claimed the board's raw-length test --> fixed (comment reworded)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (the UI test, written between iterations 6 and 7)
- [WARNING] ios/KosmosUITests/UnsentDraftUITests.swift:67 - "stays gone past a read" waited 7 s on a clock and could pass with no read --> FIXED (9204bc737a): the chat is closed and reopened (a fresh read)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above
- [WARNING] ios/KosmosUITests/UnsentDraftUITests.swift:56 - with the keyboard up the draft row can leave the tree on the UIKit list --> FIXED (aed947a785): waits for either part of the row
**Stopped** at the 8-round cap with no BLOCKER open.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | ios/Kosmos/ChatView.swift:3434 | BRANCH | 44 pt target not delivered | FIXED | 814bf219bc |
| 2 | 1 | WARNING | ios/Kosmos/ChatView.swift:2744 | BRANCH | busy mark kept past an epoch change | FIXED | 814bf219bc |
| 3 | 1 | CONVENTION | .claude/plans/unsentdraft-8958.md:34 | BRANCH | plan stale | FIXED | 814bf219bc |
| 4 | 1 | CONVENTION | ios/Kosmos/ChatView.swift:3416 | BRANCH | comment above the wrong view | FIXED | 814bf219bc |
| 5 | 2 | WARNING | .claude/plans/unsentdraft-8958.md:36 | BRANCH | runners unverified by reviewer | DEFERRED | measured by author |
| 6 | 2 | WARNING | ios/LogicTests/main.swift:1166 | BRANCH | thread-level path | DEFERRED | already tested |
| 7 | 3 | WARNING | .claude/plans/unsentdraft-8958.md:23 | BRANCH | false "no length limit" | FIXED | d65c302239 |
| 8 | 4 | WARNING | ios/Kosmos/ChatView.swift:2735 | SELF | too-long note outlived its reason | FIXED | e8096e0d8c |
| 9 | 5 | WARNING | ios/Kosmos/ChatView.swift:2759 | BRANCH | repeat refusal not announced | FIXED | a8d3af214b |
| 10 | 6 | WARNING | ios/Kosmos/ChatView.swift:2733 | BRANCH | stale dismiss-failed note | DEFERRED | board parity |
| 11 | 6 | CONVENTION | ios/Kosmos/BoardLogic.swift:1748 | SELF | comment overstated parity | FIXED | f6a7631063 |
| 12 | 7 | WARNING | ios/KosmosUITests/UnsentDraftUITests.swift:67 | SELF | clock wait could pass with no read | FIXED | 9204bc737a |
| 13 | 8 | WARNING | ios/KosmosUITests/UnsentDraftUITests.swift:56 | SELF | row can leave the tree with the keyboard up | FIXED | aed947a785 |

#### Iteration 9 (after CI run 45376693324 went red)
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER found by CI, 0 by the reviewer, 1 NIT
- [BLOCKER] ios/KosmosUITests/UnsentDraftUITests.swift:25 - app.staticTexts[band] with the 140-character band: XCUITest refuses a subscript identifier over 128 characters, so testDismissTakesTheDraftAway and testTheDraftIsDrawnInTheChat failed on both chat lists --> FIXED (b4627497f5): a label predicate. UnsentDraftUITests 3 of 3 passed alone on a local simulator (lazy list); the reviewer read every caller and the band's view and found nothing more
- [NIT] the comment cites a CI run id --> kept, it is the evidence
- Rebased onto origin/main aa24bd6f4: ios/tools/ui-sample.sh conflicted with #8953's WebFileUITests on the classes line; both classes kept. ios.ui-sample-shard-8453 and ios.ui-sample-tally-7609 tests 6 of 6

### NITs (non-blocking, across all iterations)
- trailing-newline id (measured already refused; redundant guard removed) (1)
- refill-guard coincidence, recorded in the plan (1)
- large-text buttons, VoiceOver grouping (2, fixed)
- announce a successful Dismiss; dictation during Put in (3)
- review-round labels in comments are opaque to later readers (4)
- busy Dismiss has no "dismissing" cue (4, 6; board parity)
- very long drafts are tall rows; textSelection in a UIKit-hosted cell (5, 8; noted in the plan)
- UI test queries could be scoped tighter (7, 8)

### Strengths (across all iterations)
- Words, request, 2xx-or-404 gone rule and the append rule all match the board's dmDraftDismiss / dmDraftUse
- The draft id is parsed only on Kosmos's own draft row and only in the Mac's 12-hex shape; a row without one keeps the board link
- The dismiss flow follows deleteMine and reactTo: busy mark before the epoch check, a read in the air dropped
- Tests with controls that can fail the other way, mutants for the kind guard and the 404 rule, and a UI test on both chat lists that reopens the chat to prove the dismiss reached what the chat reads
