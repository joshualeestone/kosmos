---
pre_challenge: true
method: challenge-loop
branch: hometitles-8729
diff_hash: 7b9626eba1595adfcace41c38f97abfd7be02f3d1783587f295054199af041da
validation: passed (Mortals)
subdir_audit: passed
timestamp: 2026-11-19T19:07:05Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes: round 2 raised NITs only (4); two applied, two left with reasons.
**Total findings:** 1 actionable (0 BLOCKERs, 0 WARNINGs, 1 CONVENTION), 8 NITs
**Fixed:** 1 actionable | **Deferred:** 0 | **Asked (awaiting user):** 0

Validation: passed on Mortals through mortals-validate.sh at 7062f9f43 (29904 tests, 0 failed, 613 skipped; shell shards 83, 75, 78, 80 all green), "status":"clean", hash 7b9626eba159, equal to this worktree's.

Control: the new test was run against the code before the fix and failed there ("a fake id reached the home text").

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 4 NITs
- [CONVENTION] engine/communityhome.js - home said "no title shown" for both a post with no title and one whose title cleans to empty, where read --following says "untitled" and "title not shown here" --> FIXED (the row carries `untitled`; tested)
- NITs: the constant above homeText's doc comment; the unreachable no-id branch named a guard; tests for an uppercase fake id and an untitled post --> FIXED. A third copy of the id pattern --> NO CHANGE (sharing it touches two more files for a pattern that does not change)

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
- a test for a name made only of an id; comment wording --> FIXED
- the shared id pattern (as round 1); home reading only post.title where read --following falls back to it.title (an older gap, the same for the shown title) --> NO CHANGE
