---
pre_challenge: true
method: challenge-loop
branch: promote-2195
diff_hash: c1968b5eb82ecda28cf8790a428d385d0e04e21acd9838283771dec98ddbcef3
validation: passed
subdir_audit: passed
timestamp: 2026-09-05T06:56:00Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (2 original + 1 re-review after wiring the test into test:shell)
**Converged:** Yes (the final blind pass produced zero NEW BLOCKER/WARNING/CONVENTION)
**Total findings:** 0 BLOCKERs, 2 WARNINGs (1 fixed, 1 deferred), 0 CONVENTIONs, 5 NITs
**Fixed:** 2 (1 WARNING + the test:shell wiring, which CI's every-test-runs meta-guard flagged) | **Deferred:** 6 | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 0 NITs
- [WARNING] tools/deploy-site.sh (sha256-name.sh sourced with no precondition existence check) --> FIXED (064072fe): promote-guarded precondition check added, verified it fires with a clear message.
- [WARNING] tools/deploy-site.sh ($WINZIP hardcode likelier to trip on a version-bump promote) --> DEFERRED: pre-existing #2008, fail-safe; surfaced in docs (064072fe); durable fix is #2008.

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs (after dedup), 0 CONVENTIONs, 3 NITs
**Duplicates:** 1 (the $WINZIP gotcha re-raised).
- [NIT] greedy sed in ptr_artifact/ptr_sha (fail-safe; one real sha256; matches existing style) --> recorded.
- [NIT] sha256_publish_as set -e path (unreachable; $ART.sha256 verified first; same refuse outcome) --> recorded.
- [NIT] additive vercel stub in the test (honest-marker check covers the drop class) --> recorded.

#### Iteration 3 (re-review after the test:shell wiring fix)
Between iter 2 and iter 3, CI's `tools.every-test-runs.test.js` meta-guard flagged the new test as
unwired (an unarmed guard). FIXED (d881ada6): wired `bash tools/test-deploy-site-promote.sh` into
`test:shell` (next to test-site-deploy-export) plus a `bash -n tools/deploy-site.sh` syntax check;
verified the meta-test passes (fail 0) and the test is invoked from the repo root. A fresh blind pass
over the full diff (including the wiring) then found:
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
- [NIT] tools/deploy-site.sh (post-fetch comment "each sha-verified against live" is slightly overbroad for the promote alias, which is DERIVED + self-verified rather than fetched-and-verified-against-live; correctness unaffected) --> recorded.
- [NIT] tools/deploy-site.sh (flag parse reads only $1, so `--publish --promote` wrong-order runs site-copy; matches pre-existing "unknown args -> dry run", fails safe, documented invocation is `--promote` alone) --> recorded.
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | tools/deploy-site.sh (preconditions) | sha256-name.sh sourced without a precondition check | FIXED | 064072fe |
| 2 | 1 | WARNING | tools/deploy-site.sh (win-zip check) | $WINZIP hardcode likelier to trip a version-bump promote | DEFERRED | pre-existing #2008; fail-safe; docs note |
| 3 | 2 | NIT | tools/deploy-site.sh (ptr_ helpers) | greedy sed | DEFERRED | fail-safe + existing style |
| 4 | 2 | NIT | tools/deploy-site.sh (alias derive) | sha256_publish_as set -e path | DEFERRED | unreachable; same outcome |
| 5 | 2 | NIT | tools/test-deploy-site-promote.sh | additive vercel stub | DEFERRED | honest-marker covers it |
| 6 | 3 | (fix) | package.json (test:shell) | new test unwired (CI meta-guard) | FIXED | d881ada6 |
| 7 | 3 | NIT | tools/deploy-site.sh (post-fetch comment) | "sha-verified against live" overbroad for promote alias | DEFERRED | correctness unaffected |
| 8 | 3 | NIT | tools/deploy-site.sh (flag parse) | reads only $1 | DEFERRED | fail-safe; matches existing |

### NITs (non-blocking)
- greedy sed extraction; sha256_publish_as set -e path; additive vercel stub; post-fetch comment overbroad for the promote alias; flag parse reads only $1. All fail-safe / unreachable / cosmetic.

### Strengths (across iterations)
- Guard-skip is surgical: committed-vs-live guard skipped ONLY under `if [ "$PROMOTE" = 1 ]`; site-copy/dry-run byte-for-byte unchanged, proven by red-capable controls (test cases 2 and 6).
- The skipped guard is replaced by a STRONGER chain: fetch + sha-verify from live, then pin the committed pointer's sha (CSHA) to those bytes, plus nothing-to-promote and empty-field refusals. To ship wrong bytes, live bytes + live sidecar + committed pointer must all agree on the wrong value.
- The alias is DERIVED byte-identically from the promoted artifact (cp + sha256_publish_as), mirroring promote-channel.sh #2036, avoiding the #1669 stale-fallback shape; NOT keyed to latest-staging.json so rollback works.
- Test is honest and self-contained (mktemp + EXIT trap, PATH stubs, controls); both core behaviors proven red-capable by breaking the code. Now wired into test:shell and actually invoked.
- Docs use conventions-correct git (explicit-path commit, explicit push refspec) and document the #2008 fail-safe honestly.
