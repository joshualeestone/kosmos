---
pre_challenge: true
method: challenge-loop
branch: promote-2195
diff_hash: addfa40476b0035e948190431475469f521d1963c6f175fc758201048a112591
validation: passed
subdir_audit: passed
timestamp: 2026-09-05T07:22:00Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (2 original + 2 re-reviews after CI's meta-guards flagged the new test)
**Converged:** Yes (the final blind pass produced zero NEW BLOCKER/WARNING/CONVENTION)
**Total findings:** 0 BLOCKERs, 2 WARNINGs (1 fixed, 1 deferred), 0 CONVENTIONs, 6 NITs
**Fixed:** 3 (1 WARNING + 2 CI-meta-guard-mandated fixes) | **Deferred:** 6 | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
0 BLOCKERs, 2 WARNINGs.
- [WARNING] sha256-name.sh sourced without a precondition check --> FIXED (064072fe).
- [WARNING] $WINZIP hardcode likelier to trip a version-bump promote --> DEFERRED (pre-existing #2008; fail-safe; docs note 064072fe).

#### Iteration 2
0 new actionable (1 dup of the $WINZIP finding), 3 NITs (greedy sed; sha256_publish_as set -e path; additive vercel stub) - all DEFERRED (fail-safe/unreachable/covered).

#### Iteration 3 (re-review after wiring the test into test:shell)
Between iter 2 and 3, CI's `tools.every-test-runs.test.js` flagged the new test as unwired (an
unarmed guard). FIXED (d881ada6): wired into test:shell + `bash -n tools/deploy-site.sh`. Blind
pass then found 0 BLOCKER/WARNING, 2 NITs (post-fetch comment overbroad for the promote alias;
flag parse reads only $1) - DEFERRED.

#### Iteration 4 (re-review after the zsh-tied-name fix)
Between iter 3 and 4, CI's `tools/test-zsh-tied-names.sh` flagged the stub curl's `path=` local
(zsh ties `path` to PATH; a file writing it is refused statically). FIXED (d307f8c7): renamed to
served_file, no behavior change; verified locally that test-zsh-tied-names, test-grep-code,
every-test-runs, and the test itself all pass. Blind pass over the final diff then found:
0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs:
- [NIT] flag parse reads only $1 (dup of iter-3 NIT; fails safe; documented invocation is --promote alone) --> DEFERRED.
- [NIT] test make_scenario declares `local s live d` but `d` is unused --> DEFERRED (cosmetic; not fixed to avoid another proof-regen cycle).
- [NIT] case 6 only proves the guard still fires on a moved pointer, not a valid dry-run proceeding (covered by test-site-deploy-export.sh) --> DEFERRED.
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | WARNING | tools/deploy-site.sh | sha256-name.sh no precondition check | FIXED | 064072fe |
| 2 | 1 | WARNING | tools/deploy-site.sh | $WINZIP hardcode on version-bump promote | DEFERRED | pre-existing #2008; docs note |
| 3 | 2 | NIT | tools/deploy-site.sh | greedy sed | DEFERRED | fail-safe |
| 4 | 2 | NIT | tools/deploy-site.sh | sha256_publish_as set -e path | DEFERRED | unreachable |
| 5 | 2 | NIT | tools/test-deploy-site-promote.sh | additive vercel stub | DEFERRED | honest-marker covers it |
| 6 | 3 | (fix) | package.json | test unwired (CI meta-guard) | FIXED | d881ada6 |
| 7 | 3 | NIT | tools/deploy-site.sh | post-fetch comment overbroad for promote alias | DEFERRED | correctness unaffected |
| 8 | 3/4 | NIT | tools/deploy-site.sh | flag parse reads only $1 | DEFERRED | fail-safe; matches existing |
| 9 | 4 | (fix) | tools/test-deploy-site-promote.sh | stub `path=` trips zsh-tied-name guard (CI) | FIXED | d307f8c7 |
| 10 | 4 | NIT | tools/test-deploy-site-promote.sh | unused `local d` | DEFERRED | cosmetic |
| 11 | 4 | NIT | tools/test-deploy-site-promote.sh | case 6 coverage note | DEFERRED | covered elsewhere |

### Strengths (across iterations)
- Guard-skip is surgical: committed-vs-live guard skipped ONLY under `if [ "$PROMOTE" = 1 ]`; site-copy/dry-run byte-for-byte unchanged, proven by red-capable controls (test cases 2 and 6).
- The skipped guard is replaced by a STRONGER three-way check: fetch + sha-verify from live, pin the committed pointer's sha (CSHA) to those bytes, plus nothing-to-promote and empty-field refusals. To ship wrong bytes, served bytes + live sidecar + committed pointer must all agree on the wrong value.
- The alias is DERIVED byte-identically from the promoted artifact (cp + sha256_publish_as self-verify), mirroring promote-channel.sh #2036, avoiding the #1669 stale-fallback; NOT keyed to latest-staging.json so rollback works.
- Honest self-contained integration test: stubs only curl + vercel on PATH, runs the REAL libs + script, mktemp + EXIT trap (no repo side effects), every assertion has a control that can return the dangerous answer; both core behaviors proven red-capable by breaking the code; now wired into test:shell and actually invoked.
- No programmatic callers of deploy-site.sh, so the case-statement flag refactor is regression-free. Docs use conventions-correct git; zero em dashes in changed files.
