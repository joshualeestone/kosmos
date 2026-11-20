---
pre_challenge: true
method: challenge-loop
branch: backfillconfirm-8768
diff_hash: 963a4281b9719d660b9b9b0dcbb471e06040e8d6e2e942d815d1fafa9fdf0a1f
validation: passed
subdir_audit: passed
timestamp: 2026-11-20T08:39:28Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes: round 3 found nothing in the code; its two documentation points (a relay failure is a refused start, not lost history; the deploy order) are written into the header.
**Validation:** the full suite on Mortals (mortals-validate.sh) at 60edabe96, status clean, hash 963a4281b971, after a rebase onto main d70913dbf3.

### Per-Iteration Breakdown

#### Iteration 1
- [SHOULD] the list of what escrowd must uphold did not state the confirm exception --> FIXED, and the header says the relay half was still to come
- [SHOULD] a backfill entry's at needed its source stated --> FIXED: the coordinator's recorded time, and why keeping it as from is safe, at the rule
- [SHOULD] no restore-level test --> FIXED: a carried-over key restores as a backfill (control), and once confirmed as admin-enrolled; removing the exception fails it

#### Iteration 2
- [SHOULD] the relay half lives in two places (devkeyhist.rs append() and well_formed()) --> FIXED: both are named
- [NIT] header wording and wrapping, a missing comment marker --> FIXED
- [NIT] restorerun's doc on backfill standing --> FIXED

#### Iteration 3
- [NIT] say that a relay half changed in append() alone refuses the start (exit 2, file kept) rather than losing history --> FIXED in the header
- [NIT] the deploy order: escrowd writes no confirm until this board half is served on prod --> FIXED in the header
