---
pre_challenge: true
method: challenge-loop
branch: dmsettle-7609
diff_hash: 7228622d795e4fd8a4d29c6f8591728bfc6ec726c04736d35412fe600b751a99
validation: passed
subdir_audit: passed
timestamp: 2026-10-31T13:09:39Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10
**Converged:** Yes (past the fleet's cap of 8 rounds; Splinter 07:48 noted it; recorded, not repeated)
**Total findings:** 40 (0 BLOCKERs, 25 WARNINGs, 4 CONVENTIONs, 11 NITs counted as raised)
**Fixed:** 24 | **Deferred:** 3 | **Asked (awaiting user):** 0

### Order of work and validation (stated so it is not misread)
- Before round 1: the room logic suite's #7420 trace guard failed on two new trace values; fixed (Int(moved), Int(f * 100)
  admitted with a comment).
- 6.0's validation went red only on engine/undo-5153 (the date bomb, #7671), fixed on main by PR #7672; the branch was
  rebased onto it after round 3.
- Several mid-loop validations went red only on unrelated node timeouts while the Mac sat at load 25 to 41; one cause was a
  runaway simulator of mine (a Kosmos debug app at 100% CPU for 10 h 48 min), shut down 07:45. The final run on this HEAD,
  through queued-heavy.sh, passed (validation-log hash 7228622d795e, the hash above). That run is the 6j gate.
- Every round's code was compiled and run on the iOS 26.5 simulator (iPhone 17e) before or beside the next review: 56 runs
  of the DM keyboard checks across seven batches, 55 passed; the one failure was the sample's debug scroll under load 41,
  before the hold ran (recorded in the plan).
- The rounds' reviewers ran while some of those simulator batches ran; no edit was made during a batch after round 5.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 6 WARNINGs, 2 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] ChatView.swift lost path - skipped putBack's stand-downs (finger, earlier messages, width) --> FIXED (51473a0eca)
- [WARNING] ChatView.swift lost path - never called onPutBack, so the at-the-newest re-check was lost --> FIXED (51473a0eca)
- [WARNING] ChatView.swift drawn path - settle and row watch fought --> FIXED (51473a0eca); the drawn-path settle was later removed (round 9)
- [WARNING] ChatView.swift settleOnScreen - no token against stand-downs, keyboards, leaving the window --> FIXED (51473a0eca)
- [WARNING] ChatView.swift settle - offset not clamped --> FIXED (51473a0eca, Board.settleOffset)
- [WARNING] ChatView.swift DM closure - let-go rule differed from put-back's --> FIXED (51473a0eca); reasoned difference stated in round 3
- [CONVENTION] plan - Measured had only the room's evidence --> FIXED (51473a0eca)
- [CONVENTION] no unit test for the fraction and settle --> FIXED (51473a0eca, Board.bandFraction/settleOffset + LogicTests)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 4 of the above (inside round 1's fixes)
- [WARNING] settle after putBack stood down (earlier messages, width) --> FIXED (2d43a8fee2)
- [WARNING] lost-path settle without above/width checks --> FIXED (2d43a8fee2)
- [WARNING] fraction mixes will-show and did-show bands; comment overclaimed --> FIXED (2d43a8fee2): comment says approximate
- [WARNING] window-end trace read the stale kept offset --> FIXED (2d43a8fee2)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 2 of the above
- [WARNING] settle vs a queued put-back in one turn --> FIXED (925d59bccb, one more main-queue turn)
- [WARNING] nothing guarded the row after a placing --> FIXED (925d59bccb, re-armed guard)
- [WARNING] an "end" anchor kept on the lost path --> FIXED (925d59bccb, let go always, reason stated)
- [CONVENTION] doc comment claimed every put-back settled --> FIXED (925d59bccb)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 3 of the above
- [WARNING] re-armed guard had no end timer --> FIXED (3096a318d8)
- [WARNING] no retry when a placed row is not drawn --> FIXED (3096a318d8)
- [WARNING] a new keyboard's will-show did not drop a waiting settle --> FIXED (3096a318d8)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 4 of the above
- [WARNING] a skipped settle still let the anchor go --> FIXED (5584961e40)
- [WARNING] drawn-path settle acted after a quick tap --> FIXED (5584961e40)
- [WARNING] lost path dropped the fresh-chat guard --> FIXED (5584961e40)
- [WARNING] any will-show dropped a waiting settle --> FIXED (5584961e40, keyboardUp)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 2 of the above
- [WARNING] a second will-show overwrote the settle's target --> FIXED (3370dedd63, want per placing)
- [WARNING] a dropped placing settle skipped the re-check --> FIXED (3370dedd63)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above
- [WARNING] plan measurements stale --> FIXED (44c5f9024f)
- [WARNING] an ignored will-show left no trace --> FIXED (44c5f9024f)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 2 of the above
- [WARNING] keyboardUp could stick and turn the hold off --> FIXED (4ce7a60c73, the gate removed from readings)
- [WARNING] no unit test of the Probe's state machine --> DEFERRED: UIKit view, covered by KeyboardSlideUITests; refactor out of scope (in the plan)
- [WARNING] one retry only --> FIXED (4ce7a60c73, retries until the window ends)

#### Iteration 9
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 2 of the above
- [WARNING] drawn-path settle could double-correct a put-back --> FIXED (65fd82ea07) by REMOVING the drawn-path settle: the CI failure was only the not-drawn path
- [WARNING] plan's will-show sentence wrong about did-show --> FIXED (65fd82ea07)
- [CONVENTION] plan stated the CI pass as fact --> FIXED (65fd82ea07, pending)

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs new after dedup, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings:** 1 (keyboardUp without a will-hide: round 8's concern, fixed; its remaining effect is documented)
**Deferred:** 1 (the re-arm can precede the chat's at-the-newest re-read by one main-queue turn: in that turn only the row watch can act, putting the reader's own row back, and the hold's stand-down follows; no harmful move found)
**Converged** - no new actionable findings.

### Final Ledger (WARNINGs and CONVENTIONs; NITs below)

| # | Iter | Category | Where | Origin | Description | Status | Resolution |
|---|------|----------|-------|--------|-------------|--------|------------|
| 1-8 | 1 | 6 W, 2 C | ChatView/plan | BRANCH | as listed above | FIXED | 51473a0eca |
| 9-12 | 2 | W | ChatView | SELF | as listed above | FIXED | 2d43a8fee2 |
| 13-16 | 3 | 3 W, 1 C | ChatView | SELF/BRANCH | as listed above | FIXED | 925d59bccb |
| 17-19 | 4 | W | ChatView | SELF | as listed above | FIXED | 3096a318d8 |
| 20-23 | 5 | W | ChatView | SELF | as listed above | FIXED | 5584961e40 |
| 24-25 | 6 | W | ChatView | SELF | as listed above | FIXED | 3370dedd63 |
| 26-27 | 7 | W | plan/ChatView | SELF | as listed above | FIXED | 44c5f9024f |
| 28 | 8 | W | ChatView | SELF | keyboardUp stuck | FIXED | 4ce7a60c73 |
| 29 | 8 | W | Probe | BRANCH | no unit test of the state machine | DEFERRED | UIKit, covered by UI tests |
| 30 | 8 | W | ChatView | SELF | one retry only | FIXED | 4ce7a60c73 |
| 31-33 | 9 | 2 W, 1 C | ChatView/plan | SELF | as listed above | FIXED | 65fd82ea07 |
| 34 | 10 | W | ChatView | SELF | re-arm before the at-the-newest re-read | DEFERRED | self-healing in one turn, no harmful move |

### NITs (non-blocking, across all iterations)
- keptScreenTop beside Reading rather than inside it (1); the onRowLost == nil branch has no caller left (3, 9); a shared helper for the band edges and for putBack's stand-downs (5, 7); the re-arm end timer duplicates the did-show one (10); the retry's last-reading check is defensive only (10)

### Strengths (across all iterations)
- One settle token covers every way the hold's claim ends; [weak self] throughout, no retain cycle (rounds 3 to 10)
- Board.bandFraction and Board.settleOffset are pure, clamped like holdTarget, and unit-tested including the 1,241 pt end case (rounds 2 to 10)
- New trace values are numbers only and admitted in the #7420 guard (every round)
- The fix targets the CI mechanism: a not-drawn row is placed by id and settled by its screen place instead of a stale content reading (every round)
