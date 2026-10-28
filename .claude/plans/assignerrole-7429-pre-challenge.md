---
pre_challenge: true
method: challenge-loop
branch: assignerrole-7429
diff_hash: 5736b3b9ab0043f912d245d13ce8a6b3a72798f574bc2b7c3ef2d4ef74f5dbe4
subdir_audit: passed
timestamp: 2026-10-28T04:31:58Z
converged: true
---

## [CHALLENGE] kosmos#7429, three blind rounds, converged with no blocker open

Ice Cream Kitty. Reviewers alternated opus, sonnet, opus; each was given the code and the card, never my conclusions.

### Round 1 (opus, on 71fd81a49e): no blockers, four warnings, all fixed in f192054e05
- The first word rule (a review word and no making word) said yes to builders ("design review and copy", "reviews and drafts", "QA engineer"), silently taking them out of hand-outs. Now only explicit forms count, and `kosmos project role` says when a role reads that way.
- A review-only holder's part locked its task tree from builders: busyHold now treats it like a member switched off.
- The goal ask still went to a review-only member: skipped.
- The comment's plural-noun rule did not match the regex: gone with the rule.

### Round 2 (sonnet, on f192054e05): no blockers, fixed in 8c5ee53826
- The "said" forms matched anywhere ("not QA only", "builds, QA only on mobile"): the whole role must now be one form.
- The route re-read the projects file after the write (a race, and a silent failure): it now answers from the role it saved.
- A parent whose only open subtask a reviewer holds: pinned by a test (it goes to a builder).

### Round 3 (opus, whole branch, on 8c5ee53826): no blockers, fixed in cf2595e0eb
- A rate-limited reviewer's own stalled part was offered for failover: no longer.
- The role route's comment still said the role was display only: rewritten.
- busyHold's comments now name the rule and its cost (any part, not only a review subtask).

### Validation
- Focused (6g): engine assigner*, projects*, project-role (Mac, Windows, server) and tasks tests: 451 tests, 0 failed.
- Full suite on cf2595e0eb: 25076 tests, 24668 pass, 1 fail, 407 skipped. The one failure, server.phonenotify-718.test.js "#6488: an off with no token ever minted ...", is outside this diff and passes alone (50 of 50): a load flake with two suites running side by side. PR CI runs the full suite again.

## Final ledger

- [WARNING] (round 1) the word rule said yes to builders: FIXED, explicit forms only (f192054e05)
- [WARNING] (round 1) a review-only holder locked its task tree: FIXED in busyHold (f192054e05)
- [WARNING] (round 1) the goal ask went to a review-only member: FIXED (f192054e05)
- [WARNING] (round 1) the comment stated a plural-noun rule the regex lacked: FIXED, rule replaced (f192054e05)
- [WARNING] (round 2) the "only" forms matched anywhere in a longer role: FIXED, whole-role match (8c5ee53826)
- [WARNING] (round 2) the route re-read the file after the write: FIXED, answers from the saved role (8c5ee53826)
- [WARNING] (round 3) a reviewer's stalled part was offered for failover: FIXED (cf2595e0eb)
- [WARNING] (round 3) the route comment said the role was display only: FIXED (cf2595e0eb)
- [NIT] (round 2) forms like "reviewer/QA" or a quoted role do not match: KEPT, the safe side, pinned by a test
- [NIT] (round 3) the instruction block change prompts every agent to re-read its instructions once: KEPT, the same as #5300
- [BLOCKER] none open in any round
