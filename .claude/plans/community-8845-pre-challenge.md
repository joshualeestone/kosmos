---
pre_challenge: true
method: challenge-loop
branch: community-8845
diff_hash: a1de4ddca8c864320602927f624a3bbe688aea4a0808b35919aa304348673fd0
validation: passed (Mortals, mortals-validate.sh, status clean, 30352 node tests 0 failed, 4 shell shards passed)
subdir_audit: passed (no subdirectory CLAUDE.md changed)
timestamp: 2026-11-21T00:20:45Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped at the 8-round cap (standing usage rule, Splinter 2026-10-22 11:08, Josh told: "cap at 8 rounds; past 8, continue only while a BLOCKER is open"). No BLOCKER was open at round 8. Round 8's one WARNING was fixed in d18d2a0b64 and has NOT been seen by a blind round; it is guarded by tests (the three-status order and no opt-out before "If it went out").
**Total findings:** 12 actionable (0 BLOCKERs, 9 WARNINGs, 3 CONVENTIONs) plus NITs
**Fixed:** 10 | **Deferred:** 2 | **Asked (awaiting user):** 0

Validation note: per my standing practice (full validation once, at convergence), each round re-ran the community suites (1,409 to 1,440 tests, 0 failed) and the tree guards, and the full suite ran once on Mortals at d18d2a0b64.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/communityread.js:381 - mark covers only the Following feed; other reply surfaces unmarked --> FIXED (scope stated in plan, d4ba013f1e; home already excludes answered comments via answeredHere)
- [NIT] engine/communityturn.js:93 - "today" vs "last 24 hours" (kept: #5297 pins the block's words)
- [NIT] plan's measured "fails on main" claim is unguarded
- [NIT] test writes commentsSentFile by hand

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 2 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/communityread.js:398 - nested replies ([1.2], [r1.1]) never marked --> FIXED (6810a9fbc9)
- [WARNING] engine/communityread.js:410 - commentNote silent for a list of replies alone --> FIXED (6810a9fbc9)
- [WARNING] engine/communityturn.js:89 - "daily post is done" false for a held or refused post --> FIXED (6810a9fbc9)
- [CONVENTION] engine/communityfollow.js:627 - stale "replies are skipped" comment --> FIXED (6810a9fbc9)
- [CONVENTION] engine/communityread.js:372 - markCommented docstring omits `answered` --> FIXED (6810a9fbc9)
- [NIT] communitynudge.js:296 - line names a fixed set of three counts (taken)
- [NIT] tests bypass readFollowing (became iteration 4's WARNING)

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the TURN_TEXT wording written in iteration 2)
- [WARNING] engine/communityturn.js:90 - opening awkward, parenthetical interrupts --> FIXED (6775a4e560)
- [NIT] test title contradicted its assertion (fixed); long comment line (fixed); duplicate mark harmless

#### Iteration 4
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above
- [WARNING] engine/communityturn.js:90 - "optional" stated before its condition --> FIXED (2bc598ba60)
- [WARNING] engine/community-8845.test.js:47 - item-1 tests bypass the real Following path --> FIXED (2bc598ba60: end-to-end readFollowing test in communityfollow.test.js, fails with main's files)
- [NIT] "today" in a rolling-count comment (narrowed); honest-post sentence (kept, pinned); FLOOR control label (reworded); commentNote looseness (noted)

#### Iteration 5
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] engine/communityturn.js:90 - the same post named twice --> FIXED (34d9d0bf7c)

#### Iteration 6
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above
- [WARNING] engine/communityturn.js:91 - no instruction for a refused post --> FIXED (cbe4a1eb6c)
- [NIT] "post for the day" assumes a floor of one --> FIXED (test pins FLOORS.postsPerDayMin to 1)
- [NIT] narrow doesNotMatch assertion --> FIXED (replaced); counts line "shown to whom" --> FIXED; answerOf hoisted --> FIXED

#### Iteration 7
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/communityread.js:403 - nested marking applies beyond labelled entries --> DEFERRED: only communityfollow.entryOf builds such a list; marking an answered reply wherever listed is intended (plan note, de6206b7ca)

#### Iteration 8
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the refused clause from iteration 6)
- [WARNING] engine/communityturn.js:95 - the closing opt-out cancels "still owed" for a refused post --> FIXED (d18d2a0b64: one instruction per status, opt-out only after "If it went out"; order and no-opt-out asserted). Not reviewed by a further blind round (cap).
- [NIT] held post fits neither branch --> FIXED (held: "with your person and nothing more is needed")
- [NIT] counts line hard to read --> FIXED (reviewer's wording taken)
- [NIT] commentNote counts id-less replies (noted, no effect: entryOf validates ids)

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/communityread.js:381 | BRANCH | scope beyond Following feed | FIXED | d4ba013f1e (plan) |
| 2 | 2 | WARNING | engine/communityread.js:398 | BRANCH | nested replies unmarked | FIXED | 6810a9fbc9 |
| 3 | 2 | WARNING | engine/communityread.js:410 | BRANCH | commentNote silent for replies | FIXED | 6810a9fbc9 |
| 4 | 2 | WARNING | engine/communityturn.js:89 | BRANCH | "post done" false when held/refused | FIXED | 6810a9fbc9 |
| 5 | 2 | CONVENTION | engine/communityfollow.js:627 | BRANCH | stale comment | FIXED | 6810a9fbc9 |
| 6 | 2 | CONVENTION | engine/communityread.js:372 | BRANCH | docstring | FIXED | 6810a9fbc9 |
| 7 | 3 | WARNING | engine/communityturn.js:90 | SELF | awkward opening | FIXED | 6775a4e560 |
| 8 | 4 | WARNING | engine/communityturn.js:90 | SELF | claim before condition | FIXED | 2bc598ba60 |
| 9 | 4 | WARNING | engine/community-8845.test.js:47 | BRANCH | no end-to-end test | FIXED | 2bc598ba60 |
| 10 | 5 | WARNING | engine/communityturn.js:90 | SELF | post named twice | FIXED | 34d9d0bf7c |
| 11 | 6 | WARNING | engine/communityturn.js:91 | SELF | refused case unhandled | FIXED | cbe4a1eb6c |
| 12 | 7 | WARNING | engine/communityread.js:403 | BRANCH | marking wider than labelled | DEFERRED | intended; plan note |
| 13 | 8 | WARNING | engine/communityturn.js:95 | SELF | opt-out cancels "owed" | FIXED | d18d2a0b64 (unreviewed by a later round) |

### NITs (non-blocking, across all iterations)
- [NIT] engine/communityturn.js - "learned today counts" kept: the block's own words, pinned by #5297 item 3 (iterations 1, 4, 7)
- [NIT] engine/community-8845.test.js - writes the sent-state file by hand (iteration 1)
- [NIT] engine/communityread.js - commentNote counts a replies list even with id-less replies; entryOf validates ids (iterations 4, 8)

### Strengths (across all iterations)
- The answered mark reuses COMMENT_THERE / COMMENT_GONE, so a new state can only over-warn (every round)
- #7886 review 8 still holds: a --reply-to answer never marks the post (asserted at both levels)
- Every test has a control; the end-to-end readFollowing test fails with main's files (iteration 4 onward)
- No em or en dashes in product copy, asserted by the tests
