---
pre_challenge: true
method: challenge-loop
branch: followslots-7168
diff_hash: d7a3a5b10985d088e689d4c39254c5ed0b23e45262441b58591badd4e76df17e
validation: passed
timestamp: 2026-10-26T06:31:13Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** Yes (iteration 8: no new BLOCKER or WARNING findings)
**Total findings:** 1 BLOCKER, 13 WARNINGs, 23 NITs
**Validation:** local full validation of 2fda25c6d5, "validation PASSED for stack=typescript hash=d7a3a5b10985", EXIT=0
(the converged head ca5164b4a8 passed earlier at hash 06e1159cfedc).

Rounds 1 to 5 built a read-side paging and fill design for readFollowing. Round 6 measured it on 2,000 newest-first
feeds (the service's real order, confirmed in round 4) and found it behaved exactly like main, so it made no difference
on the real feed and was reverted. What ships is only the shared rule (communityhome.countedFollowing) and its tests.
The full round log is in .claude/plans/followslots-7168.md.

#### Iteration 1
1 blocker, 3 warnings, 2 nits. [BLOCKER] a quiet follow list showed the same page every read (fixed, later reverted
with the read-side design). Warnings fixed or decided on the card (paging rule test, moving-feed test, request cost).

#### Iteration 2
0 blockers, 1 warning, 2 nits. [WARNING] fewer than three counted posts fetched all three pages every read; fixed with
an early stop on a newest-first old page (later reverted).

#### Iteration 3
0 blockers, 2 warnings, 2 nits. [WARNING] a home test comment overclaimed; [WARNING] quiet-list request count untested.
Both fixed.

#### Iteration 4
0 blockers, 1 warning, 4 nits. Reviewer confirmed from the service that the feed is newest first by created_at then id.
[WARNING] the early stop's age half was untested; fixed.

#### Iteration 5
0 blockers, 2 warnings, 4 nits. [WARNING] a reachability promise in the comment and plan was false; corrected.
[WARNING] the 24-hour threshold was unpinned; pinned.

#### Iteration 6
0 blockers, 3 warnings, 4 nits. Changed the design: on newest-first feeds the branch matched main exactly, so the
read-side changes were reverted to the merge base and only countedFollowing ships. Done-when 2 not met as written;
Splinter amended it to the depth guarantee (on #7168); the backlog loss filed as #7172.

#### Iteration 7
0 blockers, 1 warning, 3 nits. Refactor confirmed behaviour-identical. [WARNING] plan top sections described the
reverted design; rewritten. Nits fixed (uppercase id, no done set returns false).

#### Iteration 8
0 blockers, 0 warnings, 4 nits. CONVERGED. Service claims re-checked against kosmos-community origin/main. Nits fixed
(threshold pinned at 23 h and 25 h, id trim tested, comment wording).

#### After convergence: one hardening, not a review round
Raised by Ice Cream Kitty from her #7172 review (the loop had used its 8-round cap): countedFollowing now also
requires the id to match UUID_RE as it arrives (lower-cased, not trimmed), exactly what noteSeen keeps, so a post a
read can never record as shown is never counted. [NIT]-sized, 3 lines. Tests: home 14/14, community 828 pass 0 fail,
tree guards 24/24; broken copies (no check; check on the trimmed id) each go red. Not independently reviewed; stated
on #7168.
