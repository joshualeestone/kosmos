---
pre_challenge: true
method: challenge-loop
branch: feedguard-regex-3608
diff_hash: 938ee48969c468f86c43b761a25a09277b0ecaaa01f6809ebab20919450cff04
validation: passed
subdir_audit: passed
timestamp: 2026-09-24T17:15:28Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 3 (1 BLOCKER, 2 WARNINGs), plus NITs
**Fixed:** 3 | **Deferred:** 0 (one WARNING filed as its own card, #3609) | **Asked (awaiting user):** 0

### Validation

Full suite on HEAD b7eba91a, hash 938ee489: 8548 pass, 0 fail (validation log status clean,
2026-09-24T17:15:28Z). DEVELOPER_DIR set to CommandLineTools. Perturbation arms, both confirmed applied:
old email regex restored makes the linear test red 3 of 3 (about 2.1 s); TLD length
perturbed to {3,} makes the equivalence test red.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 1 of the above (the BLOCKER is in a test I wrote)
- [BLOCKER] engine/feedguard.test.js linear test: with the old regex restored it stayed green (warm old regex 120-140 ms on 16 KB inputs, under the 200 ms bound) --> FIXED (b7eba91a): 64 KB inputs, where the old form takes 2 s or more; red 3 of 3 with it restored
- [WARNING] engine/feedguard.js:161 the spelled grouped-currency pattern is also quadratic, contrary to the plan --> plan corrected; filed as #3609 because a lookbehind is not equivalent there
- [WARNING] timing figures in comments did not reproduce --> FIXED (b7eba91a): comments state growth rate and conditions
- [NIT] hand-copied old regex in the test --> fixed: a comment says it is a deliberate copy

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Converged** -- no new actionable findings. Measured: linear test 1-5 ms with the fix under
added CPU load, 2631 ms red with the old regex; seeded generator 434 of 50000 match.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | engine/feedguard.test.js | SELF | linear test could not fail | FIXED | b7eba91a |
| 2 | 1 | WARNING | engine/feedguard.js:161 | BRANCH | second quadratic pattern | FILED | #3609 |
| 3 | 1 | WARNING | engine/feedguard.js comments | BRANCH | timing figures unreproducible | FIXED | b7eba91a |

### NITs (non-blocking, across all iterations)
- [NIT] engine/feedguard.js:145 comment line length (iteration 2): did not reproduce, the line is 79 characters
- [NIT] EMAIL_UNANCHORED could be derived from EMAIL.source instead of a literal (iteration 2): kept literal on purpose, deriving it would make the equivalence test compare the pattern with itself-minus-a-prefix and drift with it
- [NIT] plan's "about 290 ms to 40 ms" for the huge-body test is one run, not a range (iteration 2): noted

### Strengths (across all iterations)
- Root cause from a CPU profile, not a raised bound; the 2000 ms bound stays
- Equivalence argued and fuzzed with a match floor, so agreeing on "no" cannot pass
- Linear test sized to the regex, not to SCAN_CAP, so it fails with the old form
- The out-of-scope second pattern filed rather than half-fixed
