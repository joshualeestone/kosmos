---
pre_challenge: true
method: challenge-loop
branch: emptyclamp-7420
diff_hash: 3dea5d82258f5f9f0719ab866f5f377d44948b3b3c29e58605e85de78b345ffc
validation: passed
subdir_audit: passed
timestamp: 2026-10-31T05:15:47Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10
**Converged:** Yes (iteration 10 raised nothing new after deduplication; no ASKED findings)
**Total findings (actionable, new):** 1 BLOCKER, 24 WARNINGs, 6 CONVENTIONs, plus NITs
**Fixed:** 25 | **Deferred:** 6 | **Asked (awaiting user):** 0

Notes, stated plainly:
- The 6c-bis blame lookup was not run per finding; the Self-generated counts below are estimates from which commit wrote
  the cited lines (loop fix commits 9cf9035491 to b05c9ab4de vs the branch's first commit 7e92b81611).
- Validation: the first final run failed one shell test (tools/test-queued-heavy-4977.sh, a queue tool's own test) under a
  1-minute load of 165 on 12 cores; alone it passed 142/142, and the full re-run passed (25964 tests, 0 failed, hash
  5c24d3942457). The commit after it (656ea42425) changes only this branch's plan.
- Finding lines below use a hyphen where the template shows an em dash (house rule: no em dashes in files left behind).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 3 WARNINGs, 2 CONVENTIONs, 5 NITs
**Self-generated:** 0
- [BLOCKER] ios/LogicTests/room/main.swift:554 - a room source check named the old SideScrollLock call; CI would go red --> FIXED (9cf9035491)
- [WARNING] ChatView.swift:794 - repeated recovery could pull a scrolling reader --> FIXED (9cf9035491, then narrowed in iterations 3 and 4)
- [WARNING] ChatView.swift:806 - binding written by the direct offset write could keep a message anchored --> FIXED (9cf9035491, re-name "end")
- [WARNING] plan - UIScrollView may pull an offset back by itself, so "within" is not proof of drawing --> FIXED (plan caveat)
- [CONVENTION] ScrollBox placed under SideScrollLock's comment --> FIXED (9cf9035491)
- [CONVENTION] plan had no results --> FIXED (results sections, final in 656ea42425)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 3 (all on lines iteration 1 wrote; code, fixed normally)
- [WARNING] ChatView.swift:794 - personScrolling is never set on iOS 17 --> FIXED (63d75b3585, ScrollBox.underFinger)
- [WARNING] ChatView.swift:826 - the "end" re-set ignored a person's scroll --> FIXED (63d75b3585)
- [WARNING] ChatView.swift:2437 - the clamp reads an estimated content size --> FIXED (comment, 63d75b3585)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 4
- [WARNING] repeat trace never reaches a shared report --> FIXED (plan corrected, 04508ca2f1)
- [WARNING] the 1.5 s check makes a second recovery --> FIXED (only outside the content, 04508ca2f1)
- [WARNING] recovery wiring had no failing test --> FIXED (room source check, 04508ca2f1)
- [WARNING] repeat recovery could pull a resting reader on a false empty reading --> FIXED (repeat only when outside, 04508ca2f1)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 2
- [WARNING] ChatView.swift:2443 - "before the top" on the repeat path may be a bounce --> FIXED (2c3debd08c, repeat past the end only)
- [WARNING] room check only by source text --> FIXED (2c3debd08c, Board.emptyRecovery with LogicTests checks)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 4
- [WARNING] BoardLogic.swift:449 - `reported` named the opposite case --> FIXED (d9e00eb8ae, renamed `later`)
- [WARNING] plan finish line contradicted the shipped narrowing --> FIXED (d9e00eb8ae)
- [WARNING] results not measured on the final code --> FIXED (656ea42425)
- [WARNING] plan said repeats never reach a report; the ring keeps them --> FIXED (d9e00eb8ae)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 2
- [WARNING] backInsideThenNewest has no behavioural check --> DEFERRED: measured that the simulator cannot produce the state (a scroll put past the end is put right before the list empties, both arms); stated in the plan
- [WARNING] ScrollBox.view stale after the probe leaves --> FIXED (46808fa598)
- [WARNING] results stale --> FIXED (656ea42425)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 3
- [WARNING] ChatView.swift:2505 - an old probe could clear a new probe's scroll view --> FIXED (f0f31d8ed8, clears only its own)
- [WARNING] ChatView.swift:2441 - Int() traps on NaN in the report --> FIXED (f0f31d8ed8)
- [WARNING] results --> duplicate of iteration 5

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1
- [WARNING] ChatView.swift:829 - the "end" re-set ran even with no direct write --> FIXED (d825f9a4ab)

#### Iteration 9
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0
- [WARNING] a recovery inside KeyboardHold's window could be put back --> DEFERRED: narrow race stated in the plan; KeyboardHold is being reworked in #7645
- [NIT] one wording for "no scroll view" --> FIXED (b05c9ab4de)

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
**Duplicates of prior findings:** 1 (the second silent recovery at 1.5 s, recorded in the plan)
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | LogicTests/room/main.swift:554 | BRANCH | source check named the old call | FIXED | 9cf9035491 |
| 2 | 1 | WARNING | ChatView.swift:794 | BRANCH | repeat recovery under a scroll | FIXED | 9cf9035491 |
| 3 | 1 | WARNING | ChatView.swift:806 | BRANCH | binding kept on a message | FIXED | 9cf9035491 |
| 4 | 2 | WARNING | ChatView.swift:794 | SELF | personScrolling unset on iOS 17 | FIXED | 63d75b3585 |
| 5 | 3 | WARNING | ChatView.swift:794 | SELF | false empty pulls a resting reader | FIXED | 04508ca2f1 |
| 6 | 4 | WARNING | ChatView.swift:2443 | SELF | before-the-top bounce on repeat | FIXED | 2c3debd08c |
| 7 | 4 | WARNING | room/main.swift | SELF | wiring only by source text | FIXED | 2c3debd08c |
| 8 | 5 | WARNING | BoardLogic.swift:449 | SELF | parameter named the opposite case | FIXED | d9e00eb8ae |
| 9 | 6 | WARNING | ChatView.swift:821 | SELF | clamp path unexercised | DEFERRED | the simulator cannot produce the state (measured) |
| 10 | 6 | WARNING | ChatView.swift:2505 | SELF | stale scroll view | FIXED | 46808fa598 |
| 11 | 7 | WARNING | ChatView.swift:2505 | SELF | old probe clears new probe's view | FIXED | f0f31d8ed8 |
| 12 | 7 | WARNING | ChatView.swift:2441 | SELF | NaN trap in the report | FIXED | f0f31d8ed8 |
| 13 | 8 | WARNING | ChatView.swift:829 | SELF | "end" re-set without a write | FIXED | d825f9a4ab |
| 14 | 9 | WARNING | ChatView.swift:827 | BRANCH | recovery inside KeyboardHold's window | DEFERRED | narrow race, stated; #7645 reworks the hold |

### NITs (non-blocking, across all iterations)
- an enum for the place words instead of strings (iterations 5, 7, 9); comment wraps (7); the dead "before the top" arm of the
  first recovery (5, documented); RowTops-style growth notes (n/a here)

### Strengths (across all iterations)
- the decisions are pure Board functions (scrollPlace, emptyRecovery) with checks on both tolerance edges and a check tying
  scrollPlace's words to emptyRecovery's (every iteration from 4)
- the report measures the scroll instead of counting onAppear, and says what the row count is (every iteration)
- a later recovery acts only past the end with nobody scrolling, on every iOS (iterations 4 to 10)
- the plan records the simulator experiment that weakened its own leading reading (iterations 7 to 10)
