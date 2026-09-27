---
pre_challenge: true
method: challenge-loop
branch: mask-opening-4112
diff_hash: 1fafc4996ec6e9a7a5c54be017a1bc29a49522c4186673c5acb3cd0e21e49518
validation: passed
subdir_audit: passed
timestamp: 2026-09-27T06:49:01Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes. Iteration 4 (sonnet) and iteration 5 (opus) found no new findings, which confirms convergence across two models.
**Total findings:** 1 BLOCKER, 3 WARNINGs
**Fixed:** 1 BLOCKER, 2 WARNINGs | **Accepted and stated:** 1 WARNING (about 2x time per charged unit in step-heavy text; charging it would break "never above main's charge") | **Asked:** 0

Validation: PASSED (hash 1fafc4996ec6 at 050f36418). Subdir CLAUDE.md audit rc 0.
Reviewer models: opus 1, sonnet 2, opus 3, sonnet 4, opus 5.

### Per-Iteration Breakdown

#### Iteration 1 (opus)
- [WARNING] The budget charge could exceed main's. Each jump, the final jump at the bound, and each indexed run were charged, so a reply main checks was withheld (40 keys sharing sk-ant-api03-X, with lines of X0 ... X39) --> FIXED. Jumps and indexing are free, and a landed run is charged only for the variants compared. The reply is a test, and it fails on 165fa3a14.
- No output (A) findings: 1,900 adversarial fuzz trials were identical.

#### Iteration 2 (sonnet)
- [BLOCKER] Each step's positions (`at`, which grows with `reached`) went uncharged. A key full of - and _, spelled two characters at a time, ran 2 to 6 s under a tiny charge where main exhausted the budget in about 0.2 s. That turned fail-closed slow, and possibly into passing --> FIXED. Each step is charged max(at.length, compared variants), which is at most main's charge for its range and at least its work. The attack is a test, and it fails on 86c0620a5.

#### Iteration 3 (opus)
- [WARNING] The index was built from the first walk's start, so a later walk far down a long reply indexed every run between them, uncharged (7.6x main's time at 200 KB) --> FIXED. It now indexes from each walk's own start, and the reach limit is cached until lastAt moves. At 240 KB: main 389 ms, previous 580 ms, now 439 ms.
- [WARNING] About 2x main's time per unit when nearly every run could continue a key --> ACCEPTED, and stated in the budget comment. It still fails closed.

#### Iteration 4 (sonnet)
- No new findings. The index invariant was proved by hand, and 8,700 fuzz and charge trials plus a targeted gap attack showed 0 output diffs and 0 charges above main.

#### Iteration 5 (opus)
- No new findings. The tests are armed: the #4112 test reds on main, the review-1 test reds with over-charged jumps, and the review-2 test reds with free positions.

Evidence across the loop: identical output to main on 1,600+ randomized split-key replies (a planted off-by-one changes 332 of 400). 900 adversarial inputs, 0 charged above main, about 3.6x fewer units in total.
