---
pre_challenge: true
method: challenge-loop
branch: tokenkey-4738
diff_hash: bb38289bf18cda058c257bbcd7ac65973feff28b95f3917a0eb9c4646f67e75c
validation: passed (Mortals, dac005e43; this proof commit carries under D1)
subdir_audit: passed
timestamp: 2026-09-30T18:26:01Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 (blind, sonnet), 2026-09-30
**Converged:** Yes (0 BLOCKER; the one WARNING is older than this change, and this change neither causes nor alters it)
**Findings:** 0 BLOCKERs, 1 WARNING (pre-existing, filed as #4763), 3 NITs

### Validation
Full validation CLEAN on Mortals for dac005e43 (hash bb38289bf18c, 12:18 CDT). Since then only this proof file changed (rule D1). Main has moved since (merge base -> 2819c39a3), but touches none of this PR's files, and merge-tree is clean (path B).

### Iteration 1: 0 BLOCKER, 1 WARNING, 3 NIT
- Verdict: the reordered predicate in engine/sendertoken.js fixes the CLASS, not just the "!!" spelling. safeKey throws only when nothing survives stripping, so "!!", "@@", CJK-only, empty and whitespace-only names are all caught. No new path to resolving the wrong agent's token: a row that used to throw now returns null and cannot match. Sibling uses of the predicate were checked; none is left unfixed.
- [WARNING] engine/sendertoken.js:365 + engine/store.js:278 - safeKey is lossy, so "Mara" and "mara" share a key and resolve's find() takes the first --> PRE-EXISTING, not changed by this PR (the predicate order does not affect which row wins); creation refuses a key clash with a running session; the residual is filed as #4763 with a test and a fix shape
- [NIT] keyOf is redefined inside the loop (no effect)
- [NIT] the test has only a stranger row, not an unkeyable row that is ours (arguably unreachable; handled anyway)
- [NIT] the test's sort comparator is not a consistent ordering (fine for two rows)
