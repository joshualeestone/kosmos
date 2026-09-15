---
pre_challenge: true
method: challenge-loop
branch: resolver-count-gt1-refuse-3111
diff_hash: cebf962941ac012eeb2f0024fcf7d4d6a09ac83a7e359b8215afc8f0335a4429
validation: passed
subdir_audit: passed
timestamp: 2026-09-15T19:31:50Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6 (1 baseline + 5 blind reviews)
**Converged:** Yes
**Total findings:** 10 (0 BLOCKERs, 2 WARNINGs, 8 NITs)
**Fixed:** 8 | **Deferred:** 2 | **Asked:** 0

The model rotation earned its keep: both WARNINGs were found by Sonnet passes and missed by the
Opus passes. Both are substantive (a real behavior/UX gap), not comment-churn.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** n/a (6.0 initial validation baseline)
**New findings:** 0 -- pre-PR validation + subdir-audit passed clean (hash be2227dcc02f).
**Self-generated:** 0

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0
- [NIT] resolve-install-user.sh -- count>1 refuse message was one long line --> FIXED (464fe4b82): multi-line.

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the NITs (the bullet-asymmetry was on iter-2's own reformat)
- [WARNING] resolve-install-user.sh -- `_riu_installer_owners` counts ANY process on the Installer path, so a STALE/hung Installer in another account inflates count>1 and converts a legitimate single-investor install (previously silent console fallback) into a refusal; the plan only considered "count>1 never hit" --> FIXED (8d4c860fc): documented the edge as accepted+recoverable, added a code comment + plan "known edge", named a process-age filter as the future mitigation, and noted a robust liveness filter is unavailable (the root-context session probe is the unreliable signal #2511 removed).
- [NIT] join spacing / [NIT] bullet asymmetry --> FIXED (8d4c860fc).

#### Iteration 4
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 2 of the above (both on prose the loop added in iter-3)
- [NIT] "at the same time" overclaims simultaneity (a stale Installer is not simultaneous) --> FIXED (581d7eb11): deleted the phrase.
- [NIT] "recoverable in one step" overclaims (cross-account recovery needs account-switching) --> FIXED (581d7eb11): deleted "in one step".

#### Iteration 5
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 (the WARNING was on the message the loop wrote in iter-3)
- [WARNING] resolve-install-user.sh -- the refuse remedies ("quit the other installer" / "sign in as one account") are NOT actionable for a person blocked by a stale Installer in an account they cannot access, leaving them stuck; the message omitted the always-available remedy --> FIXED (d8719f234): added "restart the Mac (closes every account's installer)"; updated the comment + plan so "recoverable" holds in all cases.
- [NIT] test only exercised 2 owners --> FIXED (d8719f234): added ARM 6c (3 owners) exercising the ", "-join.
- [NIT] recurring format-difference between the two refuse messages --> DEFERRED: genuinely different message shapes (a parallel-checks list vs a narrative-with-remedy); chasing it round after round is the comment-churn pattern.

#### Iteration 6
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 actionable
**Converged** -- no new actionable findings. Confirmed control flow gap-free, the `sort -u` distinct-owner dedup makes the "another account" edge claim precise, the restart remedy genuinely holds (a hung Installer.app is not a login item), and comments/plan match the code.
- [NIT] lowercase "installer" vs "Installer" (cosmetic, arguably deliberate friendly copy) --> DEFERRED.
- [NIT] ARM 6 (console=loginwindow) refuses under old+new code, so ARM 6b is the discriminating reversal proof, not ARM 6 --> DEFERRED (an observation, not a defect; ARM 6b carries the proof, confirmed non-vacuous).

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 2 | NIT | resolve-install-user.sh:144 | BRANCH | count>1 message one long line | FIXED | 464fe4b82 |
| 2 | 3 | WARNING | resolve-install-user.sh:56 | BRANCH | stale Installer inflates count>1 -> refuses a working install | FIXED | 8d4c860fc |
| 3 | 3 | NIT | resolve-install-user.sh:144 | BRANCH | join spacing (bob,carol) | FIXED | 8d4c860fc |
| 4 | 3 | NIT | resolve-install-user.sh:145 | SELF | bullet asymmetry (iter-2 reformat) | FIXED | 8d4c860fc |
| 5 | 4 | NIT | resolve-install-user.sh:155 | SELF | "at the same time" overclaim | FIXED | 581d7eb11 |
| 6 | 4 | NIT | resolve-install-user.sh:150 | SELF | "in one step" overclaim | FIXED | 581d7eb11 |
| 7 | 5 | WARNING | resolve-install-user.sh:157 | SELF | remedy not actionable for inaccessible account | FIXED | d8719f234 |
| 8 | 5 | NIT | test-resolve-install-user.sh:114 | BRANCH | only 2 owners exercised | FIXED | d8719f234 |
| 9 | 6 | NIT | resolve-install-user.sh:159 | SELF | lowercase "installer" | DEFERRED | Cosmetic / friendly copy |
| 10 | 6 | NIT | test-resolve-install-user.sh:114 | BRANCH | ARM 6 not the discriminating control | DEFERRED | Observation; ARM 6b is the proof |

### Outstanding questions (ASKED)
None.

### NITs (non-blocking, deferred)
- [NIT] lowercase "installer" in the user-facing message (iteration 6).
- [NIT] format difference between the two refuse messages (iteration 5).
- [NIT] ARM 6 is a message-path check, not the reversal control (ARM 6b is) (iteration 6).

### Strengths (across all iterations)
- Control flow is gap-free: count>1 refuses strictly between candidate 1 and candidate 2; count==0/count==1 preserved byte-for-byte; the dead count>1 branch in the final refuse was removed, not left unreachable (iterations 2,3,4,6).
- ARM 6b is a non-vacuous reversal proof: asserts both refuse AND that INSTALL_USER did not resolve to the console holder (every reviewer verified this).
- Shell robustness under POSIX sh / set -u: numeric owner_count, vars assigned before use, absolute-path binaries, safe multi-line RIU_REASON + inline join (iterations 4,5,6).
- The refuse message is honest and actionable in ALL cases, including the always-available restart remedy for an unreachable account (iteration 6).
- Comments and plan agree with the code and each other -- the repo's most-shipped defect (comment-vs-code drift) was specifically checked clean every pass.
