---
pre_challenge: true
method: challenge-loop
branch: install-user-1880
diff_hash: fdbd64eef1f53c6a2739485fcfcfd949f6aa8135427dd8773d3d956a4caaad88
validation: passed
subdir_audit: passed
timestamp: 2026-09-02T19:52:29Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes (iteration 6 returned zero actionable findings)
**Total findings:** 12 (0 BLOCKERs, 5 WARNINGs, 1 CONVENTION, 6 NITs)
**Fixed:** 10 | **Deferred:** 2 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
- [WARNING] resolve-install-user.sh — ambiguous+console tiebreak reintroduced a narrow #1880-class variant --> FIXED (drop the tiebreak, refuse on ambiguity) (a90a389... iter1 commit 9940b709)
- [WARNING] real-boundary coverage gap (sensors never run against a live multi-account install) --> DEFERRED: cannot run a real .pkg install in a bot session; gate is not stricter than the existing downstream session requirement; recommended a post-merge multi-account smoke (plan follow-on)
- [NIT] `_riu_*` working vars leak into the sourcing postinstall scope (no `local` in POSIX sh) --> FIXED (reserved-names note added)

#### Iteration 2
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
- [WARNING] console fallback under `-le 1` lumped "no owner" with "one owner that failed the session gate", silently redirecting to the console holder (a #1880-class redirect via the session-gate route) --> FIXED (fallback only on owner_count -eq 0; otherwise refuse) (90a3894d)
- [NIT] owner match was a bare basename `Installer` (rogue same-named binary could be selected) --> FIXED (anchor on the CoreServices Installer.app exec path)

#### Iteration 3
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
- [WARNING] failure message could falsely tell a signed-in console user they had no session (in count>=1 refusal branches the console session was never tested) --> FIXED (branch the console description on an actual `_riu_has_gui_session` check) (5869d288)
- [WARNING] real-`ps` parse depends on an untruncated `comm` path --> DEFERRED with a documenting comment (the plan's weakest premise; `comm=` is the final, header-suppressed column BSD ps runs to EOL; path ~63 chars; graceful degradation to console fallback; real-install smoke is the closing check)
- [NIT] the "SIP-protected" comment overstated (anchor was not tied to `/System/Library/`) --> FIXED (anchor to the EXACT /System/Library/CoreServices path; comment now true)
- [NIT] test re-source could footgun a future full-resolver arm --> FIXED (explicit "no full-resolver arm may follow" comment)

#### Iteration 4
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
- [NIT] `grep -c` exits 1 on the 0-owner path (latent trap under a future `set -e`) --> FIXED (append `|| true`, documented) (8ba94782)
- [NIT] count==1 message says "no session" but the sole owner could also be an unresolvable uid --> DEFERRED: reviewer rated it near-impossible; rewording loses the useful common-case detail

#### Iteration 5
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 1 NIT
- [CONVENTION] plan file introduced Unicode em dashes in a committed Josh-readable doc --> FIXED (replaced with ASCII hyphens; shipped code files were already ASCII-clean) (28349f9c)
- [NIT] `_riu_owner_count` compared with a string operator `= 1` in two spots, numeric elsewhere --> FIXED (use `-eq 1` consistently)

#### Iteration 6
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 0 NITs
**Converged** — no actionable findings. Reviewer explicitly confirmed all four changed files are pure ASCII and every resolution arm is correct.

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | WARNING | resolve-install-user.sh | ambiguous+console tiebreak reintroduced #1880 variant | FIXED | 9940b709 |
| 2 | 1 | WARNING | plan/resolver | real-boundary coverage gap (no live install) | DEFERRED | bot session cannot run a .pkg install; post-merge smoke recommended |
| 3 | 1 | NIT | resolve-install-user.sh | `_riu_*` vars reserved in sourcing scope | FIXED | 9940b709 |
| 4 | 2 | WARNING | resolve-install-user.sh | `-le 1` fallback redirected to console holder | FIXED | 90a3894d |
| 5 | 2 | NIT | resolve-install-user.sh | bare-basename Installer match | FIXED | 90a3894d |
| 6 | 3 | WARNING | resolve-install-user.sh | failure message could lie about console session | FIXED | 5869d288 |
| 7 | 3 | WARNING | resolve-install-user.sh | `ps` comm truncation dependency | DEFERRED | documented; graceful degradation; real-install smoke |
| 8 | 3 | NIT | resolve-install-user.sh | SIP comment overstated; anchor to exact /System path | FIXED | 5869d288 |
| 9 | 3 | NIT | test | re-source footgun note | FIXED | 5869d288 |
| 10 | 4 | NIT | resolve-install-user.sh | `grep -c` exit 1 on 0-owner path (set -e trap) | FIXED | 8ba94782 |
| 11 | 4 | NIT | resolve-install-user.sh | count==1 wording vs unresolvable uid | DEFERRED | near-impossible; wording keeps common-case detail |
| 12 | 5 | CONVENTION | plan | em dashes in committed Josh-readable doc | FIXED | 28349f9c |
| 13 | 5 | NIT | resolve-install-user.sh | operator consistency `= 1` -> `-eq 1` | FIXED | 28349f9c |

### Deferred items (for operator visibility)
- **Real multi-account install smoke** (WARNING, iter 1/3): the four system sensors (`stat /dev/console`, `ps -axo`, `id -u`, `launchctl print gui/<uid>`) are not exercised against a live multi-account `.pkg` install; only the awk owner-parse runs against canned `ps` lines. Deferred because a bot session cannot run a real install. The load-bearing assumption (the GUI Installer.app process is owned by the invoking user, and a passing `launchctl print gui/<uid>` means downstream `asuser`/`bootstrap gui/<uid>` will work) is sound in principle and no stricter than the existing downstream requirement; a real multi-account install smoke is the closing check and is recorded in the plan's follow-on.
- **count==1 refusal wording** (NIT, iter 4): says "no active window session" for a sole Installer owner that failed candidate 1, which is accurate for the near-universal no-session case but not for the near-impossible unresolvable-uid case. Kept the common-case wording deliberately.

### NITs addressed inline
All NITs above were either FIXED or DEFERRED with reasoning; none left open.

### Strengths (across all iterations)
- Both dangerous arms the old `/dev/console` guard got wrong (false-refusal and silent-misinstall) are closed and asserted by the test; verified by mutation that the test reds on the old console-only behavior.
- The test sources the SHIPPED resolver and overrides only sensor functions, so the code under test is the code that ships; a dedicated CONTROL arm proves the Aqua-session gate actually gates (session-dependent arms are not vacuous).
- The invoker match anchors on the exact SIP-protected CoreServices Installer.app exec path, resisting a rogue same-named binary; verified in production that `ps -o comm=` emits full untruncated paths so the anchor is not a silent no-op.
- The resolver refuses rather than guesses on every ambiguous/contradictory signal; refusal messages accurately name which check failed.
- The postinstall seam is minimal (only the SOURCE of CONSOLE_USER/CONSOLE_UID changes); the helper is bundled by the existing `pkgbuild --scripts` mechanism and hashed by `pkg-inputs.sh`, forcing a pkg rebuild so the fix cannot silently fail to reach users.

### Note on validation
Iteration-4's full-suite validation went red once on `tools/test-browser-run-guard.sh` (#1391) due to a concurrent browser-checks run on the shared Mac (load 4.09; the harness's own "green alone is contention" note fired). Confirmed by rerunning that file alone (all clear) and re-running the full suite once the contention cleared (green, same code). The 6j final validation on the converged HEAD passed cleanly.
