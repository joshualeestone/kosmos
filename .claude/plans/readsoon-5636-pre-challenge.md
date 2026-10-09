---
pre_challenge: true
method: challenge-loop
branch: readsoon-5636
diff_hash: f4be5bd58368de487d44fc28c110addf54f772626d54900f53537b2721c27c4b
validation: passed (rebased on origin/main and re-run; engine/readjobs and server.community-read-soon-5636 (route + both commands against a slow service) plus every Mac and Windows community command test, the server community suites, the 4491 token-only suite, help-lines and the file-scanning, Windows and reachable guards, 0 fail; red by mutation: soon ignored, each command's ask-again loop, hand-out deletion, failed-read finishing, the route-param key, the stuck-read drop, the resend window and the resend rule)
subdir_audit: passed
timestamp: 2026-10-09T20:36:35Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6 (opus, sonnet, opus, sonnet, opus, sonnet; each blind)
**Converged:** Yes (iteration 6: nothing above NIT, both NITs inside the plan's accepted trade-offs)
**Total findings:** 1 BLOCKER, 11 WARNINGs, about 15 NITs
**Fixed:** the BLOCKER and every WARNING (two as documented trade-offs in the plan) | **Asked (awaiting user):** 0

The change (kosmos#5636 F4, 0.7.33 report): community reads answer within seconds with ?soon=1 and are collected by
asking again in short requests, so no single request is long enough for a sandbox proxy or a runner time limit to cut.

### Per-Iteration Breakdown

#### Iteration 1 (opus)
- [BLOCKER] six Windows tests pinned the old read address --> FIXED.
- [WARNING] two readers' sharing untested at the route --> FIXED. [WARNING] a rejecting read never finished --> FIXED.
- [WARNING] uncollected answers can be dropped unseen --> documented in the plan. [WARNING] any query word started a read --> FIXED (route params only).

#### Iteration 2 (sonnet)
- [WARNING] a read that never settles stayed "still reading" until restart --> FIXED (dropped after 3 minutes).

#### Iteration 3 (opus)
- [WARNING] missing catches --> FIXED. [WARNING] cap evicts by start order, undocumented --> documented.
- [WARNING] an answer handed out before the client has it --> FIXED (30 s resend window). [CONVENTION] a personal machine detail in the plan --> FIXED.

#### Iteration 4 (sonnet)
- [WARNING] failures replayed for 30 s --> FIXED. [WARNING] a post re-read after a comment stale --> FIXED (only good replies/Following answers are kept).

#### Iteration 5 (opus)
- [WARNING] the resend rule untested at the route --> FIXED (a named, tested function). [WARNING] the plan overstated freshness --> FIXED (wording).

#### Iteration 6 (sonnet)
- Nothing above NIT.
