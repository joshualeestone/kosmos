---
pre_challenge: true
method: challenge-loop
branch: guide-hide-3739
diff_hash: f8b17d08dd1a997d351f56e8b1d342788c1a4c6e1b019ca641266719d36a5885
validation: passed
subdir_audit: passed
timestamp: 2026-09-25T16:16:44Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4: no BLOCKER, WARNING or CONVENTION)
**Total findings:** 1 BLOCKER, 12 WARNINGs, 0 CONVENTION, 4 NITs
**Fixed:** all BLOCKERs and WARNINGs | **Deferred:** 2 (named in the plan and PR) | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [BLOCKER] server.js - an OFFLINE guide was still counted in the total and needs-you --> FIXED 1e98fcaa (filtered; offline-guide test)
- [WARNING] web dmTotal summed every agent --> FIXED 1e98fcaa
- [WARNING] the ring change was dead code (grid cards no longer include the guide) --> FIXED 1e98fcaa (removed; ring named as not done)
- [WARNING] markGuide's model line broke the OpenAI model picker --> FIXED 1e98fcaa (Claude only)
- [WARNING] an 'unchecked' removed list left the guide unmarked --> FIXED 1e98fcaa
- [WARNING] the browser check's banner assertion was blind --> FIXED 1e98fcaa (control that the banner is present)
- [NIT] say why dependsOnClaude includes the guide --> FIXED 1e98fcaa

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] the browser check read a nonexistent LISTED global --> FIXED f55d9c5e (reads the drawn DOM)
- [WARNING] a regex replace corrupted a comment in web/index.html --> FIXED f55d9c5e (restored from origin/main)
- [WARNING] 17 inline copies of the isGuide filter --> DEFERRED (a shared helper broke three extracted-snippet web tests; measured; reason in the plan)
- origin/main (#3734) merged in (fada449c), conflicts kept both sides

#### Iteration 3
**Reviewer model:** opus
- [WARNING] plan and a tile comment described the old LISTED array --> FIXED 86b49fe2
- [WARNING] no test of markGuide's runner guard, or of the 'unchecked' fallback --> FIXED 86b49fe2 (both tests)
- [NIT] shadowed variable in paintReportsTo --> FIXED 86b49fe2
- [NOTE] the guide's own attention state is now shown nowhere --> DEFERRED (bubble follow-up; on the card)

#### Iteration 4
**Reviewer model:** opus
**New findings:** 0 BLOCKER, 0 WARNING, 2 NITs (case-sensitive name match that cannot differ today; the tour now shows for a guide-only board). Both disclosed in the PR.

### Validation
tools/run-tests.sh rc=0 and validation_log_run_or_skip PASSED at hash f8b17d08dd1a (2026-09-25 ~11:15 CDT).
