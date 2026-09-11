---
pre_challenge: true
method: challenge-loop
branch: node-runtime-cache
diff_hash: 04f90850f685ef4dcafd91ae70eceef884468006e73f57be18aed4da33c84807
validation: passed
subdir_audit: passed
timestamp: 2026-09-11T07:49:09Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7
**Converged:** Yes (iteration 7 found zero NEW BLOCKER/WARNING/CONVENTION; only two non-actionable NITs)
**Total findings:** 8 BLOCKERs 0, 8 WARNINGs, 1 CONVENTION, 7 NITs (across all iterations), plus many STRENGTHs
**Fixed:** 12 | **Deferred:** 4 | **Asked (awaiting user):** 0

The change is critical build/release tooling: `tools/build-kosmos-bundle.sh` caches node's ~35MB
runtime tarball across cuts. Every iteration confirmed the PRODUCT-CODE security invariant is sound
(the bytes actually used, cached or downloaded, are checksum-verified against a freshly-fetched
nodejs.org SHASUMS256 before `tar -xzf`; the source is hardcoded to nodejs.org). The loop's findings
were almost entirely about hardening the STRUCTURAL wiring test so it genuinely guards that invariant
and cannot pass vacuously. The reviewer model was alternated opus/sonnet across iterations, so the
convergence is witnessed by both models.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above (first blind pass; no loop fix commits existed yet)
- [WARNING] tools/test-node-runtime-cache.sh:42 — test proved verify-after-cache-hit but not the "before extraction" half --> FIXED (b22e7210: added a `tar -xzf` anchor T and assert T>V)
- [WARNING] tools/test-node-runtime-cache.sh:1 — structural test could miss a cache-hit copy to a non-verified destination --> FIXED (b22e7210: added C anchor tying the cache-hit copy to the verified `$TMP/$TARBALL`, assert V>C)
- [NIT] tools/build-kosmos-bundle.sh:523 — cache-hit read `cp` was not best-effort (a copy failure aborted the cut) --> FIXED (b22e7210: moved the cp into the if-condition so a failed read falls back to download)
- [NIT] tools/test-node-runtime-cache.sh:34 — brittle populate-gate anchor (`= "$WANT" ] \`) --> FIXED (b22e7210: content-based anchor)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above (the populate-gate anchor was written by iteration 1)
- [WARNING] tools/test-node-runtime-cache.sh:44-47 — the populate assertion anchored on `mkdir` alone, decoupling it from the checksum gate --> FIXED (82b6183a: re-anchored to the checksum-gate `if [ "$(shasum ... "$TMP/$TARBALL"` line, keeping both robustness and coupling)
- [NIT] tools/build-kosmos-bundle.sh:538,551 — the downloaded tarball is hashed twice on a cache-miss --> DEFERRED: ~50ms over 35MB, negligible vs the multi-second download it accompanies; the separate populate checksum gate is intentional defense-in-depth; restructuring the security-critical verify/populate flow is disproportionate risk
- [NIT] .claude/plans/node-runtime-cache.md — plan filename omits the `<branch>-<timestamp>` suffix --> FIXED later (iteration 4, 7bf0b7bd)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above (the two gaps were absences of guards; `ln` predates this loop)
- [WARNING] tools/test-node-runtime-cache.sh — the load-bearing "source hardcoded to nodejs.org" invariant was unguarded --> FIXED (54fb2c67: assert BASE is the hardcoded nodejs.org literal, no env override)
- [WARNING] tools/test-node-runtime-cache.sh — the errexit "never fail a cut" availability promise (`|| :`, read-in-if) was untested --> FIXED (54fb2c67: two assertions pinning both best-effort halves)
- [NIT] tools/test-node-runtime-cache.sh:16 — helper `ln` shadows the coreutil --> FIXED (54fb2c67: renamed to `line_of`)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 3 NITs
**Self-generated:** 1 of the above (the source-pin assertion was written by iteration 3)
- [WARNING] tools/test-node-runtime-cache.sh:24-27 — the source-pin only caught the `BASE="${...}"` shape and the comment overclaimed --> FIXED (7bf0b7bd: assert BASE is assigned EXACTLY ONCE and that one is the hardcoded literal; comment now states it is a structural proxy)
- [CONVENTION] .claude/plans/node-runtime-cache.md — filename lacks the `<branch>-<timestamp>` suffix required by CLAUDE.md --> FIXED (7bf0b7bd: renamed to node-runtime-cache-20260911T0138.md)
- [NIT] tools/build-kosmos-bundle.sh — no cache-retention policy --> DEFERRED: node version bumps are infrequent, each tarball ~35MB; bounding growth is out of scope for the caching lever
- [NIT] tools/build-kosmos-bundle.sh:545-547 — a SIGKILL between cp and mv orphans a `.$TARBALL.$$` dotfile --> DEFERRED: harmless (never matches the cache-read check), accrues only on interrupted cuts
- [NIT] tools/build-kosmos-bundle.sh:515 — HOME unset under `set -u` would abort --> DEFERRED: purely theoretical on this Mac-only tool where HOME is always set

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 1 of the above (the base_defs line-count was written by iteration 4)
- [WARNING] tools/test-node-runtime-cache.sh:48-52 — the V>C/T>V ordering proxy cannot see the final verify being made CONDITIONAL (e.g. wrapped in `if [ "$NODE_CACHED" -eq 0 ]`) --> FIXED (f8c5e222: assert exactly one NODE_CACHED conditional, red-capable verified)
- [NIT] tools/test-node-runtime-cache.sh:35 — `base_defs` counted lines not occurrences (same-line double-assignment blind spot) --> FIXED (f8c5e222: switched to `grep -oE | wc -l`)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 1 of the above (the nc_conds guard was written by iteration 5)
- [WARNING] tools/test-node-runtime-cache.sh:70-77 — nc_conds catches ADDING a second NODE_CACHED conditional but not EXTENDING the existing gate's `fi` past the verify --> FIXED (df30f10c: added a shape-B assertion that exactly two `fi` sit between the gate and the verify; red-capable verified)
- [NIT] tools/build-kosmos-bundle.sh:538 — double-hash on cache-miss (duplicate of iteration 2) --> DEFERRED (same reasoning)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
**Converged** — six STRENGTHs, no actionable findings. The two NITs are non-actionable: the
nc_conds/fis_between assertions are an intentional "force a deliberate review of this block"
tripwire the reviewer endorses for critical build tooling, and the inline cache-path literal is
"not a real convention break" (consistent with the script's existing inline style).

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | test:42 | BRANCH | before-extraction half unguarded | FIXED | b22e7210 |
| 2 | 1 | WARNING | test:1 | BRANCH | structural test could miss a non-verified copy dest | FIXED | b22e7210 |
| 3 | 1 | NIT | build:523 | BRANCH | cache-hit read not best-effort | FIXED | b22e7210 |
| 4 | 1 | NIT | test:34 | BRANCH | brittle populate anchor | FIXED | b22e7210 |
| 5 | 2 | WARNING | test:44 | SELF | populate assertion decoupled from checksum | FIXED | 82b6183a |
| 6 | 2 | NIT | build:538 | BRANCH | double-hash on cache-miss | DEFERRED | negligible; disproportionate risk |
| 7 | 2 | NIT | plan | BRANCH | plan filename lacks timestamp | FIXED | 7bf0b7bd |
| 8 | 3 | WARNING | test | BRANCH | source-pin invariant unguarded | FIXED | 54fb2c67 |
| 9 | 3 | WARNING | test | BRANCH | errexit availability promise untested | FIXED | 54fb2c67 |
| 10 | 3 | NIT | test:16 | BRANCH | `ln` shadows coreutil | FIXED | 54fb2c67 |
| 11 | 4 | WARNING | test:24 | SELF | source-pin too narrow, comment overclaimed | FIXED | 7bf0b7bd |
| 12 | 4 | CONVENTION | plan | BRANCH | plan filename convention | FIXED | 7bf0b7bd |
| 13 | 4 | NIT | build | BRANCH | no cache-retention policy | DEFERRED | out of scope for caching lever |
| 14 | 4 | NIT | build:545 | BRANCH | SIGKILL orphans a dotfile | DEFERRED | harmless; interrupted-cut-only |
| 15 | 4 | NIT | build:515 | BRANCH | HOME-unset under set -u | DEFERRED | theoretical; HOME always set |
| 16 | 5 | WARNING | test:48 | BRANCH | verify could be made conditional | FIXED | f8c5e222 |
| 17 | 5 | NIT | test:35 | SELF | base_defs counted lines not occurrences | FIXED | f8c5e222 |
| 18 | 6 | WARNING | test:70 | SELF | fi-extension conditionalizing shape unguarded | FIXED | df30f10c |
| 19 | 7 | NIT | test:70 | SELF | guard brittleness (deliberate tripwire) | DEFERRED | intentional, reviewer-endorsed |
| 20 | 7 | NIT | build:515 | BRANCH | inline cache-path literal | DEFERRED | consistent with script style |

### Outstanding questions (ASKED, still unresolved)
None.

### NITs (non-blocking, across all iterations)
- Double-hash on cache-miss (iter 2, 6) — deferred; ~50ms over 35MB, negligible vs the download.
- No cache-retention policy (iter 4) — deferred; infrequent node bumps.
- SIGKILL orphans a `.$TARBALL.$$` dotfile (iter 4) — deferred; harmless, interrupted-cut-only.
- HOME-unset under set -u (iter 4) — deferred; theoretical on this Mac-only tool.
- Guard brittleness of nc_conds/fis_between (iter 7) — deferred; intentional tripwire for critical tooling.
- Inline cache-path literal vs SCREAMING_CASE constant (iter 7) — deferred; consistent with existing style.

### Strengths (across all iterations)
- The security invariant is airtight end to end: cached and downloaded bytes funnel into one
  `$TMP/$TARBALL`, verified unconditionally before `tar -xzf`; the source is a single hardcoded
  nodejs.org assignment; NODE_SHA/manifest (#776) records the verified bytes actually used.
- The double-verify closes the cache-read TOCTOU: the pre-copy sha check enables self-repair
  (poisoned cache -> re-download -> atomic-rename repair) while the final verify re-checks the
  copied bytes, so unverified bytes can never reach extraction.
- Errexit correctness under `set -euo pipefail`: cache-read cp inside the if-condition, best-effort
  write ending in a load-bearing `|| :`, atomic PID-suffixed rename safe under concurrent cuts.
- The wiring test's anchors are unique and non-vacuous; every ordering/count assertion is red-capable
  against the specific regression it names, and the test runs under `#!/bin/bash` so grep dialect is
  correct (system BSD grep, not the interactive-zsh ugrep).
- Honest scoping: the plan and comments state the test guards STRUCTURE (no in-suite network) while
  behavioural hit/miss/poison correctness was proven by hand against real bytes.
