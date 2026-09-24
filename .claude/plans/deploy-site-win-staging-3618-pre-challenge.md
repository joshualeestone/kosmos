---
pre_challenge: true
method: challenge-loop
branch: deploy-site-win-staging-3618
diff_hash: 2e1c339f5cac55940e9de12fcaa6065db348a5f4d13e8d129965fb21afcb8a3b
validation: passed
subdir_audit: passed
timestamp: 2026-09-24T21:56:36Z
iterations: 16
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 16
**Converged:** Yes
**Total findings:** about 60 actionable (0 BLOCKERs, about 44 WARNINGs, 3 CONVENTIONs, plus NITs)
**Fixed:** about 55 | **Deferred:** 5 | **Asked (awaiting user):** 0

Final gate (6j): validation-log PASSED on HEAD after rebasing onto origin/main (8819 tests, 0
failed; hash 2e1c339f5cac). The branch now carries the #3634 anchor-test fix. Earlier gate runs were
red only from causes outside this change: 65 and then 90 node timeouts under load 22 to 26, all green
when rerun alone, and once a validation that ran while I had swapped a file in the worktree for a
red-check.
Test: tools/test-deploy-site-served-win-3600.sh, 47 arms, 0 failed; each new arm was proven red
against the commit before it (in a scratch copy from iteration 5 on).

### Per-Iteration Breakdown (reviewer model alternated opus/sonnet)

#### Iteration 1 (opus)
- [WARNING] a staged commit newer than R2 was labelled "stale" --> FIXED (loud not-staged WARNING, A33)
- [WARNING] a failed alias probe was misread as "static" --> FIXED (A34)
- [WARNING] staging probe arms for '' and * were missing --> FIXED
- [WARNING] no staging bytes arm; two fail-closed paths not pinned --> FIXED (A30-A32)

#### Iteration 2 (sonnet)
- [CONVENTION] plan arm count stale --> FIXED
- [NIT] tag and race note --> FIXED

#### Iteration 3 (opus)
- [WARNING] A31 was vacuous --> FIXED (NOTE, plus A36 as its control)
- [NIT] tags, cannot-be-told, closing notes --> FIXED

#### Iteration 4 (sonnet)
- [WARNING] alias check read before probing --> FIXED
- [CONVENTION] mode table missing modes --> FIXED

#### Iteration 5 (opus)
- [WARNING] alias zip not hashed while its sidecar is static --> FIXED (probe the zip's own redirect, A38)
- [WARNING] fail-closed choices not named in the plan --> FIXED (plan)
- [WARNING] alias-is-prod premise --> DEFERRED as the named weakest premise (confirm with Homer)

#### Iteration 6 (sonnet)
- [WARNING] sha shape refusal untested --> FIXED (A39)

#### Iteration 7 (opus)
- [WARNING] alias zip probe failure silent; A28 had no control; staging NOTE hidden when nothing committed; transient-probe red unnamed --> FIXED (A40, plan)

#### Iteration 8 (sonnet)
- [WARNING] a comment claimed both reads saw one state (SELF prose) --> FIXED (claim deleted, race stated)

#### Iteration 9 (opus)
- [WARNING] fail-open asymmetry undocumented; unverified-run notes not at the tail --> FIXED (BUT lines, plan)
- [NIT] length arm --> FIXED (A41)

#### Iteration 10 (sonnet)
- [WARNING] alias checks gated on a redirected prod pointer --> FIXED (plan states why that is right)

#### Iteration 11 (opus)
- [WARNING] alias zip probe downloaded the zip; 404 raised a false caveat; fail-open paths untested --> FIXED (A42-A45)

#### Iteration 12 (sonnet)
- [WARNING] staged zip probe downloaded the zip --> FIXED
- [WARNING] Homer premise --> duplicate of iteration 5

#### Iteration 13 (opus)
- [WARNING] HEAD dependence --> FIXED (one-byte ranged GET)
- [WARNING] "stale" wording when the site copy is ahead --> FIXED
- [WARNING] three-zip cost unstated --> FIXED (plan)

#### Iteration 14 (sonnet)
- [WARNING] R2 sidecar value echoed unsanitised --> FIXED
- [NIT] probe helper duplication --> DEFERRED (four sites correct and tested; refactor risk late)

#### Iteration 15 (opus)
- [WARNING] alias refusals did not say re-run once --> FIXED
- [WARNING] today's #3610 WARNING on every deploy --> duplicate (the plan's deliberate state)
- [NIT] enforce pointer artifact --> FIXED (A47)

#### Iteration 16 (sonnet)
- [WARNING] prod probe has no explicit 404 arm --> DEFERRED (predates the card; fails closed; message only)
- [WARNING] Homer premise --> duplicate
**Converged** - no new actionable findings.

### Final Ledger (condensed)

| # | Iter | Category | Area | Origin | Status | Resolution |
|---|------|----------|------|--------|--------|------------|
| 1 | 1-4 | WARNING | staging redirect, probes, arms | BRANCH/SELF | FIXED | A25-A38 |
| 2 | 5 | WARNING | alias-is-prod premise | BRANCH | DEFERRED | named weakest premise |
| 3 | 7-11 | WARNING | fail-open visibility and coverage | SELF | FIXED | BUT lines, A40-A45 |
| 4 | 8 | WARNING | overclaiming comment | SELF | FIXED | deleted |
| 5 | 13 | WARNING | HEAD dependence | SELF | FIXED | ranged GET |
| 6 | 14-15 | WARNING | sanitising, re-run wording, artifact | BRANCH/SELF | FIXED | A46, A47 |
| 7 | 14 | NIT | probe helper duplication | SELF | DEFERRED | tested, late refactor risk |
| 8 | 16 | WARNING | prod probe 404 arm | BRANCH | DEFERRED | pre-existing, fails closed |

### Outstanding questions (ASKED)
- none

### Strengths (across all iterations)
- Every redirect is measured from the served response, never read from vercel.json; every inconclusive probe falls back to the strict check or names itself at the tail.
- Pointer, sidecar and bytes must agree for prod and staging through two shared helpers.
- Each green arm has a control that can return the dangerous answer.
