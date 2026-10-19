---
pre_challenge: true
method: challenge-loop
branch: macsig-6468
diff_hash: e79685f718724c71fd122a55d4398f16993cae5fa7bcca5c202f8bf83c09e57b
validation: passed
subdir_audit: passed
timestamp: 2026-10-18T09:50:21Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 blind reviews, alternating opus and sonnet
**Converged:** Yes (iteration 4, sonnet: NITs only)
**Total findings:** 11 actionable (0 BLOCKERs, 8 SHOULD-FIX, 3 test gaps), about 12 NITs
**Fixed:** 10 | **Deferred:** 2 (documented in the function comment) | **Asked (awaiting user):** 0

Round 1 (opus): signer change recovery, older genuine release passes, JS not covered (all stated as limits; version
binding is ask 2), symlinked parent folders (fixed), unreadable signature skipped (fixed: now a refusal), one line for
ad-hoc installs (fixed), .app/--deep and team-clause arms (fixed: three REAL INSTALL arms).
Round 2 (sonnet): match codesign's own lines not the path (fixed + arm), errexit in the harness (fixed), message
asserts (fixed).
Round 3 (opus): the refusal told the person to uninstall and reinstall, which is the way around the check (fixed + arm),
linked or unsigned installed parts named (fixed + arms). Deferred: an interrupted swap holds only the runtime on the
rerun; tmux is fetched and run before this check (both stated in the comment / card).
Round 4 (sonnet): no blockers, no should-fix. Its tar-extract worry measured: the served 0.7.56 tarball unpacked with
tar passes against this Mac's 0.7.55 install.

Validation: install.update-signer-6468.test.js 14/14 (four mutants each go red); the 30 test files that read
install/setup.sh 478/478 after rebasing onto origin/main; live arms on this Mac's Developer ID install (a copy of
itself accepted, a re-signed part refused). The full suite runs in PR CI.

## Final ledger

### Iteration 1 (opus)
- [WARNING] a signer change can never be updated past; recovery stated in the comment (FIXED: documented)
- [WARNING] an older genuine release passes (DEFERRED: ask 2 binds the version)
- [WARNING] JS and bin/kosmos not covered; comment overstated (FIXED: comment rewritten)
- [NIT] symlinked parent folder passes codesign (FIXED + arm)
- [NIT] unreadable installed signature skipped (FIXED: refusal)
- [NIT] one line per ad-hoc part (FIXED)
- [WARNING] no .app/--deep or team-clause arms (FIXED: three REAL INSTALL arms)

### Iteration 2 (sonnet)
- [NIT] harness ran without errexit (FIXED)
- [NIT] ad-hoc match read the whole output incl. the path (FIXED + arm)
- [NIT] symlink and unsigned arms asserted only the exit code (FIXED)

### Iteration 3 (opus)
- [WARNING] the refusal told the person to uninstall and reinstall, the way around the check (FIXED + arm)
- [NIT] interrupted swap rerun holds only the runtime (DEFERRED: documented KNOWN GAP)
- [NIT] symlinked installed part skipped silently (FIXED + arm)
- [NIT] unsigned installed branch untested (FIXED + arm, mutant red)
- [NIT] REAL re-signed arm asserted only the exit (FIXED)

### Iteration 4 (sonnet)
- No BLOCKER or WARNING findings.
- [NIT] "local build" wording for older unsigned releases (FIXED)
- [NIT] unreadable-signature refusal has no arm (codesign is called by absolute path; not stubbed)
- [NIT] tar-extracted genuine tarball untested (MEASURED: served 0.7.56 passes against the 0.7.55 install)
