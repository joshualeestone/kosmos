---
pre_challenge: true
method: challenge-loop
branch: repliesall-7811
diff_hash: d53eaa1079625bfe69da5116c1573a1231025b9045a694c9988f6ad48f9fffca
validation: passed
subdir_audit: passed
timestamp: 2026-11-03T00:57:30Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** Yes, under the 8-round rule: round 8 raised no BLOCKER; its four WARNINGs were recorded on kosmos#7811 as follow-ups, and two of its comment findings were fixed in prose only (6d3b2f2cd, no round after).
**Total findings:** 1 BLOCKER, 29 WARNINGs, 1 CONVENTION, plus NITs
**Fixed:** 24 | **Deferred:** 7 | **Asked (awaiting user):** 0

Disclosure: step 6.0's baseline was not run before round 1. The read's test files (repliesall-7811, communityread, communityread-company-7543, communityreply-4833, replynudge-4951, communityblock, communitystatus, familycontact-6239, kidcommunity-6862, caches.fsync-5434, communitysend-why-5435, server.community-read-4373, server.community-read-soon-5636, server.community-home-5212, engine.reachable, fixture-discipline) ran after every fix, last 440/440, and each new rule was perturbed. Untested, disclosed: two own-items-as-seen guards (an unfinished thread, a budget-cut older page) and the older round's catch; no test reaches them. The whole node suite ran as the closing gate on this HEAD: 26543 tests, 26136 pass, 0 fail, 407 skipped.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 8 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 0 of the above (no loop commit existed yet)
- [WARNING] engine/communityread.js:719 - held or saved-place older posts never re-taken --> FIXED (460c0621a)
- [WARNING] engine/communityread.js:719 - the agent's own reply kept a post active forever --> FIXED (460c0621a, later reworked)
- [WARNING] engine/communityread.js:913 - a profile that never answers held the nudge forever --> FIXED (460c0621a, FRESH_DOWN_PASSES)
- [WARNING] engine/communityread.js:686 - PROFILE_CAP too small for the profile --> FIXED (460c0621a)
- [WARNING] engine/communityread.js:1085 - profile read serial with round 1 broke the 30 s budget --> FIXED (460c0621a, parallel)
- [WARNING] engine/communityread.js:1086 - claimed the count and read never differ --> FIXED (460c0621a, reworded)
- [WARNING] engine/communityread.js:486, 511 - docs still said newest 10, 40 requests --> FIXED (460c0621a)
- [WARNING] engine/repliesall-7811.test.js:122 - coverage gaps --> FIXED (460c0621a)
- [CONVENTION] plan claimed same sets --> FIXED (460c0621a)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 6 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 4 of the above
- [WARNING] engine/communityread.js:1124 - the 1.5 s gate timed ten parallel reads and tripped every time (SELF) --> FIXED (49576c47a, gate on the profile alone)
- [WARNING] engine/communityread.js:1124 - gate trip left the count and read on different sets (SELF) --> FIXED (49576c47a docs; 5944cb024 code)
- [WARNING] engine/communityread.js:692 - skipping own replies could hide a person's earlier comment (SELF) --> FIXED (49576c47a, own items kept as seen instead)
- [WARNING] engine/communityread.js:1342 - budget comment understated (SELF) --> FIXED (49576c47a)
- [WARNING] engine/communityread.js:1343 - the unlisted line every read --> DEFERRED: a plain statement of coverage; reworded in 5944cb024
- [WARNING] engine/repliesall-7811.test.js:1 - untested paths --> FIXED (49576c47a, 6bf9f41e2)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 5 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 3 of the above
- [BLOCKER] engine/communityread.js:1420 - own items kept as seen stranded replies the cap held back on an older post (SELF, reproduced by the reviewer's probe) --> FIXED (6bf9f41e2, not on a cap-cut post; the probe is a test)
- [WARNING] engine/communityread.js:726 - promised posts forever (SELF) --> FIXED (6bf9f41e2, MARK_HOLD_MAX)
- [WARNING] engine/communityread.js:1372 - unread active older posts had no floor --> FIXED (6bf9f41e2)
- [WARNING] engine/communityread.js:817 - budget left out the self refresh --> FIXED (6bf9f41e2, stated)
- [WARNING] engine/communityread.js:876 - pace claim --> FIXED (6bf9f41e2)
- [WARNING] engine/repliesall-7811.test.js:1 - 429 and no-name untested --> FIXED (6bf9f41e2)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above
- [WARNING] engine/communityread.js:1128 - an always-slow profile never reads older posts --> DEFERRED: stated as a limit in the plan; the line no longer promises a quick retry (b1201ec78)
- [WARNING] engine/communityread.js:818 - budget comment (SELF) --> FIXED (b1201ec78, says the refresh can pass 30 s as before)
- [WARNING] engine/communityread.js:1428 - own replies take older slots once each --> DEFERRED: bounded; stated in the plan

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 7 NITs
**Self-generated:** 2 of the above
- [WARNING] engine/communityread.js:933 - the count had no slow gate (SELF) --> FIXED (c1836afe4)
- [WARNING] engine/communityread.js:1433 - own-as-seen on a post with older comments unread (SELF) --> FIXED (c1836afe4, untested, disclosed)
- [WARNING] engine/communityread.js:726 - saved-place arm untested --> FIXED (c1836afe4)
- [WARNING] engine/repliesall-7811.test.js:298 - no-name test weak --> FIXED (c1836afe4)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 2 of the above
- [WARNING] engine/communityread.js:696 - duplicate within older posts --> FIXED (badb33a20, tested)
- [WARNING] engine/communityread.js:1147 - a throw in the older round lost the whole read (SELF) --> FIXED (badb33a20, catch; untested, disclosed)
- [WARNING] engine/communityread.js:1442 - own-as-seen on a post with unfinished threads (SELF) --> FIXED (badb33a20, untested, disclosed)
- [WARNING] engine/communityread.js:1364 - slow profile with nothing active said nothing --> DEFERRED: a profile that answered with nothing new did check the older posts; saying "not checked" would be false

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 2 of the above
- [WARNING] engine/communityread.js:941 - a slow profile dropped the count to newest-only at once, against review 10's rule (SELF) --> FIXED (5944cb024, as a failure through downOnce; perturbed)
- [WARNING] engine/communityread.js:1448 - own-seen guards untested --> DEFERRED: disclosed; needs a deep own reply and an unfinished thread at once
- [WARNING] engine/communityread.js:1145 - catch untested --> DEFERRED: disclosed; every input is validated before it
- [WARNING] engine/communityread.js:1376 - unlisted line forever --> FIXED (5944cb024, plain statement)

#### Iteration 8 (whole-branch read, nothing marked settled)
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 0 acted on
- [WARNING] engine/communityread.js:1139 - a slow profile still holds the read until it answers --> DEFERRED to kosmos#7811 follow-ups
- [WARNING] engine/communityread.js:1458 - own items as seen on newest posts count against SEEN_MAX --> DEFERRED to kosmos#7811
- [WARNING] engine/communityread.js:690 - cap bound wrong for escaped text --> FIXED (6d3b2f2cd, comment made true)
- [WARNING] engine/communityread.js:966 - the count's 1 s limit has no parallel round to hide behind --> DEFERRED to kosmos#7811
- [NIT] line 516 round-1 time --> FIXED (6d3b2f2cd)
**Converged** - no BLOCKER.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/communityread.js:719 | BRANCH | held/saved older posts | FIXED | 460c0621a |
| 2 | 1 | WARNING | engine/communityread.js:719 | BRANCH | own reply forever active | FIXED | 460c0621a |
| 3 | 1 | WARNING | engine/communityread.js:913 | BRANCH | profile holds nudge | FIXED | 460c0621a |
| 4 | 1 | WARNING | engine/communityread.js:686 | BRANCH | cap too small | FIXED | 460c0621a |
| 5 | 1 | WARNING | engine/communityread.js:1085 | BRANCH | serial profile | FIXED | 460c0621a |
| 6 | 1 | WARNING | engine/communityread.js:1086 | BRANCH | same-set claim | FIXED | 460c0621a |
| 7 | 1 | WARNING | engine/communityread.js:486 | BRANCH | stale docs | FIXED | 460c0621a |
| 8 | 1 | WARNING | engine/repliesall-7811.test.js:122 | BRANCH | coverage | FIXED | 460c0621a |
| 9 | 2 | WARNING | engine/communityread.js:1124 | SELF | gate trips always | FIXED | 49576c47a |
| 10 | 2 | WARNING | engine/communityread.js:692 | SELF | own skip hides person | FIXED | 49576c47a |
| 11 | 2 | WARNING | engine/communityread.js:1343 | BRANCH | unlisted noise | DEFERRED | reworded |
| 12 | 3 | BLOCKER | engine/communityread.js:1420 | SELF | cap-cut stranding | FIXED | 6bf9f41e2 |
| 13 | 3 | WARNING | engine/communityread.js:726 | SELF | promised forever | FIXED | 6bf9f41e2 |
| 14 | 3 | WARNING | engine/communityread.js:1372 | BRANCH | no floor | FIXED | 6bf9f41e2 |
| 15 | 4 | WARNING | engine/communityread.js:1128 | BRANCH | always-slow link | DEFERRED | stated limit |
| 16 | 4 | WARNING | engine/communityread.js:1428 | BRANCH | own replies take slots | DEFERRED | bounded |
| 17 | 5 | WARNING | engine/communityread.js:933 | SELF | count no slow gate | FIXED | c1836afe4 |
| 18 | 5 | WARNING | engine/communityread.js:1433 | SELF | own-seen older cut | FIXED | c1836afe4 |
| 19 | 6 | WARNING | engine/communityread.js:696 | BRANCH | duplicate older | FIXED | badb33a20 |
| 20 | 6 | WARNING | engine/communityread.js:1147 | SELF | throw loses read | FIXED | badb33a20 |
| 21 | 6 | WARNING | engine/communityread.js:1364 | BRANCH | slow, nothing active | DEFERRED | it was checked |
| 22 | 7 | WARNING | engine/communityread.js:941 | SELF | slow count skipped partial | FIXED | 5944cb024 |
| 23 | 7 | WARNING | engine/communityread.js:1448 | SELF | guards untested | DEFERRED | disclosed |
| 24 | 8 | WARNING | engine/communityread.js:1139 | BRANCH | slow profile wait | DEFERRED | on card |
| 25 | 8 | WARNING | engine/communityread.js:966 | BRANCH | count limit strict | DEFERRED | on card |

### NITs (non-blocking, across all iterations)
- [NIT] long unwrapped comment lines near REPLIES_POSTS and REPLY_PAGES_MAX (iterations 2, 4, 6, 7, 8)
- [NIT] "something new" also counts promised posts (iterations 2, 7)
- [NIT] `asked` counts a profile request (iteration 5, mutation-insensitive counter)

### Strengths (across all iterations)
- One shared postsToRead for the read and the nudge's count, tested to take the same 5 (iterations 1 to 8)
- The profile is checked field by field; a malformed answer cannot widen the set beyond the agent's own posts (iterations 1, 3)
- Tests pair each rule with a control that can return the dangerous answer, and each rule was perturbed (iterations 3, 5, 7)
