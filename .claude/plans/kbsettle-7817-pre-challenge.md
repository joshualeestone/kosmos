---
pre_challenge: true
method: challenge-loop
branch: kbsettle-7817
diff_hash: 4c964df4df0ca75fdeda4fa3bc78bf1813b3dcca72468cf7d75f73d38da75361
validation: not run in full (iOS-only diff; heavy runs held on this Mac during Josh's talk); focused checks passed, CI runs everything
subdir_audit: passed
timestamp: 2026-11-03T16:17:48Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No (stopped at the 8-round cap, Splinter's 10-31 rule: no BLOCKER open; the leftover is on #7817)
**Total findings:** 30 (0 BLOCKERs, 26 WARNINGs, 4 CONVENTIONs, plus NITs)
**Fixed:** 19 | **Deferred:** 11 | **Asked (awaiting user):** 0

Validation: Release and Debug typecheck clean; every iOS LogicTests suite green after the rebase onto main (room 776/776,
run.sh 1871/1871, agentinfo 117, files 99, the rest green); server.ios-routes-6838 5/5. The full validation helper was
not run: the diff is iOS only (none of its suites run Swift), and the Mac had just been at load 99 with heavy runs held
while Josh was on stage. CI's logic, simulator build and ui jobs run on the PR.

Shipped while the loop ran (Josh was hitting the blank live): TestFlight build 31 from 030592f19b (iteration 0
design), build 32 from db354c668f (after iteration 5). The merged head is build 33's.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 4 WARNINGs
**Self-generated:** 0
- [WARNING] the delayed scroll had no finger check --> FIXED
- [WARNING] a second will-show in the burst could drop keep-the-newest --> FIXED (carry-over; later replaced)
- [WARNING] the "past the end" premise --> DEFERRED: the 09:27 diagnostic printed it
- [WARNING] personScrolling "from the app's own scroll" unproven --> FIXED (claim deleted)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 4 WARNINGs
**Self-generated:** 3
- [WARNING] carry-over outlived the burst --> FIXED (kbSettlePending; later removed)
- [WARNING] diagKeyboard reset unreliable --> FIXED (no longer read)
- [WARNING] scroll ran after a hide in the wait --> FIXED (will-hide cancels)
- [WARNING] source checks pin text --> DEFERRED: house pattern

#### Iteration 3
**Reviewer model:** opus
**New findings:** 3 WARNINGs
**Self-generated:** 3
- [WARNING] the wait fought KeyboardHold; drag window; will-hide/will-show pairs --> FIXED by redesign: keyboard scroll as on main, add only a settled put-back

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 4 WARNINGs
**Self-generated:** 2
- [WARNING] a blank "within" leaves no record --> FIXED (settled place recorded)
- [WARNING] no listEpoch guard --> FIXED
- [WARNING] atBottom not read; stale keep --> DEFERRED: acts only past the end

#### Iteration 5
**Reviewer model:** opus
**New findings:** 3 WARNINGs
**Self-generated:** 2
- [WARNING] keepNewestInView could switch the fix off --> FIXED (asked on every did-show, keep not read)
- [WARNING] a finger at the one look stood down silently and for good --> FIXED (recorded; looks again)
- [WARNING] no runtime test --> DEFERRED: stated gap (a Debug switch would drive it)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 3 WARNINGs
**Self-generated:** 2
- [WARNING] no "end" put back in the anchor after the direct write --> FIXED (as recoverEmpty)
- [WARNING] "within" no longer recorded --> FIXED (within with nothing drawn)
- [WARNING] a reader not at the newest but past the end is moved --> DEFERRED: past the end is nobody's place (on the card)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 2 WARNINGs, 2 CONVENTIONs
**Self-generated:** 2
- [WARNING] one look only; a later move is missed --> FIXED (looks at 0.3 s and 1.2 s)
- [WARNING] a fling past 0.6 s --> FIXED (the 1.2 s look)
- [CONVENTION] comment said "a search is open" --> FIXED ("typed")
- [CONVENTION] "Finished looks like" described build 31 --> FIXED

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 1 WARNING (plus duplicates)
**Self-generated:** 1
- [WARNING] the 1.2 s look lands inside KeyboardHold's 1.5 s window; a transient write past an estimated end would move a held reader to the newest --> DEFERRED at the cap, on #7817 (mitigations named: skip while the hold guards, or require two past-the-end looks)
- duplicates: no runtime test; search open with nothing typed (deliberate: a blank there is a blank)

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | ChatView.swift did-show | BRANCH | no finger check in the delay | FIXED | iteration 1 |
| 2 | 1 | WARNING | ChatView.swift will-show | BRANCH | burst drops keep | FIXED | redesigned at 3 |
| 3 | 2 | WARNING | ChatView.swift will-show | SELF | carry-over outlives burst | FIXED | removed at 3 |
| 4 | 2 | WARNING | ChatView.swift will-hide | BRANCH | scroll after hide | FIXED | will-hide cancels |
| 5 | 3 | WARNING | ChatView.swift did-show | SELF | wait fights KeyboardHold | FIXED | redesign |
| 6 | 4 | WARNING | settledPutBack | SELF | within leaves no record | FIXED | recorded |
| 7 | 4 | WARNING | settledPutBack | SELF | no listEpoch guard | FIXED | guard |
| 8 | 5 | WARNING | did-show | SELF | keep could switch it off | FIXED | keep not read |
| 9 | 5 | WARNING | settledPutBack | SELF | finger stands down for good | FIXED | second look |
| 10 | 5 | WARNING | tests | BRANCH | no runtime test | DEFERRED | stated gap |
| 11 | 6 | WARNING | settledPutBack | SELF | anchor not reset | FIXED | as recoverEmpty |
| 12 | 6 | WARNING | settledPutBack | SELF | within not recorded | FIXED | nothing-drawn line |
| 13 | 7 | WARNING | settledPutBack | SELF | one look only | FIXED | 0.3 s and 1.2 s |
| 14 | 8 | WARNING | settledPutBack | SELF | 1.2 s look inside KeyboardHold window | DEFERRED | cap; on #7817 |

### NITs
- "keyboard settled: unread" can be recorded before the scroll view is found
- goNewest runs even when backInside wrote nothing (as recoverEmpty's .newest arm)
- the source checks match exact text (house pattern)

### Strengths
- The keyboard-shown scroll is exactly as on main; the change only adds a guarded, cancellable put-back.
- Every skip lives in one guard: same did-show, same chat, same list, on screen, no search typed, no finger.
- The diagnostic records only fixed words (place), inside the #7420 allow-list.
