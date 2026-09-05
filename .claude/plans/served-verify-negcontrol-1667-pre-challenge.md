---
pre_challenge: true
method: challenge-loop
branch: served-verify-negcontrol-1667
diff_hash: 7dcaa9f4ff3d9e30127a5ba03c6508a3894715dec4a1a4ec0611f6d768d82187
validation: passed
subdir_audit: passed
timestamp: 2026-09-05T18:36:00Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 found no new BLOCKER/WARNING/CONVENTION requiring a change)
**Total findings:** 15 (0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 4 NITs, 9 STRENGTHs) across all iterations
**Fixed:** 7 | **Deferred/accepted:** 5 | **Asked (awaiting user):** 0

**Validation note (honest record):** the change's real validation is green - tools/test-served-verify.sh
PASS (all arms, red-capability proven), tools.every-test-runs.test.js 3/0, tools/test-zsh-tied-names.sh
PASS, tools/test-deploy-site-promote.sh PASS (the pre-existing integration test that exercises
deploy-site.sh - no regression). The generic validation-log helper mis-detects stack=typescript and
runs `npm run type-check`, a script this repo does not define; that is a harness mismatch, not a
validation failure. The full test:shell is green EXCEPT tools/test-browser-run-guard.sh, which fails
on ENVIRONMENTAL contention (a concurrent `bash tools/browser-checks.sh`, pid 36115, on the shared
Mac) and reproduces identically on the clean main checkout, so it is not this change; CI runs on a
clean runner.

### Per-Iteration Breakdown

#### Iteration 1 (reviewer a6ed4d13)
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs, 3 STRENGTHs
- [WARNING] served-verify.sh -- the text/html content-type match was case-sensitive (the fleet's most-repeated false-zero) --> FIXED (e911c6c1): lowercase before matching; new red-capable arm for mixed-case Text/HTML.
- [NIT] a 200 with no content-type was accepted --> FIXED (e911c6c1): now refused; new red-capable arm.
- [NIT] no curl timeouts --> FIXED (e911c6c1): --connect-timeout 10 --max-time 30 on both probes.
- [NIT] the lib source had no [ -f ] guard --> FIXED (e911c6c1): guard added, matching pkg-inputs.sh.
- STRENGTHs: complementary/redundant coverage (host control + content-type tell); transport error (rc 2) fails closed; -L is correctly required for the 302-to-SSO case.

#### Iteration 2 (reviewer aa21556f)
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 1 NIT, 2 STRENGTHs
**Duplicates of prior findings:** 0
- [CONVENTION] tr 'A-Z' 'a-z' range form is locale-fragile --> FIXED (d27e4024): tr '[:upper:]' '[:lower:]', the newer lib convention.
- [NIT] terse caller messages --> FIXED (d27e4024): the two served_verify_asset_ok callers now name what failed and point at the reason.
- [WARNING] the negative control couples on the prod alias 404-ing unknown /dist paths (a future Vercel SPA catch-all/rewrite that 200s unknown paths would make every deploy refuse) --> DEFERRED (acceptable-by-design): that refusal is the feature - if the alias 200s unknown paths the whole served-verify is blind, so failing closed (post-deploy, so investigation not corruption) is exactly right. Documented in the plan.
- STRENGTHs: negative control returns 0 for any non-200 and 1 only for the blind 200 (transport error still aborts); no coverage lost vs served_200; empirically verified curl returns an empty content_type on a real no-Content-Type 200 so the empty branch genuinely fires.

#### Iteration 3 (reviewer ac25727d)
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION (acknowledged, dup), 2 NITs, 4 STRENGTHs
**Converged** -- no new actionable BLOCKER/WARNING/CONVENTION. The reviewer independently re-proved red-capability by perturbation (neutering the tr to a passthrough made the mixed-case arm rc=0 and the test reported 1 FAILED, exit nonzero) and confirmed POSIX-clean under dash.
- [WARNING] the asset check is a denylist (rejects text/html + empty), not a per-asset allowlist --> DEFERRED: the denylist is the card's explicit tell and catches the actual #1667 threat (an SSO/404 html page); a per-asset allowlist would hardcode Vercel's exact .zip content-type (false-fail risk) and the function also serves a text asset (/setup), so a blanket reject-text/* is unavailable; git-archive-deterministic bytes + the negative control are defense in depth.
- [NIT] the negative control probes only /dist, not root --> accepted: no live hole (each asset's own content-type tell guards it independently).
- [NIT] the "negative control OK" line prints to stdout while refusals go to stderr --> accepted: cosmetic; no caller captures the lib's stdout.
- [CONVENTION] the deferred prod-alias coupling --> acknowledged; same coupling as the iter2 WARNING, already documented; reviewer agreed with the disposition.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | served-verify.sh:~65 | case-sensitive text/html match | FIXED | e911c6c1 |
| 2 | 1 | NIT | served-verify.sh:~60 | empty content-type accepted | FIXED | e911c6c1 |
| 3 | 1 | NIT | served-verify.sh (curl) | no timeouts | FIXED | e911c6c1 |
| 4 | 1 | NIT | deploy-site.sh:~250 | source lacked [ -f ] guard | FIXED | e911c6c1 |
| 5 | 2 | CONVENTION | served-verify.sh:69 | tr A-Z range form (locale-fragile) | FIXED | d27e4024 |
| 6 | 2 | NIT | deploy-site.sh:328-329 | terse caller messages | FIXED | d27e4024 |
| 7 | 2 | WARNING | deploy-site.sh:327 | negative control couples on prod-alias 404 | DEFERRED | acceptable-by-design (plan) |
| 8 | 3 | WARNING | served-verify.sh:~65 | denylist not per-asset allowlist | DEFERRED | card's tell + false-fail risk (plan) |
| 9 | 3 | NIT | served-verify.sh:~40 | negative control only /dist namespace | ACCEPTED | no live hole (content-type tell) |
| 10 | 3 | NIT | served-verify.sh:~48 | success line to stdout not stderr | ACCEPTED | cosmetic |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- empty content-type accepted (iter1) -- fixed.
- no curl timeouts (iter1) -- fixed.
- source lacked [ -f ] guard (iter1) -- fixed.
- terse caller messages (iter2) -- fixed.
- negative control only /dist namespace (iter3) -- accepted (no live hole).
- success line to stdout (iter3) -- accepted (cosmetic).

### Strengths (across all iterations)
- Two-function split (host negative control + per-asset content-type tell) is the right shape and genuinely red-capable; both tells are independent and redundant against the SSO-200 shape.
- POSIX-clean under dash; no bashisms; correct parameter-expansion split of code from content-type including the empty case.
- Transport error (rc 2) fails closed; -L correctly required for the 302-to-SSO scenario; no coverage lost vs the old served_200.
- Red-capability independently confirmed by perturbation in iter3 (a neutered tr makes the mixed-case arm pass and the test then fails).
- Meta-guards pass (the new test is executed, not just syntax-checked); em-dash clean; integrates cleanly with the existing deploy-site promote test.
