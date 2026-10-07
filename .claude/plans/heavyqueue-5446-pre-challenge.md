---
pre_challenge: true
method: challenge-loop
branch: heavyqueue-5446
diff_hash: 3daee9273493904dc26f15b1981e32748cdcff8d38e21fd942296140e3e67f21
validation: on main rebased 2026-10-06 22:58 CDT: tools.heavy-gate-3805.test.js + file-scanning guards 73 pass, 0 fail, 1 existing opt-in skip; tools/test-queued-heavy-4977.sh 93/93 OK; bash -n clean; full suite on CI
subdir_audit: not run (no subdirectory CLAUDE.md changed)
timestamp: 2026-10-07T03:59:04Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10
**Converged:** Yes (iteration 10: no issues found)
**Total findings:** 22 actionable (0 BLOCKERs, 19 WARNINGs, 3 CONVENTIONs), plus NITs
**Fixed:** 19 | **Deferred:** 3 | **Asked (awaiting user):** 0

Change: heavy-gate.sh's BUSY answer names a fair-queue command that can run; queued-heavy.sh (repo copies) falls back to the repo's main checkout for its lib when the default folder is missing. Perturbation checks: removing the fallback turns the fallback arm red; removing the main-checkout preference and the installed-copy preference each turn the hint test red.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] queued-heavy.sh: "one lib generation per Mac" overclaimed (multi-clone, installed copy) --> FIXED: narrowed to worktrees of one clone, line names folder and commit
- [WARNING] heavy-gate.sh: hint named the copy beside it (per-branch wrapper generations) --> FIXED: prefers the main checkout's copy
- [CONVENTION] heavy-gate.sh help did not mention the hint; test header invariant stale --> FIXED
- NITs fixed: GIT_DIR ignored, message wording, path quoted

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] fallback does not reach the installed copy (outside any repo) --> FIXED: stated, pinned by a new arm
- [WARNING] hint could name a stale main-checkout copy --> FIXED: only a copy with the fallback marker
- [WARNING] "names its commit" untested (no commit in fixture) --> FIXED: fixture commits, arm asserts a sha

#### Iteration 3
**Reviewer model:** opus
- [WARNING] main-checkout preference untested; marker was a variable name --> FIXED: dedicated '#5446-lib-fallback' marker, repo-plus-worktree test
- [WARNING] hint could name a missing file --> FIXED: names a path only if it exists
- [WARNING] fixture git calls inherited GIT_DIR --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] hint named a marked copy in a checkout with no lib --> FIXED: also requires cut-guard.sh there
- [WARNING] wrapper/lib behaviour skew not stated --> FIXED: stated in the plan

#### Iteration 5
**Reviewer model:** opus
- [WARNING] a main checkout with no lib at all gave no guidance --> FIXED: stop line names it and the pull
- [WARNING] multi-clone mixing should be visible to reviewers --> FIXED: in the PR body
- [WARNING] worktree fallback to MAIN checkout untested --> FIXED: new arm

#### Iteration 6
**Reviewer model:** sonnet
- [WARNING] main checkout may be on a feature branch --> FIXED: line names the branch
- [WARNING] git older than 2.31 --> FIXED: comment (fleet runs 2.53)
- [WARNING] lib could be too old while the wrapper is marked --> DEFERRED: duplicate of iteration 4, stated in the plan

#### Iteration 7
**Reviewer model:** opus
- [WARNING] hint moved agents off the installed copy on the main Mac (two wrapper generations) --> FIXED: installed copy first
- [CONVENTION] queue header disagreed with the hint --> FIXED

#### Iteration 8
**Reviewer model:** sonnet
- [WARNING] installed copy named on a machine without its lib --> FIXED: only with its lib present
- [WARNING] first hint test depended on the machine's installed copy --> FIXED: pinned

#### Iteration 9
**Reviewer model:** opus
- [WARNING] set-but-wrong QUEUED_HEAVY_LIB: every copy refuses, hint still named one --> FIXED: hint names the bad variable
- [WARNING] selection tests ran with QUEUED_HEAVY_LIB set, never the unset case --> FIXED: throwaway HOME, wrong-variable case plus control
- [WARNING] installed copy chosen on lib presence, not freshness --> DEFERRED: stated in the plan (the #4977 case, unchanged)
- [CONVENTION] header, git-version comment, plan first bullet, worktree arm comment inexact --> FIXED

#### Iteration 10
**Reviewer model:** opus
**New findings:** none. **Converged.**

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status |
|---|------|----------|------|--------|-------------|--------|
| 1-4 | 1 | WARNING/CONVENTION | heavy-gate.sh, queued-heavy.sh | BRANCH | generation claim, hint copy, help, test header | FIXED |
| 5-7 | 2 | WARNING | both + test | SELF | installed copy scope, stale copy, untested sha | FIXED |
| 8-10 | 3 | WARNING | both + tests | SELF | untested preference, missing file, inherited GIT_DIR | FIXED |
| 11-12 | 4 | WARNING | heavy-gate.sh, plan | SELF | marked copy without lib, skew unstated | FIXED |
| 13-15 | 5 | WARNING | queued-heavy.sh, tests | SELF | no-lib guidance, PR note, worktree arm | FIXED |
| 16-18 | 6 | WARNING | queued-heavy.sh | SELF | branch, git floor; lib age | FIXED, FIXED, DEFERRED |
| 19-20 | 7 | WARNING/CONVENTION | heavy-gate.sh, header | SELF | installed copy first | FIXED |
| 21-22 | 8 | WARNING | heavy-gate.sh, test | SELF | installed copy without lib, test pinning | FIXED |
| 23-26 | 9 | WARNING/CONVENTION | heavy-gate.sh, tests, plan | SELF | wrong QUEUED_HEAVY_LIB, unset-case tests; lib freshness | FIXED; DEFERRED |

### NITs (non-blocking)
- [NIT] a path containing a single quote breaks the quoted command in the hint (not realistic for checkout paths)
- [NIT] HOME unset makes the hint path empty (exit code unchanged)

### Strengths
- The stdout verdict stays one line; the hint is stderr only and never with --quiet
- Every fallback arm has a control that can return the dangerous answer; each direct run keeps an in-test marker dir and a deadline
