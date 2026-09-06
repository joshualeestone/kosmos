---
pre_challenge: true
method: challenge-loop
branch: 9e-setup-2360
diff_hash: 103b53a4b3627df266e542b49fd19796ab372b88b60254dfe00715ac355400b2
validation: passed
subdir_audit: passed
timestamp: 2026-09-06T23:12:42Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes (iteration 6 found zero new BLOCKER/WARNING/CONVENTION)
**Total findings:** 0 BLOCKERs, 5 WARNINGs (all fixed), 1 CONVENTION (fixed) + 1 recurring CONVENTION (no-plan, fixed), several NITs
**Fixed:** 5 WARNINGs + 2 CONVENTIONs (+ NITs) | **Deferred:** 4 NITs + 1 residual | **Asked:** 0

The change (#2360): the 9e outside-audit compared the served /setup against the LOCAL working tree, but
the deploy ships from origin/main (#2286), so a shared checkout lagging origin false-red'd 9e
(release-exit=1) on the 0.6.40 cut though the served bytes were correct. Fix: compare served vs
origin/main:setup (the deploy source) via a temp file + `[ -s ]` guard; the degraded fallback reports
UNPROVEN both ways (fails closed). Plus a red-capable test wired into test:shell.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 2 WARNINGs, 1 NIT, 1 CONVENTION
- [WARNING] kosmos-artifact-check.sh -- comment overclaimed "can't false-fail" --> FIXED (f24ad6c8): named the origin-advance residual honestly.
- [WARNING] test -- didn't statically assert the `[ -s ]` empty-guard --> FIXED (f24ad6c8): added the static pin.
- [NIT] `[ -d .git ]` misses worktrees --> FIXED: `git rev-parse --git-dir`.
- [CONVENTION] no plan file --> FIXED: added .claude/plans/9e-setup-2360.md.

#### Iteration 2
**New findings:** 1 WARNING, 2 NITs
- [WARNING] test locked the reference STRINGS but not the comparison DIRECTION --> FIXED (0208f38d): pinned `[ $LIVE_SHA = $SRC_SHA ] && ok`.
- [NIT] unbounded fetch --> FIXED: git http.lowSpeedLimit/Time bound. [NIT] fallback ok confidence --> DEFERRED.

#### Iteration 3
**New findings:** 1 WARNING, 2 NITs (comment accuracy)
- [WARNING] the fetch comment overstated the baseline ("the curls use -m 20") --> FIXED (9452a142). [NIT]s connect-phase + ref-only-fetch --> named in the comment.

#### Iteration 4
**New findings:** 1 WARNING, 1 CONVENTION, 2 NITs
- [WARNING] the degraded fallback `ok`'d a local match -- a narrow silent-pass --> FIXED (2fe88e9d): fallback now UNPROVEN both ways (fails closed) + a static pin.
- [CONVENTION] em dashes in the plan file --> FIXED: replaced (plan is clean ASCII). [NIT]s nested-repo + test-replica --> DEFERRED.

#### Iteration 5
**New findings:** 1 WARNING, 1 NIT (test robustness)
- [WARNING] the iter-4 fallback assertion was a vacuous, non-red-capable absence-grep --> FIXED (b74c8e02): a positive pin `unp "served /setup matches the LOCAL`, verified red-capable. [NIT] behavioural-comment overstatement --> FIXED.

#### Iteration 6
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Converged** -- "No issues found"; the one NIT (behavioural test is a re-implementation, well-mitigated by the static pins) was already DEFERRED.

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | WARNING | kosmos-artifact-check.sh | comment overclaimed "can't false-fail" | FIXED | f24ad6c8 |
| 2 | 1 | WARNING | test | no static `[ -s ]` guard assertion | FIXED | f24ad6c8 |
| 3 | 1 | NIT | kosmos-artifact-check.sh | `[ -d .git ]` misses worktrees | FIXED | f24ad6c8 |
| 4 | 1 | CONVENTION | .claude/plans/ | no plan file | FIXED | f24ad6c8 |
| 5 | 2 | WARNING | test | direction not locked | FIXED | 0208f38d |
| 6 | 2 | NIT | kosmos-artifact-check.sh | unbounded fetch | FIXED | 0208f38d |
| 7 | 3 | WARNING | kosmos-artifact-check.sh | comment overstated baseline | FIXED | 9452a142 |
| 8 | 4 | WARNING | kosmos-artifact-check.sh | fallback ok = silent-pass | FIXED | 2fe88e9d |
| 9 | 4 | CONVENTION | .claude/plans/ | em dashes | FIXED | 2fe88e9d |
| 10 | 5 | WARNING | test | fallback assertion vacuous | FIXED | b74c8e02 |

### NITs (deferred)
- fallback ok lower-confidence (iter 2) -- honestly labeled.
- `git rev-parse --git-dir` succeeds for a non-repo dir nested in a repo (iter 4) -- unrealistic ($HOME/work is not a repo).
- the behavioural test re-implements the derivation (iters 1,2,4,5,6) -- mitigated by the static pins; the monolithic check is not isolable for a driven test.

### Deferred residual (documented in the plan + code)
The origin-advance window (origin/main advances between deploy and audit): fails RED not GREEN (blocks
the cut, never ships a bad release), seconds under merge-freeze vs the always-open local-lag window. The
window-free fix (compare vs #2286's SITE_SHA, threaded from release.sh) is a larger change, deferred.

### Strengths (across iterations)
- Fail-closed with no silent-pass: every unconfirmable branch is `bad` or `unp`, both exit 1.
- Temp-file derivation (not `$(...)`) preserves the trailing newline; `[ -s ]` closes the shasum-of-empty hole.
- `git rev-parse --git-dir` robust to worktrees/.git-files; bounded fetch degrades safely.
- The test is red-capable + non-vacuous: all 5 static pins fail against origin/main's pre-fix code; the behavioural half has a discriminating control.
