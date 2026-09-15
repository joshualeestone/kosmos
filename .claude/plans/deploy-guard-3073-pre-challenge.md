---
pre_challenge: true
method: challenge-loop
branch: deploy-guard-3073
diff_hash: f912ada76f9b70b1ca4b9ef9bceb294d52fe34dfa0a6b3b571509ed32af05c0a
validation: passed
subdir_audit: passed
timestamp: 2026-09-15T06:21:06Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 surfaced zero BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 1 BLOCKER, 1 WARNING, 3 NITs
**Fixed:** 4 | **Deferred:** 1 (documented convention NIT) | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1 (6.0 initial validation pass)
**Reviewer model:** n/a (validation helpers)
**New findings:** 0 (baseline clean on the first pass -- node 7552/0, and the new guard test ran green in test:shell)
**Self-generated:** 0

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 1 WARNING, 2 NITs
**Self-generated:** 0 (on the branch build commit dd79f9f01 = BRANCH)
- [BLOCKER] the new guard silently made three pre-existing tests
  (test-deploy-site-{promote,winderive,exit0-2791}.sh) depend on the ambient git init.defaultBranch:
  they build a fake $SITE with a bare `git init` and no origin, so the guard's default falls back to
  'main' while the fixture's branch is whatever the ambient default produces -- on a non-main-default
  box the guard would refuse their --publish/--promote and red three green test:shell tests (it
  passed here only because this box defaults to main) --> FIXED (f5dcbe03d): pinned all four fixture
  inits to `git init --initial-branch=main` (the established pattern from test-release-detached.sh),
  PROVEN under GIT_CONFIG_GLOBAL forcing init.defaultBranch=master (all four tests still pass).
- [WARNING] arg parsing changed from `case $1` to a loop over `"$@"`, so the flags now match in any
  position, not just first --> addressed: backward-compatible for every caller in the tree (each
  passes <=1 flag), and already documented in the deploy-site.sh arg-parse comment for auditors.
- [NIT] dead GUARD_MARK variable in the new test --> FIXED (f5dcbe03d): removed.
- [NIT] plan filename omits the -<timestamp> suffix --> DEFERRED: accepted local practice (several
  committed plans in this repo omit it, e.g. winzip-2571.md, promote-2195.md); the pre-challenge-gate
  keys on <branch>-pre-challenge.md, which is correct.

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
**Converged** -- six STRENGTHs: guard logic correct on every edge (dry-run/--force skip, --promote
covered, detached-HEAD safe-refuse, no legit-main-refuse, no feature-branch-slip), POSIX-sh clean,
non-vacuous tests, the ambient-default class fully closed (swept every deploy-site.sh reference:
only the pinned fixtures git-init a fake $SITE; promote-channel.sh/post-release-notes.sh only print
the command; test-staging-wire's unpinned init exercises release_site_restore, not a deploy),
minimal pipeline regression risk (release.sh does not invoke deploy-site.sh; it is operator-invoked),
and defensible merge posture + part-4 deferral.
- [NIT] the winderive fixture pin is not load-bearing (winderive is dry-run-only, so the guard never
  fires there) --> FIXED (73c7d9f60): documented in the plan precisely which pins are load-bearing
  (exit0-2791 + promote) vs defensive-consistency (winderive).
- [NIT] the 'default read from origin/HEAD not hardcoded main' property was only source-grepped (A3),
  never runtime-tested for a genuinely non-main default --> FIXED (73c7d9f60): added B5 (a fabricated
  origin/HEAD=trunk site, ON trunk, publishes fine) + B6 control (the same trunk-default site ON main
  is REFUSED, since main != the derived default), proving the default is derived, not hardcoded.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 2 | BLOCKER | tools/test-deploy-site-{promote,winderive,exit0}.sh | BRANCH | guard made fixtures depend on ambient init.defaultBranch | FIXED | f5dcbe03d |
| 2 | 2 | WARNING | tools/deploy-site.sh | BRANCH | arg-parse loop broadens flag matching to any position | ADDRESSED (documented; backward-compatible) | dd79f9f01 comment |
| 3 | 2 | NIT | tools/test-deploy-site-branch-guard-3073.sh | BRANCH | dead GUARD_MARK var | FIXED | f5dcbe03d |
| 4 | 2 | NIT | .claude/plans/deploy-guard-3073.md | BRANCH | plan filename omits -<timestamp> | DEFERRED | accepted local practice |
| 5 | 3 | NIT | tools/test-deploy-site-winderive.sh | BRANCH | pin not load-bearing (dry-run-only) | FIXED | 73c7d9f60 (documented) |
| 6 | 3 | NIT | tools/deploy-site.sh | BRANCH | origin/HEAD-derived default only source-tested | FIXED | 73c7d9f60 (B5/B6 runtime) |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking)
- Plan filename omits the -<timestamp> suffix (iteration 2, DEFERRED as accepted local practice).

### Strengths (across all iterations)
- Guard correct on every edge: gated on PUBLISH=1 && FORCE!=1 (dry-run + --force skip); --promote
  sets PUBLISH=1 so promote is covered; detached HEAD -> empty -> safe-refuse; a legit main deploy is
  never wrongly refused and a feature branch cannot slip through (iteration 3).
- The ambient-default-dependency class is fully closed for the publish path (every deploy-site.sh
  reference swept; nothing missed) (iteration 3).
- Minimal release-pipeline regression risk: release.sh does not invoke deploy-site.sh; the guard's
  blast radius is exactly the operator-invoked manual publish path (iteration 3).
- Tests are non-vacuous: B2 is a real branch-specific control, B6 a real derived-default control, and
  the fixture pin is proven under a forced non-main ambient default (iterations 2, 3).

### Scope / deferral
The 'also (minor)' served-verify HEAD-for-large-artifacts item (#3073 part 4) is deliberately
deferred to Baron (pipeline owner) or a scoped follow-up: it touches the shared tools/lib/served-verify.sh
and its formatting-frozen mock-server test, higher-risk release infrastructure than a night-shift
best-effort warrants. This PR ships the deploy-guard (the fix for the actual investor-facing
regression). See the plan's "Deferred" and "Weakest premise" sections.

### Merge posture
tools/deploy-site.sh carries Baron's explicit #2014 ownership marker and --publish is a live
`vercel deploy --prod` on the investor-facing site, so this PR REQUESTS Baron's review before merge
rather than auto-merging green (a reasoned deviation from merge-own-green for another owner's blessed
safety-critical script). Splinter is tracking that it lands as a reviewed merge.
