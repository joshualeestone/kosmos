---
pre_challenge: true
method: challenge-loop
branch: pr-browser-gate-2445
diff_hash: 7b507eb1cf49eed67d926f3f8030027d01c63c70bc8fdea43f40ceb55008254c
validation: passed
subdir_audit: passed
timestamp: 2026-09-07T23:49:44Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5 blind independent passes
**Converged:** Yes (iteration 5 returned no findings)
**Total findings:** 8 (0 BLOCKERs, 4 WARNINGs, 4 NITs)
**Fixed:** 7 | **Deferred:** 1 | **Asked:** 0

Card #2445: run the cut-time page-layer browser checks (`tools/browser-checks.sh`) in the per-PR gate,
so a rendered-behavior change fails at PR instead of at cut (measured: #2085 flaked 0.6.47 twice).
Adds a path-filtered `browser-checks.yml` CI job on macos-latest, a `test:shell` guard test pinning
its invariants, and registers it. Baron (#2444) scoped and confirmed the design.

### Per-Iteration Breakdown

#### Iteration 1
- [WARNING] the paths filter is narrower than the surfaces that drive rendered behavior (server.js/engine data feeds the checks) --> DOCUMENTED as caveat 3: adding engine/**/server.js would fire the ~15-20min suite on most PRs and defeat the load-scoping, so the narrow filter is deliberate and the cut's 3b is the backstop.
- [NIT] no Playwright caching --> DEFERRED (runs are path-filtered/infrequent; fresh provision avoids cache-staleness).

#### Iteration 2
- [NIT] the guard test's path loop pinned only 3 of 5 filter entries --> FIXED: pins all entries.
- [NIT] no note on the required-status-check + path-filter deadlock --> FIXED: added the warning.

#### Iteration 3
- [WARNING] test-support/ (fleet.js + fake-tmux.sh, a hard dep) omitted from the filter -- a CHEAP leak (rarely touched, unlike engine/**) --> FIXED: added test-support/** to the filter + pinned it in the guard test; clarified caveat 3.
- [NIT] the guard test did not check YAML parseability --> FIXED: added a ruby-guarded parse assertion (broken indentation now reds it).

#### Iteration 4
- [WARNING] the iter-3 "cheap leaks ARE closed" claim was imprecise (browser-checks.sh also sources tools/lib/cut-guard.sh + browser-run-log.sh, not in the filter) --> FIXED by REWORDING (not widening to tools/lib/**, which would over-trigger on release-tooling PRs): stated precisely and verified that those libs each have their own test:shell guard firing on every PR, and release-freeze.sh is unreachable on the CI detached-HEAD path -- so the one genuinely uncovered leak is the engine/server DATA.

#### Iteration 5
**No findings.** Three STRENGTHs, independently verified: the guard test is non-vacuous (list-item-form path assertions cannot false-pass on the header prose; the YAML-parse arm is real); the workflow cannot false-green (strict-version fail-closed, no skip env set, every early exit reds the job); and caveat 3's claims are factually true (the two sourced libs have real test:shell guards; release-freeze.sh is behind the attached-branch arm). **Converged.**

### Final Ledger

| # | Iter | Category | Description | Status |
|---|------|----------|-------------|--------|
| 1 | 1 | WARNING | engine/server data trigger leak | DOCUMENTED (deliberate, cut is backstop) |
| 2 | 1 | NIT | no Playwright caching | DEFERRED |
| 3 | 2 | NIT | guard pinned 3/5 filter entries | FIXED |
| 4 | 2 | NIT | no required-check deadlock note | FIXED |
| 5 | 3 | WARNING | test-support/ omitted (cheap leak) | FIXED (added to filter) |
| 6 | 3 | NIT | guard did not check YAML parse | FIXED |
| 7 | 4 | WARNING | imprecise completeness claim | FIXED (reworded + verified) |
| - | 5 | - | no findings | CONVERGED |

### Deferred
- Playwright runtime caching (iter 1 NIT): a cheap CI-time speedup, deferred because runs are
  path-filtered/infrequent and fresh provision avoids cache-staleness. Noted in the plan.

### Strengths (across iterations)
- The workflow is fail-closed (KOSMOS_PW_STRICT_VERSION=1, no skip env) with no false-green path;
  fork-PR safe (pull_request + contents:read); correct on a CI detached-HEAD checkout (no-freeze path).
- The guard test discriminates on real perturbations (every arm reds when its invariant breaks; the
  path assertions match the YAML list-item form, not a bare string the header prose would satisfy).
- The design correctly isolates the browser load off the fleet box (CI, not local) and documents its
  honest limits (intra-run contention, headless SwiftShader, the engine/server trigger leak).
