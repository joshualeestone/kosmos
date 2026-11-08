---
pre_challenge: true
method: challenge-loop
branch: haptics-8246
diff_hash: 50e7943b3c40d5aa518424e0c5bb489d7e97f4d8193d7340dfb6c6c546883a34
validation: passed
subdir_audit: passed
timestamp: 2026-11-08T16:24:29Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (the cap). Round 8 found no blocker. Its W1 (an in-place agent change with two empty failed sets
could leave the first failure silent) was fixed after the round with a reseed on `agent.session` (no buzz in either
order) and a comment; its W2 (SignInModel's counting and Returned.refused have no running test) is deferred: they live
in files the logic suites do not compile, and the real-iPhone check covers them.
**Converged:** Yes, on round 8.
**Total findings:** 2 BLOCKERs, 22 WARNINGs, 1 CONVENTION, many NITs
**Fixed:** 2 BLOCKERs, 21 WARNINGs | **Deferred:** 1 WARNING | **Asked:** 0

Validation: full validation_log_run_or_skip PASSED on the rebased head (hash 50e7943b3c40). Every round: Debug (and
from round 4 Release) simulator builds; all 13 ios/LogicTests suites (main 2129, room 846 at the end).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 6 WARNINGs
- star clicked from the long-press menu too --> FIXED (swipe only)
- Allow/Deny tap fired on press, before the answer went --> FIXED (only on .sent)
- tap then buzz on a failed send --> DEFERRED as a recorded decision (card asks both)
- plan's "RoomStore.post returns nothing" was false --> FIXED (room buzzes on handed-back words)
- same sign-in refusal twice buzzed once --> FIXED (failures counter)
- Mac's denial did not buzz --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs
- denial counted twice --> FIXED; unsure room post buzzed --> FIXED (Returned.refused); denial plus error --> not possible (no message on a denial)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs
- [BLOCKER] chat send failures never buzzed (post returns true once sent) --> FIXED (Board.failedPendingIDs watch, tested)
- denial counted on the provisional asking:true --> FIXED (counts .denied(asking: false))

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 2 WARNINGs
- [BLOCKER] the failed-send watch sat inside #if DEBUG (Release never buzzed) --> FIXED, guarded in the room suite (control fails on the old commit)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 5 WARNINGs
- buzz from a chat not on screen --> FIXED (visible gate); reuse across agents --> FIXED; tryAgain refusal silent --> FIXED; star pin defeatable by a default --> FIXED; DEBUG guard narrow --> FIXED (every Haptics line in five files, with a control)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs
- agent-change race --> FIXED (failedSeenFor); guard missed #if !DEBUG's #else --> FIXED (control added)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs
- Not sent (keptUndelivered with failedWords) never buzzed --> FIXED, tested; room buzz not gated on visible --> FIXED

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs
- in-place agent change with empty sets --> FIXED after the round (reseed on agent.session)
- SignInModel counting and Returned.refused untested --> DEFERRED (device check)
**Converged** on the cap round.

### NITs left
- generators are not prepare()d (a first tap after idle may lag slightly; judge on a phone)
- `#if DEBUG || X` reads as DEBUG-only in the guard (safe direction)

### Strengths
- One @MainActor Haptics enum; nothing on incoming messages, scrolling or typing; pick 2 not built
- Allow/Deny tap only on a sure send; failures buzz once each; Release placement guarded by a test with a control
