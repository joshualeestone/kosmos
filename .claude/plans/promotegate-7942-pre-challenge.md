---
pre_challenge: true
method: challenge-loop
branch: promotegate-7942
diff_hash: f4faf0df86fbd1662590d6499800fea7c4973ee38adf085a6d80b68652df6755
validation: passed (static guards that scan tools/, workflows, package.json and release.sh plus three file-only lints, 2412 tests, 0 fail; tools/test-linux-check-runs-7942.sh 39/39, tools/test-promote-linux-7281.sh 101/101, test-release-linux-7281 68/68, test-staging-wire-2036 39/39, test-promote-named-7005 and test-promote-channel-win all pass; the full node suite runs as this PR's CI)
subdir_audit: passed
timestamp: 2026-11-04T15:08:01Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7
**Converged:** Yes
**Total findings:** 40 (0 BLOCKERs, 14 WARNINGs, 1 CONVENTION, 25 NITs)
**Fixed:** 13 WARNINGs, the CONVENTION and most NITs | **Deferred:** 1 WARNING | **Asked (awaiting user):** 0

Measured outside the tests: the lookup against the real API for 0.7.88 (c9ee4128...) answers 1 with both
workflows named; a real dispatch run reads `success workflow_dispatch joshualeestone/kosmos main <path>`;
compare <main sha>...heads/main reads identical and a branch commit reads diverged; the legs ran green on
ubuntu-24.04 with the output-writing change (run 41847654066, record job skipped off main as designed).
Not yet measurable: the record steps (main only). Post-merge: dispatch both workflows, then the lookup must answer 0.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] a fork PR from a branch named main could satisfy the lookup (public repo) --> FIXED (f6a234b): workflow_dispatch from this repo only; 3 arms
- [WARNING] a rollback/named promote of an old build hits a dead-end remedy --> FIXED (f6a234b): 90-day records, message and docs say --skip-linux-check
- [WARNING] no e2e arm for a named promote's sha --> FIXED (f6a234b)
- [CONVENTION] workflow header said the promote does not wait --> FIXED (f6a234b)
- NITs: HOLD exit 2, 7933 record re-reads pointer --> FIXED; any-green-run counts, unquoted cmd --> noted

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] a set KOSMOS_PROMOTE_LINUX_CHECK_CMD skipped the gate silently --> FIXED (e8a6b36): said with !!!
- [WARNING] exit-2 HOLD not passable by --force undocumented --> FIXED (e8a6b36): docs
- NITs: unquoted cmd, greedy sed, real lookup only unit-tested --> noted

#### Iteration 3
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
- [WARNING] a TAG named main reports head_branch main and bypasses branch protection --> FIXED (bc86fc5): run's commit must be on main via compare; @ref must be refs/heads/main
- NITs: expiry filter untested, --force + HOLD untested --> FIXED; pagination, re-cut within run --> noted

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] one unanswerable run held the promote beside a green one --> FIXED (0622c41)
- [WARNING] the fake gh ignored --jq, so the real filters were untested --> FIXED (0622c41): JSON fixtures through real jq; 3 perturbations red
- NITs --> noted

#### Iteration 5
**Reviewer model:** opus (default), whole branch, no plan file
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (the iteration 3 compare against a bare main)
- [WARNING] compare against a bare main resolves to a tag called main, defeating the iteration 3 fix --> FIXED (5d08bd3): heads/main, pinned by text
- NITs: per_page 100, usage lines, release.sh after-cut steps --> FIXED; unquoted cmd --> noted

#### Iteration 6
**Reviewer model:** sonnet, whole branch, no plan file
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] nothing tied the uploaded names to the names the lookup asks for --> FIXED (5810ec3): 5 contract arms, a rename perturbation red
- [WARNING] a crashing lookup's exit 1 reads as a verdict --> FIXED (5810ec3), wording later corrected in 9e04b90
- [WARNING] sed vs JSON.parse sha readers could diverge --> DEFERRED: measured identical on the served pointer (its only other sha key is setup_sha256, which "sha256" cannot match); a divergence refuses, never passes
- NITs --> noted

#### Iteration 7
**Reviewer model:** opus (default), whole branch, no plan file
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1 of the above (the iteration 6 refusal wording)
- [NIT] the refusal's "or the lookup failed" is false (failures exit 2) --> FIXED (9e04b90): clause deleted
- [NIT] "went to prod" before the deploy --> FIXED (9e04b90)
- NITs: untested sha-shape guard, fake ignores repo in path, jq-missing SKIP --> noted
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | tools/linux-check-runs.sh | BRANCH | Fork PR run counts | FIXED | f6a234b |
| 2 | 1 | WARNING | tools/promote-channel.sh | BRANCH | Rollback dead end | FIXED | f6a234b |
| 3 | 1 | WARNING | tools/test-promote-linux-7281.sh | BRANCH | No named-promote arm | FIXED | f6a234b |
| 4 | 1 | CONVENTION | .github/workflows/linux-promote-check-7933.yml | BRANCH | Stale header | FIXED | f6a234b |
| 5 | 2 | WARNING | tools/promote-channel.sh | BRANCH | Silent override env | FIXED | e8a6b36 |
| 6 | 2 | WARNING | docs/staging-channel.md | BRANCH | HOLD vs --force undocumented | FIXED | e8a6b36 |
| 7 | 3 | WARNING | tools/linux-check-runs.sh | BRANCH | Tag named main | FIXED | bc86fc5 |
| 8 | 4 | WARNING | tools/linux-check-runs.sh | BRANCH | One unknown run holds | FIXED | 0622c41 |
| 9 | 4 | WARNING | tools/test-linux-check-runs-7942.sh | BRANCH | jq filters untested | FIXED | 0622c41 |
| 10 | 5 | WARNING | tools/linux-check-runs.sh | SELF | Bare main compare | FIXED | 5d08bd3 |
| 11 | 6 | WARNING | tools/test-linux-check-runs-7942.sh | BRANCH | Name contract untested | FIXED | 5810ec3 |
| 12 | 6 | WARNING | tools/promote-channel.sh | BRANCH | Crash reads as verdict | FIXED | 5810ec3, 9e04b90 |
| 13 | 6 | WARNING | .github/workflows/linux-family-install-7281.yml | BRANCH | Two sha readers | DEFERRED | Measured identical; fails closed |
| 14 | 7 | NIT | tools/promote-channel.sh | SELF | False refusal clause | FIXED | 9e04b90 |

### NITs (non-blocking, across all iterations)
- `$LINUX_CHECK_CMD` unquoted (a path with a space HOLDS), as the other gate commands (iterations 1, 2, 4, 5, 6)
- Any one green run for the sha counts, even beside a newer red run (iteration 1)
- The sha-shape guard on head_sha is untested; the fake ignores the repo in API paths (iteration 7)
- With no jq the unit test SKIPs (jq is present here and on the runners) (iteration 7)

### Strengths (across all iterations)
- The gate runs after the Linux pair is prepared and before every gate and write, on the snapshot sha the writes re-check (iterations 1 to 7)
- Provenance on every axis, each with an arm that can fail (iterations 3 to 7)
- The records fail closed: main only, live site, staging, one build across legs, pointer re-read (iterations 1 to 7)
