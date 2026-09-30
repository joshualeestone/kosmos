---
pre_challenge: true
method: challenge-loop
branch: communitycomment-4373
diff_hash: 61c5eb5086f6b75bfa878fc1dfdd0c1dc77d3bcecafaa4352bbd4c3b12c60584
validation: passed
subdir_audit: passed
timestamp: 2026-09-30T13:41:29Z
iterations: 20
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 20 (17 in earlier sessions, recorded round by round in `.claude/plans/communitycomment-4373.md`; 3 this session)
**Converged:** Yes
**Findings this session (rounds 18-20):** 0 BLOCKERs, 8 WARNINGs, 0 CONVENTIONs, 13 NITs
**Fixed:** 3 | **Deferred:** 5 (all duplicates of standing ledger entries) | **Asked (awaiting user):** 0
Rounds 1-17 converged at the sixth red-team round. After that origin/main was merged and a timing-dependent test was
fixed (9a85cbc33), so the loop resumed on the changed tree.

### Per-Iteration Breakdown

#### Iterations 1-17
**Reviewer model:** mixed (see the plan file)
**Result:** each round's findings fixed or deferred in the plan; round 17 (the sixth red-team round) converged.

#### Iteration 18
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING (3 raised), 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings:** 2
- [WARNING] engine/communitysend.js:414 - no answer or a 5xx records `unconfirmed` and never resends --> DEFERRED: duplicate of the at-most-once choice (plan lines 30-36, 64)
- [WARNING] server.js:7874 - a rejected comment still records the ON period's start --> DEFERRED: duplicate of iteration 8's accepted note
- [WARNING] engine/feedpublish.js:255 - the 47 NEWER_THAN_SERVICE ranges named the step but not the command --> FIXED (3d231d7f7): tools/gen-service-unicode.js reproduces the committed line byte for byte with python3.14 and Node 26; with python3.13 it gives 87 ranges and does not match
- [NIT] engine/communitysend.js:436 - the 409 branch is unreachable until replies ship
- [NIT] install/kosmos - the Mac verb joins arguments with "$*"
- [NIT] engine/communityblock.js - the block's token cost is unmeasured

#### Iteration 19
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/communityread.js:142 - the author scrub removed ids before brackets, so "post 1234567(8-...)" rebuilt a whole forged post id in the header an agent takes a comment's id from --> FIXED (4a147d453): brackets first; reds with the old order. An id spliced around another id needs 72 characters and names are cut to 64, so no repeat was added (a mutation removing one stayed green)
- [WARNING] engine/communitysend.js:344 - a sweep on the network across an OFF then ON kept its old window --> FIXED (4a147d453): the comment pass re-reads the period start before each send; a held-sweep test with a no-OFF control; reds without the re-read
- [NIT] engine/communitysend.js:36 - the header said an OFF-then-ON between sweeps is not seen --> FIXED (4a147d453)
- [NIT] engine/communitysend.js:254 - settle() keeps an old `reasons` on a sent row
- [NIT] web/index.html:29441 - "releasing it while Community is on sends it" holds only if it is still on at the next sweep
- [NIT] engine/communitycomment-4373.test.js - the window is >= in milliseconds; tests use a 5 ms gap (a second such test, "nothing is sent while the switch is off", flaked 1 in 6 and now waits; 12 of 12 alone)

#### Iteration 20
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs after deduplication (3 raised), 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings:** 3
- [WARNING] engine/communitysend.js:427 - a "will not go" record can be lost to a concurrent sweep's save --> DEFERRED: duplicate of review 6 (the authoritative notSent mark is on the comment row)
- [WARNING] engine/communitysend.js:498 - a comment released while OFF shows nothing on /sent --> DEFERRED: duplicate (/sent lists what the board has TRIED to send)
- [WARNING] install/kosmos:2340 - "may have been taken, do not send it again" can lose a comment on a transient board failure --> DEFERRED: duplicate of the at-most-once choice
- [NIT] engine/communityread.js:44 - RULE_TAIL is one long sentence
- [NIT] engine/communityread.js:134 - the id strip is single pass (the 64-character cap makes a splice impossible)
- [NIT] engine/communitysend.js:465 - a sweep's `now` is sampled once
- [NIT] engine/communitysend.js:112 - the comments-sent.json message is keyed on its path
**Converged** - no new actionable findings.

### Final Ledger (this session)

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 18 | WARNING | engine/communitysend.js:414 | BRANCH | unconfirmed never resent | DEFERRED | at-most-once, ledger |
| 2 | 18 | WARNING | server.js:7874 | BRANCH | rejected comment records start | DEFERRED | iteration 8 |
| 3 | 18 | WARNING | engine/feedpublish.js:255 | BRANCH | Unicode table not regenerable | FIXED | 3d231d7f7 |
| 4 | 19 | WARNING | engine/communityread.js:142 | BRANCH | bracket-split forged post id | FIXED | 4a147d453 |
| 5 | 19 | WARNING | engine/communitysend.js:344 | BRANCH | in-flight sweep keeps old window | FIXED | 4a147d453 |
| 6 | 20 | WARNING | engine/communitysend.js:427 | BRANCH | not_sent record overwritten | DEFERRED | review 6 |
| 7 | 20 | WARNING | engine/communitysend.js:498 | BRANCH | released-while-OFF not on /sent | DEFERRED | ledger |
| 8 | 20 | WARNING | install/kosmos:2340 | BRANCH | maybe-taken loses on transient failure | DEFERRED | at-most-once |

### Outstanding questions
None.

### Strengths (this session)
- At-most-once delivery throughout: a write-ahead attempted mark, unconfirmed never resent, the notSent mark on the comment row, a separate record file.
- Shell-injection defence for the commands agents run: environment-built JSON, a quoted heredoc with KOSMOS_END, the PowerShell single-quoted here-string.
- Board-side checks match the service's own refusals, including the Unicode 16 vs 17 gap, now with a generator.
- The read frame closes the forged-id path in the header line an agent takes a post id from.
