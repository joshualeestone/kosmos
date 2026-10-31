---
pre_challenge: true
method: challenge-loop
branch: followhandle-7660
diff_hash: 69925489c5d8cfe0b501f1fbef269f42fc1a73079850232bbbb466fac8fcfe68
validation: not clean locally. Validation 1 (d5fd4f3c2f) had one red, a source pin on agentCall's timer text that this branch rewrote on purpose; the pin was updated (its control fails on the old text). Validations 2 and 3 (5a2bb9e91c): 25926 tests, 25518 pass, 407 skipped, 1 fail each, the same test, tools.prove-it-fails-restore-7619.test.js (a killed process still alive after 10 s under full-suite load). That test runs in its own throwaway git repo, so this branch cannot reach it; it passed in validation 1, passes alone 2/2 on this head, and passed in four other branches' latest full runs. The PR's CI (node and shell suites on the merge with current main) is the clean full run, and it merges only on that.
subdir_audit: not run (no subdir CLAUDE.md in the diff)
timestamp: 2026-10-30T23:54:30Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 blind rounds on the whole branch, models alternating (Opus, Sonnet x4 each); rounds 5 to 8 treated nothing as settled; round 8 (the last) found no BLOCKER and no code changed after it.
**Converged:** Yes

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [BLOCKER, provisional] a large profile past the answer cap read as "no such handle" --> FIXED (PROFILE_CAP, an unreadable 200 is an error)
- [WARNING] the lookup ignored the company policy --> FIXED; follow could pass the CLI wait --> FIXED (chain wait from budgetFrom)

#### Iteration 2
**Reviewer model:** sonnet
- no BLOCKER; follow allowance only on a resolved name, the follow's own words with the public community off --> FIXED

#### Iteration 3
**Reviewer model:** opus
- [WARNING] take-backs by handle refused while the public community is off --> FIXED; lookups unlimited --> FIXED (own allowance); policy refusal unrecorded --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] handle-shaped display names refused when the lookup failed --> FIXED (a bare word is a handle only on a clear 200); allowance spent before the gates --> FIXED

#### Iteration 5
**Reviewer model:** opus
- [WARNING] false "no agent" for an unchecked handle --> FIXED (note); capitalised names looked up --> FIXED (shape as typed); 429 words --> FIXED

#### Iteration 6
**Reviewer model:** sonnet
- [WARNING] allowance-spent note, a policy refusal recorded twice --> FIXED

#### Iteration 7
**Reviewer model:** opus
- [WARNING] "Do not try again this hour" though names still work --> FIXED; PowerShell quoting --> FIXED (Windows usage note)

#### Iteration 8
**Reviewer model:** sonnet
- no BLOCKER; two warnings already decided (reasons in .claude/plans/followhandle-7660.md)
