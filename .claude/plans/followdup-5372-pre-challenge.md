---
pre_challenge: true
method: challenge-loop
branch: followdup-5372
diff_hash: 82b13797473259c5fd06d7404cb755b403c1bb3562d9d4b9c8c93f16b0e1b4aa
validation: passed
subdir_audit: passed
timestamp: 2026-10-06T08:40:47Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes (iteration 6, sonnet: NITs only)
**Total findings:** 13 WARNINGs, 0 BLOCKERs, 0 CONVENTIONs (plus NITs below)
**Fixed:** 10 | **Deferred:** 3 | **Asked (awaiting user):** 0

**Deviations, stated so nobody reads more into this proof than happened:**
- 6.0 and each 6g ran the affected community test files directly (185 to 243 tests per run), not the repo's full
  validation sequence, because the full suite takes a turn on one shared machine queue. The repo helper ran ONCE, at 6j,
  on the converged head 33a5cf36d through queued-heavy: VALRC=0, AUDITRC=0, 15806 tests, 0 failed (03:21 CDT).
- The Origin column was assigned from which commit wrote the cited code, not by running the 6c-bis blame lookup at the
  time. Both SELF findings concerned code, not prose, so 6e's prose rule did not apply to either.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/communityfollow.js entryOf — a long post cut every quoted reply (one shared body cap) --> FIXED (5cc1d71)
- [WARNING] server.js following route — the cached home line (1 h) outlived a Following read --> FIXED (5cc1d71, test with a failed-read control)
- [WARNING] engine/communityfollow.test.js — seen marks leaked between tests (order-dependent pass) --> FIXED (5cc1d71)
- [WARNING] engine/communityhome.js — "0 new posts (or more)" --> FIXED (5cc1d71)
- [WARNING] engine/communityblock.js — the block's reply wording was not tied to its producer --> FIXED (5cc1d71; re-tied to QUOTED_REPLY in 4e223db)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/communityfollow.js groupByPost — relied on the feed's order --> FIXED (d8c43dd, reversed-feed test)
- [WARNING] engine/communityfollow.js noteSeen — read-modify-write race --> DEFERRED: fully synchronous within one process; one board per data dir

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1 of the above
- [WARNING] engine/communityfollow.js entryOf — "Reply by" text inside a quoted body could be forged --> FIXED (4e223db: board-made "[n.m] reply by" headers outside the quote; forged-line test)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs (1 a duplicate of iteration 2), 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] engine/communityfollow.js — replies cut by the cap were marked seen --> DEFERRED: the nudge counts posts only, never replies
- [WARNING] engine/communityhome.js — a whole page already read gives a low count --> FIXED (0283a51, named in the plan's weakest premises)
- [NIT] duplicate feed items --> FIXED anyway (0283a51, test)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/communityfollow.js noteSeen — an entry of replies alone marked its unread post seen --> FIXED (33a5cf3, postShown)
- [WARNING] engine/communityhome-5212.test.js — no test for the above --> FIXED (33a5cf3)
- [WARNING] engine/communityhome.js doneFollowing — refused or discarded comments count as done --> DEFERRED: the same rule as answeredHere (can only read low); in the plan

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/communityfollow.js | BRANCH | long post cuts replies | FIXED | 5cc1d71 |
| 2 | 1 | WARNING | server.js | BRANCH | home cache survives a read | FIXED | 5cc1d71 |
| 3 | 1 | WARNING | engine/communityfollow.test.js | BRANCH | marks leak between tests | FIXED | 5cc1d71 |
| 4 | 1 | WARNING | engine/communityhome.js | BRANCH | "0 (or more)" | FIXED | 5cc1d71 |
| 5 | 1 | WARNING | engine/communityblock.js | BRANCH | block wording untied | FIXED | 5cc1d71, 4e223db |
| 6 | 2 | WARNING | engine/communityfollow.js | BRANCH | feed order trusted | FIXED | d8c43dd |
| 7 | 2 | WARNING | engine/communityfollow.js | BRANCH | noteSeen race | DEFERRED | synchronous, one process |
| 8 | 3 | WARNING | engine/communityfollow.js | SELF | forgeable quoted reply | FIXED | 4e223db |
| 9 | 4 | WARNING | engine/communityfollow.js | BRANCH | cut replies marked seen | DEFERRED | nudge counts posts only |
| 10 | 4 | WARNING | engine/communityhome.js | SELF | low count on a read page | FIXED | 0283a51 |
| 11 | 5 | WARNING | engine/communityfollow.js | BRANCH | reply-only entry marks post seen | FIXED | 33a5cf3 |
| 12 | 5 | WARNING | engine/communityhome-5212.test.js | BRANCH | no test for #11 | FIXED | 33a5cf3 |
| 13 | 5 | WARNING | engine/communityhome.js | BRANCH | refused comments count as done | DEFERRED | as answeredHere; in plan |

### NITs (non-blocking, across all iterations)
- The block's vote paragraph has one short line after the rewrap (iterations 1, 3, 4, 5)
- Inline requires in seenFile/noteSeen (iterations 4, 5, 6)
- noteSeen runs before the response is delivered (iteration 6)
- Worst-case entry size: bounded by the caps, 1500 plus 3 x 1000 per entry (iteration 6)
- More replies than shown are counted as "(N more replies not shown)" (taken, iteration 3)

### Strengths (across all iterations)
- Every fix has a test that went red when the fix was perturbed: grouping, exclusion, cache drop, cap, ordering, header outside the quote, dedupe, postShown
- Controls for other agents' reads and comments, and a failed-read control for the cache drop
- Failure handling only ever makes a nudge repeat, never hides an unread post
