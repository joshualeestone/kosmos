---
pre_challenge: true
method: challenge-loop
branch: room-scroll-repin
diff_hash: e15a6a76f5ce579ce8695dc01276593acb2776e7d5b95179a73284f16bd0267f
validation: passed
subdir_audit: passed
timestamp: 2026-09-16T23:14:45Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes
**Total findings:** 5 (2 BLOCKERs, 1 WARNING, 1 CONVENTION-adjacent plan-mismatch (BLOCKER-classed), 1 NIT), plus 1 validation-caught regression
**Fixed:** all | **Deferred:** 0 | **Asked:** 0

The fix evolved under review + validation: exact-match guard (broken) -> `__wasOnFloor`-only
(regressed the unit stub) -> directional `scrollTop < pinnedAt` (dead zone) -> the shipped
TWO-SIGNAL guard `__wasOnFloor === false || scrollTop < pinnedAt`. Each step was driven by a real
finding, not churn.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**Reviewed:** the initial `__wasOnFloor`-only fix.
**Self-generated:** 0.
- The parallel VALIDATION (not the reviewer) caught the load-bearing regression: `__wasOnFloor`-only
  FAILED web.room-scroll.test.js's moved-reader control (the unit stub drives scrollTop directly and
  fires no scroll event, so `__wasOnFloor` is never updated there). Fixed by moving to a directional
  `scrollTop < pinnedAt` guard (keeps pinnedAt). The reviewer's own [WARNING] (a comment referencing
  a removed pinnedAt) was mooted by that same change, which keeps pinnedAt.

#### Iteration 2
**Reviewer model:** sonnet (different model)
**Reviewed:** the directional `scrollTop < pinnedAt` fix.
**Self-generated:** 0.
- [BLOCKER] the directional guard has a DEAD ZONE: once the ResizeObserver advances scrollTop past
  the stale pinnedAt (measured 5261 -> 5645), a reader scrolling up by less than that 384px still
  sits >= pinnedAt, so again() would yank them down (#3066/#1926) --> FIXED: two-signal guard adds
  `__wasOnFloor === false`, which catches a scroll-away of any size vs the CURRENT floor.
- [BLOCKER] plan/code mismatch: the plan still described the abandoned `__wasOnFloor`-only approach
  ("pinnedAt removed") --> FIXED: plan rewritten to the two-signal guard, recording both abandoned
  attempts and why each failed.
- [WARNING] neither oracle covered the dead zone --> FIXED: added web.room-scroll.test.js arm "a
  reader who scrolled up INSIDE the RO-advanced dead zone", proven red-capable (fails directional-
  only, passes two-signal).
- [NIT] the comment's "the floor only grows" was too absolute --> FIXED (comment rewritten).

#### Iteration 3
**Reviewer model:** opus
**Reviewed:** the two-signal guard.
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT (5 STRENGTHs).
**Self-generated:** 0
**Converged** - the guard is correct in every traced case (a-f), per-clause coverage is complete and
red-capable, the spurious-`__wasOnFloor` race does not manifest (frame-coalesced scroll events, gap
0), comment + plan accurate.
- [NIT] the new unit arm distinguishes the fix only from the directional-only variant, not the
  original exact-match #1147 (the browser oracle is that sentinel) --> INCORPORATED: added a scope
  note to the arm.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status |
|---|------|----------|-----------|--------|-------------|--------|
| 0 | 1 | BLOCKER (validation) | web.room-scroll.test.js | BRANCH | __wasOnFloor-only regressed the moved-reader control (stub fires no scroll event) | FIXED (directional, then two-signal) |
| 1 | 2 | BLOCKER | web/index.html again() | BRANCH | directional guard dead zone (RO-advanced scrollTop) | FIXED (two-signal) |
| 2 | 2 | BLOCKER | .claude/plans/room-scroll-repin.md | BRANCH | plan described abandoned single-signal approach | FIXED (rewritten) |
| 3 | 2 | WARNING | oracles | BRANCH | dead zone uncovered by either oracle | FIXED (new red-capable arm) |
| 4 | 2 | NIT | web/index.html | BRANCH | "floor only grows" too absolute | FIXED |
| 5 | 3 | NIT | web.room-scroll.test.js | BRANCH | arm scope note vs original #1147 | INCORPORATED |

### Outstanding questions (ASKED)
None.

### Strengths (across iterations)
- Root cause measured, not guessed: instrumented both re-pin guards, captured the 5261->5645 RO
  follow, ruled out the few-px tail-nub hypothesis and a fixed-tolerance band-aid.
- Two-signal guard correct in every traced case; hidden-box TOP-drag protection (`!clientHeight`)
  intact; agent thread safe (pinToBottom self-seeds __wasOnFloor).
- Per-clause test coverage, each control proven red-capable; the browser oracle (untouched) is the
  #1147 sentinel and stays red-capable (proven red pre-fix).
- Does not touch Josh's #3130 redesign markup.
