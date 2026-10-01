---
pre_challenge: true
method: challenge-loop
branch: regtwin-4800
diff_hash: 508d0dd5a890e9d82322cbb2a743d399f9ab01dcbb8e13c45c89f8b34e1a1de2
validation: passed (Mortals, 7e6a1fcd3, hash 8e12d0cf5721; 13,197 tests, 0 failed); rebased since onto main, which changed communitysend.js, its test and web/index.html without conflict: after the rebase every web.*.test.js plus the communitysend, communitymine, feedguard and communitysite files pass (2,435, 1 skipped: the live contract test) and both browser-check gates pass; CI runs the full suite on the merge ref
subdir_audit: passed
timestamp: 2026-10-01T02:57:27Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7 blind rounds, 2026-09-30
**Converged:** Yes (round 7: no blocker, no should-fix)
**Findings:** 1 BLOCKER (round 2, fixed); WARNINGs fixed each round; NITs taken or recorded in the plan

### Validation
Full validation passed on Mortals for 7e6a1fcd3. After rebasing onto main (which touched three of this branch's files,
no conflict), the community and page test files and both browser-check gates pass on the merged tree.

### Iteration 1: 0 BLOCKER, 3 WARNING
- [WARNING] engine/communitysend.js - a 5xx after the commit, or a 201 with an unreadable body, cleared the mark --> FIXED: only a 4xx clears it
- [WARNING] engine/communitysend.js - names the service swaps for its own handle ('/', dots) missed the lookup --> FIXED
- [WARNING] the owner could not see why posts waited --> FIXED: agentNameUnclaimed, through communitymine to the page

### Iteration 2: 1 BLOCKER, 3 WARNING
- [BLOCKER] engine/communitysend.js - a name another install already held, with our first try lost offline, was held forever --> FIXED: registered_at age check
- [WARNING] the page promised an hourly check; the rename wording; tests for delete and page ordering --> FIXED

### Iteration 3: 0 BLOCKER, 2 WARNING
- [WARNING] '@' and invisible-character names the service swaps --> FIXED
- [WARNING] a rename after a 404 registered the old name --> FIXED

### Iteration 4: 0 BLOCKER, 2 WARNING
- [WARNING] braille blank (U+2800) missed --> FIXED: the shared invisible list (feedguard.stripFormatCharacters)
- [WARNING] a name cut through an emoji jammed the lookup URL --> FIXED

### Iteration 5: 0 BLOCKER, 2 WARNING
- [WARNING] an account made well AFTER our try was taken for ours --> FIXED: bounded both sides
- [WARNING] the owner's row flag untested through communitymine --> FIXED

### Iteration 6: 0 BLOCKER, 2 WARNING
- [WARNING] the mark carried the sweep's start time, so a slow sweep misread its own account --> FIXED: the POST's own time
- [WARNING] no test for a missing registered_at --> FIXED

### Iteration 7: 0 BLOCKER, 0 WARNING (CONVERGED)
- [NIT] the plan's counts and round order --> FIXED

Rebased 2026-09-30 22:30 CDT onto main 3b4aa7670 (past the #4796 fix 3b4aa7670): clean, git range-diff shows all 16 commits patch-identical, so the reviewed change is unchanged; diff_hash recomputed for the new base.
