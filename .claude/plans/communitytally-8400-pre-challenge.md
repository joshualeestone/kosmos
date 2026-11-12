---
pre_challenge: true
method: challenge-loop
branch: communitytally-8400
diff_hash: 23b33868943bd566abe26775764d4b2b74d71e6491df36c9e42289f761399d07
validation: passed
subdir_audit: passed
timestamp: 2026-11-12T02:52:22Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** Yes (iteration 8 found NITs only; 8 is also the loop's cap)
**Total findings acted on:** 0 BLOCKERs, 14 WARNINGs, 0 CONVENTIONs, plus NITs (and one outside review, Mona Lisa's, on the card)
**Fixed:** 13 WARNINGs and 18 NITs | **Deferred:** 1 WARNING (documented in the plan and on the card) | **Asked:** 0

Full run-tests validation passed on Mortals on the final head 10320d17a7 (hash 23b33868943b, base c94894ce11),
after a rebase onto main. Main has since moved 35 commits; none touches a file this branch changes, and the branch
merges cleanly onto it (git merge-tree). Validation 3 (on d61d6841b9) was stopped before it ran, because Mortals was
reserved for the 0.8.03 release; it proves nothing and is not counted. Each fix that changed behaviour from
iteration 3 on has a test shown failing with that fix reverted, one at a time.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/communityfollow.js tallyLine - a cut-short read gave its numbers as exact --> FIXED (1d974363eb; "only in the pages it could read" and "at least")
- [WARNING] test-support/following-fixture-8400.js - the fixture fit on one page, so the paths that differ were untested --> FIXED (1d974363eb; a two-page fixture with a cut-short arm)
- [WARNING] engine/communityfollow.js - replies cannot be ticked off one by one --> DEFERRED: it would change how the read shows replies, which the card does not ask for; stated in the plan and on the card
- [WARNING] engine/communityfollow.js readFollowing - a tally from a different done set when doneFollowing throws --> FIXED (1d974363eb; no line then)
- [NIT] docblock restored, duplicate plural, "shows 0 of the new posts", a literal 4 --> FIXED

#### Iteration 2
**Reviewer model:** sonnet (plus Mona Lisa's outside review on the card)
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/communityhome.js tallyFollowing - a repeated post was counted twice --> FIXED (4ebe403e9f; distinct posts; home's count is the tally's)
- [WARNING] engine/communityfollow.js tallyLine - "already seen" and "could not count" merged, unlike home --> FIXED (4ebe403e9f)
- [WARNING] engine/communityfollow.js tallyLine - printed older items were not in the line --> FIXED (4ebe403e9f)
- [NIT] the nudge has no reconciliation of its own; no marker on new headers; a moving feed can shift a count by one --> noted, stated in the plan

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (the dedup added in iteration 2 moved the page edge)
- [WARNING] engine/communityhome.js tallyFollowing - replies counted after a repeat was dropped moved the newest page's edge by one --> FIXED (d61d6841b9)
- [WARNING] engine/communityhome.js homeFor - titles from the undeduped feed gave a repeated post two titles --> FIXED (d61d6841b9)
- [NIT] cut-short "at least" read as covering replies; tally taken without home's rule; id-less posts merged; tests for the card's named paths --> FIXED (d61d6841b9)
- [NIT] "could not be shown" has no test --> DEFERRED: not reachable today (entryOf drops only a non-object); kept as a guard, stated in the plan

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/communityfollow.js tallyLine - "listed under the posts they answer" claimed more than a post shows (3 at most) --> FIXED (17fe12435a)
- [NIT] "at least 0 new posts" --> FIXED; four others noted in the plan

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (iteration 4's "up to 3 a post" wording)
- [WARNING] engine/communityfollow.js tallyLine - "up to 3 a post" false for replies to a post the feed does not carry --> FIXED (c58c550ce8; "grouped by the post they answer; each group shows a few and says how many more")
- [NIT] cut-short none unqualified; a repeated reply counted twice --> FIXED (c58c550ce8); two noted

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (the nudge wording from iteration 2)
- [WARNING] engine/communityhome.js nudgeLine - replies sat inside "you have not been shown" --> FIXED (4cbcb1ea69)
- [NIT] an older-only feed had no line; "it could not count" --> FIXED (4cbcb1ea69); two noted

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1 of the above ("could not count", carried from iteration 2)
- [WARNING] engine/communityfollow.js tallyLine - seen and older posts counted on every page but mostly never printed, with nothing saying so --> FIXED (1a43165d93; "and K of the P other posts")
- [WARNING] engine/communityfollow.js, engine/communityhome.js - "Kosmos could not count" contradicted itself --> FIXED (1a43165d93; "cannot mark as seen")
- [NIT] stale docblock; "0 replies (grouped ...)"; the cut-short phrase twice; the nudge's word order --> FIXED (1a43165d93); one noted

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
**Converged** - no new actionable findings. NITs recorded in the plan (a clamp that would hide an over-count no input reaches; the other-posts figure's reliance on the tally's buckets; the 24-hour phrase's position; a second-read assertion that checks only a prefix; the focused count moving 79 to 80).

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/communityfollow.js tallyLine | BRANCH | cut-short numbers given as exact | FIXED | 1d974363eb |
| 2 | 1 | WARNING | test-support/following-fixture-8400.js | BRANCH | one-page fixture left the differing paths untested | FIXED | 1d974363eb |
| 3 | 1 | WARNING | engine/communityfollow.js | BRANCH | replies cannot be ticked off one by one | DEFERRED | changes how replies render; stated in plan and card |
| 4 | 1 | WARNING | engine/communityfollow.js readFollowing | BRANCH | tally from a different done set | FIXED | 1d974363eb |
| 5 | 2 | WARNING | engine/communityhome.js tallyFollowing | BRANCH | repeated post counted twice | FIXED | 4ebe403e9f |
| 6 | 2 | WARNING | engine/communityfollow.js tallyLine | BRANCH | seen and uncounted merged | FIXED | 4ebe403e9f |
| 7 | 2 | WARNING | engine/communityfollow.js tallyLine | BRANCH | printed older items not in the line | FIXED | 4ebe403e9f |
| 8 | 3 | WARNING | engine/communityhome.js tallyFollowing | SELF | page edge moved by the dedup | FIXED | d61d6841b9 |
| 9 | 3 | WARNING | engine/communityhome.js homeFor | BRANCH | two titles for a repeated post | FIXED | d61d6841b9 |
| 10 | 4 | WARNING | engine/communityfollow.js tallyLine | BRANCH | "listed under" overstated what is shown | FIXED | 17fe12435a |
| 11 | 5 | WARNING | engine/communityfollow.js tallyLine | SELF | "up to 3 a post" false for Reply-to entries | FIXED | c58c550ce8 |
| 12 | 6 | WARNING | engine/communityhome.js nudgeLine | SELF | replies inside "not been shown" | FIXED | 4cbcb1ea69 |
| 13 | 7 | WARNING | engine/communityfollow.js tallyLine | BRANCH | counted posts never printed, unsaid | FIXED | 1a43165d93 |
| 14 | 7 | WARNING | engine/communityfollow.js, communityhome.js | SELF | "could not count" contradicted itself | FIXED | 1a43165d93 |

### Outstanding questions (ASKED, still unresolved when the run ended)
- None.
