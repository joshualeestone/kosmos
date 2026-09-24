---
pre_challenge: true
method: challenge-loop
branch: deploy-site-served-win-3600
diff_hash: fd6aae930e63ceb4f172356b40702fffe3a5072f2a9f4e5340749eb06ef37a22
validation: passed
subdir_audit: passed
timestamp: 2026-09-24T18:26:14Z
iterations: 14
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 14
**Converged:** Yes
**Total findings:** 45 actionable-or-deferred (0 BLOCKERs, 28 WARNINGs, 3 CONVENTIONs, plus 40+ NITs)
**Fixed:** 38 | **Deferred:** 7 | **Asked (awaiting user):** 0

Final gate (6j): full `yarn test` via validation-log on HEAD, 8671 tests, 0 failed; subdir audit clean.
6.0 baseline: full `yarn test` green at e4fd818d (8671 tests, 0 failed).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] tools/deploy-site.sh staged block: staged zip also redirected to R2 (live: 0.6.81 404s) --> FIXED b1133f6b (superseded staged build skipped)
- [WARNING] tools/deploy-site.sh:493 comment names publish-kosmos-windows.sh as the R2 writer --> FIXED b1133f6b
- [WARNING] tools/deploy-site.sh:504 KOSMOS_WIN_ZIP also disables the served check silently --> FIXED b1133f6b (override log line says so)
- [WARNING] tools/deploy-site.sh:505 silent fallback on probe transport failure --> FIXED b1133f6b (NOTE)
- [WARNING] test: redirect-branch refusals untested --> FIXED b1133f6b (A10, A11)
- [NIT] stub content-type, env -u KOSMOS_WIN_ZIP, name whitelist, plan status --> FIXED b1133f6b / a10a7abc

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 1 NIT
**Self-generated:** 0 of the above
- [WARNING] tools/deploy-site.sh probe status neither redirect nor 200 falls through silently --> FIXED fdc655b5
- [CONVENTION] test file mode 644 vs siblings 755 --> FIXED fdc655b5
- [NIT] sidecar fetched twice --> not acted on

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 1 of the above (the superseded skip written in iteration 1)
- [WARNING] tools/deploy-site.sh superseded skip also dropped the staging-pointer check --> FIXED 280a7205 (A12)
- [WARNING] test: '' and * probe branches untested --> FIXED 280a7205 (A13)
- [NIT] "deploy already ran" wording, shape-guard arm, same-zip arm, case-insensitive sha --> FIXED 280a7205 (A14, A15)
- [NIT] alias .sha256 served statically while alias zip redirects --> DEFERRED: out of scope, filed #3610 (measured live: stale 0.6.72 sha)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 1 NIT
**Self-generated:** 0 of the above
- [WARNING] KOSMOS_WIN_ZIP + staged: prod version from stale committed pointer --> FIXED b5d478db (A16)
- [CONVENTION] two early commit subjects off-format --> DEFERRED: squash merge uses the conventional PR title; rewriting would orphan recorded shas
- [NIT] probe timeout asymmetry --> not acted on

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 1 of the above (the "stale, expected" NOTE written in iteration 1)
- [WARNING] committed newer than served read as "stale, expected" (inverted) --> FIXED 9f5da7eb (loud unpublished WARNING, A17)
- [WARNING] served pointer version field vs checked name --> FIXED 9f5da7eb (version from name)
- [NIT] transport-error arm, empty-version shape --> FIXED 9f5da7eb (A18, tighter glob)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 1 of the above
- [WARNING] static path prod version from pointer version field --> FIXED fcdfb235 (A19)
- [NIT] probe timeout comment --> not acted on (NOTE already says timeout)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1 of the above
- [WARNING] staged version from staging pointer version field --> FIXED b62cbf1f (A20)
- [WARNING] served R2 zip bytes never hashed --> FIXED b62cbf1f (A21)
- [NIT] A18 not a real transport failure --> FIXED b62cbf1f (stub exit 7)
- [NIT] exit-code signal for unpublished Windows --> addressed later (iteration 9)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 2 of the above
- [WARNING] name-to-version sed duplicated four times --> FIXED 726287b5 (win_zip_version helper)
- [WARNING] no-version committed name mislabeled as stale --> FIXED 726287b5 (A22)
- [NIT] commit subjects --> DEFERRED (same as iteration 4)

#### Iteration 9
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 6 NITs
**Self-generated:** 1 of the above
- [WARNING] unpublished Windows warning not visible at the final success line --> FIXED b78645b3 (repeated after it; A17 extended)
- [NIT] sort -V empty output mislabels --> FIXED b78645b3
- [NIT] equal-version staged case --> FIXED b78645b3 (comment)

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 1 of the above
- [WARNING] fetch-and-hash idiom duplicated with served_matches --> FIXED b8aed273 (served_sha256)
- [NIT] shape encoded as glob and sed --> DEFERRED: they do different jobs (validate vs extract); A14 catches drift

#### Iteration 11
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] post-promote R2-lag: staged == committed dies before the warning --> FIXED f6f80000 (superseded vs both, A23)
- [WARNING] newer staged build unreachable via R2 wildcard --> DEFERRED: predates this branch and is a real defect; plan names it; filed #3618
- [NIT] served_sha256 timeouts --> FIXED f6f80000

#### Iteration 12
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above
- [WARNING] 300s max-time also bounds large Mac artifacts --> FIXED 802e14b6 (only the Windows zip fetch)
- [NIT] plan status wording --> FIXED 802e14b6

#### Iteration 13
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1 of the above
- [WARNING] superseded skip also applies to statically served staged zips --> FIXED 91053ae2 (gated on the staged zip redirecting, A24)
- [WARNING] redirect target logged unredacted --> FIXED 91053ae2 (_served_verify_redact_userinfo)
- [NIT] WIN_COMMITTED_VERSION name, multi-read race note --> FIXED 91053ae2

#### Iteration 14
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs new, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] per-deploy ~40 MB zip hash cost --> DEFERRED: the deliberate trade recorded in the plan (bounded 300s)
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | tools/deploy-site.sh staged block | BRANCH | staged zip redirected to R2 | FIXED | b1133f6b |
| 2 | 1 | WARNING | tools/deploy-site.sh:493 | BRANCH | wrong R2 writer named | FIXED | b1133f6b |
| 3 | 1 | WARNING | tools/deploy-site.sh:504 | BRANCH | override disables check silently | FIXED | b1133f6b |
| 4 | 1 | WARNING | tools/deploy-site.sh:505 | BRANCH | silent probe fallback | FIXED | b1133f6b |
| 5 | 1 | WARNING | test | BRANCH | refusal paths untested | FIXED | b1133f6b |
| 6 | 2 | WARNING | tools/deploy-site.sh probe case | BRANCH | other status silent | FIXED | fdc655b5 |
| 7 | 2 | CONVENTION | test file mode | BRANCH | 644 vs 755 | FIXED | fdc655b5 |
| 8 | 3 | WARNING | tools/deploy-site.sh staged skip | SELF | skip dropped pointer check | FIXED | 280a7205 |
| 9 | 3 | WARNING | test | BRANCH | probe branches untested | FIXED | 280a7205 |
| 10 | 3 | NIT | alias sidecar | BRANCH | static alias .sha256 stale | DEFERRED | out of scope, #3610 |
| 11 | 4 | WARNING | tools/deploy-site.sh | BRANCH | override vs staged compare | FIXED | b5d478db |
| 12 | 4 | CONVENTION | git log | BRANCH | two commit subjects | DEFERRED | squash merge |
| 13 | 5 | WARNING | tools/deploy-site.sh NOTE | SELF | committed-newer inverted | FIXED | 9f5da7eb |
| 14 | 5 | WARNING | tools/deploy-site.sh | BRANCH | version field vs name | FIXED | 9f5da7eb |
| 15 | 6 | WARNING | tools/deploy-site.sh | SELF | static path version field | FIXED | fcdfb235 |
| 16 | 7 | WARNING | tools/deploy-site.sh staged | SELF | staged version field | FIXED | b62cbf1f |
| 17 | 7 | WARNING | tools/deploy-site.sh | BRANCH | R2 zip bytes unhashed | FIXED | b62cbf1f |
| 18 | 8 | WARNING | tools/deploy-site.sh | SELF | sed duplicated | FIXED | 726287b5 |
| 19 | 8 | WARNING | tools/deploy-site.sh | SELF | no-version mislabeled | FIXED | 726287b5 |
| 20 | 9 | WARNING | tools/deploy-site.sh final line | SELF | warning not at final line | FIXED | b78645b3 |
| 21 | 10 | WARNING | tools/deploy-site.sh | SELF | fetch-hash duplicated | FIXED | b8aed273 |
| 22 | 10 | NIT | tools/deploy-site.sh | BRANCH | glob and sed shape | DEFERRED | different jobs, A14 |
| 23 | 11 | WARNING | tools/deploy-site.sh staged | SELF | post-promote R2 lag | FIXED | f6f80000 |
| 24 | 11 | WARNING | staging flow | BRANCH | staged unreachable via R2 | DEFERRED | predates branch, #3618 |
| 25 | 12 | WARNING | tools/deploy-site.sh:462 | SELF | max-time on Mac artifacts | FIXED | 802e14b6 |
| 26 | 13 | WARNING | tools/deploy-site.sh staged | SELF | static staged skipped | FIXED | 91053ae2 |
| 27 | 13 | WARNING | tools/deploy-site.sh | BRANCH | unredacted redirect target | FIXED | 91053ae2 |
| 28 | 14 | WARNING | tools/deploy-site.sh | BRANCH | zip hash cost | DEFERRED | by design per plan |

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### NITs (non-blocking, across all iterations)
- [NIT] sidecar fetched twice (iterations 2, 14)
- [NIT] probe timeout tighter than follow-up read (iterations 4, 6)
- [NIT] tests run deploy-site under bash, not sh; iteration 13 reviewer ran it under dash, 23/23 green (iterations 5, 7, 9, 11, 13)
- [NIT] served_sha256 two curl branches could collapse (iteration 14)
- [NIT] empty redirect_url renders "()" (iteration 12)
- [NIT] temp zip has no trap on interrupt (iteration 9)

### Strengths (across all iterations)
- The redirect is measured from the served response, not read from vercel.json; every inconclusive probe falls back to the strict check (all iterations)
- Pointer, sidecar and zip bytes must all agree on the redirect path (iterations 7-14)
- Served names are shape- and character-checked before becoming URLs (iterations 1-14)
- Every pass arm has a control that can return the dangerous answer; each new arm was proven red against the prior commit (iterations 1-14)
