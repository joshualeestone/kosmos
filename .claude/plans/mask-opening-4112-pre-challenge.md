---
pre_challenge: true
method: challenge-loop
branch: mask-opening-4112
diff_hash: 35b264309d40286ca7fc0fca0c31f99f695233bf2f0984c71adc2689286fface
validation: passed
subdir_audit: passed
timestamp: 2026-09-27T09:24:35Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** Yes. Iteration 7 (opus) found no new findings and proved the index invariant, cross-checked by about 1.7M linear-scan comparisons. Iteration 8 (sonnet) found no correctness finding across 8 adversarial constructions. That confirms convergence across two models after iteration 6's leak.
**Total findings:** 2 BLOCKERs, 5 WARNINGs
**Fixed:** 2 BLOCKERs, 5 WARNINGs. One of them was first accepted and then reversed; see "After the rebase". | **Asked:** 0

Validation PASSED (hash 35b264309d40 at 690fa2d42, on main after #4124 and #4137). Subdir CLAUDE.md audit rc 0.
Earlier validations:
- On the old base, two passed (1fafc4996ec6, 1e0a75f191d4).
- One after the first rebase FAILED on #3935's CPU guard (1,538 ms vs 1,500). That failure is the "After the rebase" fix below.
- One was killed by a signal.
Reviewer models: opus 1, sonnet 2, opus 3, sonnet 4, opus 5, sonnet 6, opus 7, sonnet 8.

### Per-Iteration Breakdown

#### Iteration 1 (opus)
- [WARNING] The charge could exceed main's: jumps, the bound and the index were all charged, so a reply main checks was withheld --> FIXED. The reply is pinned by test "#4112 review 1".

#### Iteration 2 (sonnet)
- [BLOCKER] A walk's positions went uncharged, and a crafted reply ran 2.5 s under a tiny charge --> FIXED. Every step now pays at least its work. Pinned by test "#4112 review 2".

#### Iteration 3 (opus)
- [WARNING] The index was built from the first walk's start, so a long reply's gap was indexed uncharged (7.6x main at 200 KB) --> FIXED by indexing per walk.
- [WARNING] About 2x main's time per unit --> first ACCEPTED, then REVERSED after the rebase; see below.

#### Iteration 4 (sonnet)
- No new findings.

#### Iteration 5 (opus)
- No new findings.

#### After the rebase onto #4124 (validation, not a reviewer)
- [WARNING] #3935's CPU guard failed at 1,538 ms of CPU. Charging a landed run only for what it compared let the budget buy about 2x main's work --> FIXED. A landed run now pays exactly main's charge, and the guard reads about 1.1-1.2x main.

#### Iteration 6 (sonnet)
- [BLOCKER] A LEAK: the index was built from a walk's current position, and with the next-run fast path a second held form walking from the same opening missed its own pieces. A split key came out with 5 of 5 pieces readable where main masks them --> FIXED: the index is built from the walk's opening run. Pinned by test "#4112 review 6", which fails on 534efb054, and by a shared-opening fuzz: 57-59 of 300 differ on the leaky version, 900 of 900 are identical after the fix. This never reached main.

#### Iteration 7 (opus)
- No new findings. It gave the invariant proof, confirmed by about 1.7M comparisons with 0 disagreements (the control, indexing from s, gave 196).

#### Iteration 8 (sonnet)
- No correctness findings.
- [WARNING] An unread per-group cost carried the reverted charge basis, a trap for a future edit --> FIXED (removed, with a comment explaining why).

Evidence at the final head, against the newest main:
- Output identical on 1,400 randomized replies and 600 shared-opening replies.
- 300 adversarial inputs, 0 charged above main.
- secretmask 125/125, guide-secrets 18/18, knownsecrets 6/6.
- #3935 guard at 558-695 ms of CPU against main's 551-575.
