---
pre_challenge: true
method: challenge-loop
branch: staging-verify-2036
diff_hash: 87948e3d58d403ada8711e0536e89cf072ec6980319cdf661c142cc7bdb5d1ab
validation: passed
subdir_audit: passed
timestamp: 2026-09-03T17:36:00Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4 found zero new actionable findings)
**Total findings:** 4 WARNINGs, 0 BLOCKERs, 0 CONVENTIONs, plus NITs
**Fixed:** 4 WARNINGs + 3 NITs | **Deferred:** 1 NIT (pre-existing #2030 code) | **Asked:** 0

The change (kosmos#2036) is the verification half of the staging gate: a spec plus a
security-adjacent shell check (`tools/staging-experience-check.sh`) that drives the real
#1979/#2030 nonce-mint → `?boot=` redeem → cookie'd `/api/*` flow and asserts a fresh
session can use the board after an update (the #2023 outage class), its test, and the
`test:shell` wiring. A genuine 4-iteration convergence: each of the first three passes
found a real issue, including a leak bug introduced by iteration 1's own fix.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 2 WARNINGs, 3 NITs
- [WARNING] false-pass: step 3 treated only 403 as failure, so a 500/502/000 after a
  successful redeem fell through to USABLE --> FIXED (require a 2xx).
- [WARNING] `.reauth-seeded` side effect: redeeming on a shared board seeds the marker
  (server-side #2030), consuming a real user's self-heal --> FIXED (record + restore).
- [NIT] no trap for the mode-600 token temp file on interrupt --> FIXED (EXIT trap).
- [NIT] "PURE" wording (in the carried #2030 code, not this diff) --> not this change.
- [NIT] setup.sh dead vars (#2030 code) --> DEFERRED (pre-existing, on main).

#### Iteration 2
**New findings:** 1 WARNING, 3 NITs
- [WARNING] step 3 not self-validating: relied transitively on step 2 to prove the route
  gates --> FIXED (a NO-COOKIE 403 pre-assert; a future route-exemption now yields
  cannot-tell, not a silent weak pass).
- [NIT] restore keys on check-ROOT; note it assumes check-ROOT == server-ROOT --> FIXED (noted).
- [NIT] clear HF/CJ after explicit rm so the trap is exact --> FIXED.
- [NIT] setup.sh dead vars --> DEFERRED (duplicate of iter-1).

#### Iteration 3
**New findings:** 1 WARNING, 1 NIT
- [WARNING] REAL BUG in iter-1's restore: it ran only on the exit-0 success path, so every
  post-redeem FAILURE path leaked a check-created marker - and the redeemed-session-403s
  case is exactly the shared-broken-board scenario where suppressing the self-heal matters
  most --> FIXED (moved the guarded restore into the EXIT trap `cleanup()`; runs on ALL
  post-redeem paths, interrupt-safe; validated: SEEDED_BEFORE=0+present -> removed,
  SEEDED_BEFORE=1 -> preserved).
- [NIT] port 16180 default vs the per-account-port guidance --> FIXED (noted as last-resort).

#### Iteration 4
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Converged** - no new actionable findings. 5 strengths confirmed (gate ordering /
false-pass resistance, trap correctness + set-u safety, token off-argv, honest test arms,
#2030 server-side correctness).
- [NIT] test arm 2 hardcodes port 19998 --> NOTED (a false pass would need a listener
  returning a valid nonce and passing the whole gate flow - effectively impossible).
- [NIT] the shared-board restore is not race-free (TOCTOU) --> FIXED (added the one-line
  note; the removal direction is the documented safe one, intended target is a dedicated account).
- [NIT] setup.sh dead vars --> DEFERRED (pre-existing #2030 code, not this diff).

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | WARNING | staging-experience-check.sh | false-pass on non-2xx non-403 | FIXED | require 2xx |
| 2 | 1 | WARNING | staging-experience-check.sh | seeds .reauth-seeded on shared board | FIXED | record + restore |
| 3 | 1 | NIT | staging-experience-check.sh | temp file not interrupt-safe | FIXED | EXIT trap |
| 4 | 2 | WARNING | staging-experience-check.sh | step 3 not self-validating | FIXED | no-cookie 403 pre-assert |
| 5 | 3 | WARNING | staging-experience-check.sh | restore only on success (leak) | FIXED | restore in EXIT trap |
| 6 | 3 | NIT | staging-experience-check.sh | 16180 default | FIXED | noted as fallback |
| 7 | 4 | NIT | staging-experience-check.sh | shared-board TOCTOU | FIXED | noted |
| 8 | - | NIT | install/setup.sh | dead _minted_nonce/_opened | DEFERRED | pre-existing #2030 code, not this diff |

### Outstanding questions (ASKED)
None.

### Strengths (across iterations)
- Gate ordering is false-pass-resistant: a no-cookie 403 pre-assert before the cookie'd 2xx,
  so a future route-exemption yields cannot-tell not a silent pass. (iter 2-4)
- The EXIT/INT/TERM trap is correctly ordered and set-u-safe; the SEEDED_BEFORE guard means
  "this run created it," so cleanup restores on all paths and never removes a foreign marker. (iter 4)
- Token kept off argv via a mode-600 header file (#1979 shape); removed immediately + on trap. (all)
- Exit discipline airtight: only a 2xx reaches exit 0; 403/5xx/000 -> 1; non-enforcing/unreachable -> 2. (all)
- Test arms assert exact exit codes and can fail; the un-CI-coverable USABLE path is disclosed, not faked. (all)

### NITs (non-blocking)
- test-staging-experience-check.sh:27 hardcodes port 19998 (cosmetic).
- setup.sh dead `_minted_nonce`/`_opened` (pre-existing #2030 code, deferred).
