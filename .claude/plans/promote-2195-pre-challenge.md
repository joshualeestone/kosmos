---
pre_challenge: true
method: challenge-loop
branch: promote-2195
diff_hash: 6b0a97bee308351b57d573de8db9bf5582e6abf3439fa6d62e5e18fd667c80ce
validation: passed
subdir_audit: passed
timestamp: 2026-09-05T06:36:39Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2 produced zero NEW BLOCKER/WARNING/CONVENTION after dedup)
**Total findings:** 0 BLOCKERs, 2 WARNINGs (1 fixed, 1 deferred), 0 CONVENTIONs, 3 NITs
**Fixed:** 1 | **Deferred:** 4 | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 0 NITs
- [WARNING] tools/deploy-site.sh (sha256-name.sh sourced with no precondition existence check, unlike the other libs; fails safe but cryptic) --> FIXED (commit 064072fe): added a promote-guarded precondition check, verified it fires with a clear message.
- [WARNING] tools/deploy-site.sh (the hardcoded $WINZIP honest-marker refuse is likelier to trip on a promote across a Windows-version bump) --> DEFERRED: pre-existing #2008 hardcode, fail-safe (refuses, never ships wrong bytes), and NOT changed by --promote. Addressed for this PR by a docs note (commit 064072fe) telling operators to set KOSMOS_WIN_ZIP; the durable fix is the unversioned win alias (#2008), out of scope here.

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs (after dedup), 0 CONVENTIONs, 3 NITs
**Duplicates of prior findings:** 1 (the $WINZIP gotcha, re-raised with "the test does not cover it" - same concern/place as iter-1's deferred finding; the WINZIP path is pre-existing behavior --promote does not alter, so a test for it would test pre-existing code, not this change).
- [NIT] tools/deploy-site.sh - ptr_artifact/ptr_sha use a greedy sed grabbing the LAST match. Fails safe (a wrong grab mismatches the CSHA pin and refuses); the real latest.json has exactly one sha256; matches the file's pre-existing extraction style. Recorded, not changed.
- [NIT] tools/deploy-site.sh - sha256_publish_as's internal digest=$(awk ...) on a bad src could abort under set -e before its graceful return 1. Unreachable in practice: $ART.sha256 is fetched + sha-verified before this runs, and the outcome (refuse) is identical either way. Recorded, not changed.
- [NIT] tools/test-deploy-site-promote.sh - the vercel stub publishes additively (cp -R) vs a real replace, so a "dropped artifact whose live bytes already equal local" bug would not be caught by the post-deploy served_matches. The real code's pre-deploy honest-marker check covers that class; additive is sufficient for the promote-logic assertions the test targets. Recorded, not changed.
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | tools/deploy-site.sh (preconditions) | sha256-name.sh sourced without a precondition check | FIXED | 064072fe |
| 2 | 1 | WARNING | tools/deploy-site.sh (win-zip check) | $WINZIP hardcode likelier to trip on a version-bump promote | DEFERRED | pre-existing #2008; fail-safe; surfaced in docs (064072fe) |
| 3 | 2 | NIT | tools/deploy-site.sh (ptr_ helpers) | greedy sed in ptr_artifact/ptr_sha | DEFERRED | fail-safe + matches existing style |
| 4 | 2 | NIT | tools/deploy-site.sh (alias derive) | sha256_publish_as set -e path | DEFERRED | unreachable; same refuse outcome |
| 5 | 2 | NIT | tools/test-deploy-site-promote.sh | additive vercel stub | DEFERRED | honest-marker check covers the class |

### NITs (non-blocking)
- greedy sed extraction (iter 2) - fail-safe, consistent with file style.
- sha256_publish_as set -e abort path (iter 2) - unreachable, same outcome.
- additive vercel stub (iter 2) - covered by honest-marker check.

### Strengths (across iterations)
- The committed-vs-live guard is skipped ONLY for --promote; the site-copy/dry-run path is byte-for-byte unchanged, proven by the red-capable "site-copy still refuses a moved pointer" control (test cases 2 and 6). (both iterations)
- The skipped guard is replaced by a STRONGER three-way check: served sidecar == fetched bytes == committed pointer's advertised sha (the CSHA pin), refusing a lying/stale committed pointer; exercised red-capably by the deadbeef-sha case. (both iterations)
- The unversioned alias is DERIVED byte-identically from the promoted artifact (cp + sha256_publish_as re-verify) rather than fetched live, correctly avoiding the stale-fallback #1669 shape. (both iterations)
- Artifact derived from the COMMITTED pointer (the version promoted TO); the fetch fails safe if those bytes are not served, which also keeps rollback (a prior committed pointer) correct. (both iterations)
- Test is honest and self-contained (set -uo pipefail so all cases run, PATH stubs, each assertion paired with a control); both core behaviors (guard-skip, alias-derive) independently proven red-capable by breaking the code. (both iterations)
- Docs correctly demote the manual release.sh machinery to a fallback and use the safe explicit push HEAD:refs/heads/main form. (iteration 2)
