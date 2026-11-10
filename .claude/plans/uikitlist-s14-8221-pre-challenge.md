---
pre_challenge: true
method: challenge-loop
branch: uikitlist-s14-8221
diff_hash: 9dc664c01164868235f64ad2d96d652d812f5a1550704cdf5e4eb9f5f38ddb81
validation: passed
subdir_audit: passed
timestamp: 2026-11-10T10:48:14Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No (stopped at the standing 8-round review cap, Splinter 2026-10-31: "cap 8 rounds unless a BLOCKER is open; leftovers go on a card"; no BLOCKER was open)
**Total findings:** 30 (0 BLOCKERs, 22 WARNINGs, 1 CONVENTION, 7 NITs counted as actionable-adjacent below)
**Fixed:** 12 | **Deferred:** 11 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] ios/KosmosUITests/EarlierDroppedUITests.swift:104 — control never proves the drop happened --> FIXED (2f5f749)
- [WARNING] ios/Kosmos/ChatList.swift:870 — offset written during a fling that carries on --> FIXED (2f5f749, fling stopped first as toNewest does)
- [WARNING] ios/KosmosUITests/EarlierDroppedUITests.swift:1 — only the moved page path is tested --> FIXED (2f5f749, plan Coverage section says the rest is reasoned)
- [NIT] ChatList.swift:874 — heldByFocus left set (fixed)
- [NIT] EarlierDroppedUITests.swift:3 — header overstated the displacement (fixed)
- [NIT] BoardClient.swift:1130 — counter is per launch (comment fixed)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] ios/Kosmos/ChatList.swift:870 — anchor == nil is wider than "every row on screen dropped" --> FIXED (a99b30d)
- [WARNING] ios/Kosmos/ChatView.swift:1914 — restartEarlier counts only rows-to-none --> DEFERRED: correct by design, only that transition can leave a reader with no row
- [WARNING] EarlierDroppedUITests.swift:48 — "Message 6" BEGINSWITH is loose --> DEFERRED: copies EarlierPagesUITests, the drag loop that follows covers it
- [WARNING] EarlierDroppedUITests.swift:76 — wall-clock window --> DEFERRED: 8 s before the re-asked page lands, "raise the delay" CONTROL names a slow runner
- [NIT] ChatList.swift:871 — shared helper with the earlier-failed branch
- [NIT] ChatList.swift:790 — optional dropped param (kept: makeUIView's first apply passes none)
- [NIT] BoardClient.swift:1530 — Swift 6 isolation of the Debug counter

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the re-ask comment, written in iteration 1)
- [WARNING] ios/Kosmos/ChatList.swift:870 — a reader already at the top is not re-asked (atTop does not change) --> FIXED (5809c16), later REMOVED in iteration 7 (no check could show it did anything)
- [WARNING] EarlierDroppedUITests.swift:56 — at-top reader not covered --> FIXED (5809c16), later removed with the above
- [NIT] ChatList.swift:877 — finger policy differs from toNewest (comment fixed)
- [NIT] BoardClient.swift:1531 — counter comment placement (fixed in iteration 5)
- [NIT] EarlierDroppedUITests.swift:59 — "near" naming

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings (confirmed resolved):** 1
- [WARNING] ios/Kosmos/ChatList.swift:870 — a status row (failed line) on screen would count as staying --> DEFERRED: every drop path clears the failure in the same update (retryEarlier and resetEarlier set because nil), and the loading line is an overlay, not a row
- [NIT] ChatList.swift:889 — double true report (since removed)
- [NIT] EarlierDroppedUITests.swift:79 — fixed sleeps
- [NIT] BoardClient.swift:1130 — counter coupling

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs; plus 1 synthetic from the UI run
**Self-generated:** 1 of the above (the absence check, written in iteration 1)
- [WARNING] EarlierDroppedUITests.swift:84 — absence of first-page rows never shown able to fail --> FIXED (c4a02fb, presence asserted before the drop)
- [WARNING] .claude/plans/uikitlist-s14-8221.md — Results stale --> FIXED (c4a02fb)
- [WARNING] (UI run 03:06) the at-top fix-off control failed: the page was asked for again anyway --> FIXED (c4a02fb, control removed, recorded in the plan)
- [NIT] BoardClient.swift:1530 — counter above the wrong comment (fixed)
- [NIT] EarlierDroppedUITests.swift:109 — Message 41 holds either way at top (comment fixed)
- [NIT] EarlierDroppedUITests.swift:4 — displacement wording

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs; plus 1 synthetic from the UI run
**Self-generated:** 1 (the presence precondition, written in iteration 5)
**Duplicates of prior findings:** 2 (timing; restartEarlier rule)
- [WARNING] (UI run 03:4x) the presence precondition failed for a reader at the first page's very top --> FIXED (1ec53d7), then the at-top check removed in iteration 7

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 2 of the above (both on iteration 3 code)
- [WARNING] EarlierDroppedUITests.swift:402 — at-top check cannot fail on the defect --> FIXED (c00e4c3, removed)
- [WARNING] ios/Kosmos/ChatList.swift:890 — the re-tell has no measured effect --> FIXED (c00e4c3, removed: the claim deleted, not rewritten)
- [CONVENTION] plan — only the moved page path measured --> DEFERRED: duplicate of iteration 1, stated in the plan
- [NIT] ChatView.swift:213 / ChatList.swift:17 — comments left out the moved gap fill (fixed)
- [NIT] EarlierDroppedUITests.swift:340 — "Message 6" naming
- [NIT] BoardClient.swift:1531 — counter coupling

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings:** 2 (status rows; timing)
- [WARNING] ios/Kosmos/ChatList.swift:870 — the dropped bump is consumed even if the rows change a later update --> DEFERRED: every bump site changes earlier (and, on delete, thread) in the same synchronous block, verified at ChatView's delete handler, so ids and dropped reach one updateUIView; no async gap
- [NIT] BoardClient.swift:1127 — Swift 6 isolation
- [NIT] ChatList.swift:885 — readTop after the write may ask (intended)
**Stopped at the 8-round cap** with no BLOCKER open.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | EarlierDroppedUITests.swift:104 | BRANCH | control does not prove the drop | FIXED | 2f5f749 |
| 2 | 1 | WARNING | ChatList.swift:870 | BRANCH | offset written during a fling | FIXED | 2f5f749 |
| 3 | 1 | WARNING | EarlierDroppedUITests.swift:1 | BRANCH | three drop paths untested | FIXED | 2f5f749 (plan) |
| 4 | 2 | WARNING | ChatList.swift:870 | BRANCH | anchor nil wider than intended | FIXED | a99b30d |
| 5 | 2 | WARNING | ChatView.swift:1914 | BRANCH | rows-to-none rule | DEFERRED | by design |
| 6 | 2 | WARNING | EarlierDroppedUITests.swift:48 | BRANCH | loose near anchor | DEFERRED | sibling pattern |
| 7 | 2 | WARNING | EarlierDroppedUITests.swift:76 | BRANCH | timing window | DEFERRED | named CONTROL |
| 8 | 3 | WARNING | ChatList.swift:870 | SELF | at-top reader not re-asked | FIXED then removed | 5809c16, c00e4c3 |
| 9 | 3 | WARNING | EarlierDroppedUITests.swift:56 | BRANCH | at-top case untested | FIXED then removed | 5809c16, c00e4c3 |
| 10 | 4 | WARNING | ChatList.swift:870 | BRANCH | status row counts as staying | DEFERRED | cleared in same update |
| 11 | 5 | WARNING | EarlierDroppedUITests.swift:84 | SELF | absence never shown able to fail | FIXED | c4a02fb |
| 12 | 5 | WARNING | plan | BRANCH | results stale | FIXED | c4a02fb |
| 13 | 5 | WARNING | UI run 03:06 | BRANCH | at-top control cannot fail | FIXED | c4a02fb |
| 14 | 6 | WARNING | UI run 03:4x | SELF | presence precondition fails at top | FIXED | 1ec53d7 |
| 15 | 7 | WARNING | EarlierDroppedUITests.swift:402 | SELF | at-top check cannot fail | FIXED | c00e4c3 |
| 16 | 7 | WARNING | ChatList.swift:890 | SELF | re-tell unmeasured | FIXED | c00e4c3 (deleted) |
| 17 | 7 | CONVENTION | plan | BRANCH | moved page path only measured | DEFERRED | stated in plan |
| 18 | 8 | WARNING | ChatList.swift:870 | BRANCH | bump consumed early | DEFERRED | same synchronous block |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- Shared helper for the two put-at-top writes (iteration 2)
- Swift 6 isolation of the Debug counter sampleOlderAsks (iterations 2, 8)
- "Message 6" BEGINSWITH naming (iterations 2, 3, 7)
- Fixed sleeps against the 8 s sample delay (iterations 4, 8)

### Strengths (across all iterations)
- The branch runs only when pages were dropped since the last update, the reader is not at the newest, and no row on screen stays; a reader with a surviving row is held exactly as before (every iteration)
- One helper (restartEarlier) counts every drop, at all four reset sites (iterations 1, 3, 5)
- Debug hooks stay out of release; Release and Debug typechecks clean (every iteration)
- A fix-off control on the same path, with CONTROL preconditions that name their arm (iterations 3, 5, 7)
