---
pre_challenge: true
method: challenge-loop
branch: pkg-arch-guard-2792
diff_hash: 9adba73e1d6c267e5eacee44c96a430365301513caff74ba8bc45a8931dbee34
validation: passed
subdir_audit: passed
timestamp: 2026-09-11T14:08:28Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Yes
**Total findings:** 1 (0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT)
**Fixed:** 0 | **Deferred:** 1 (the NIT) | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 (ITER_COMMITS empty; 6.0 validation passed, no pre-review commit)
**Converged** -- zero actionable findings; the sole NIT the reviewer itself labels "not a real gap".

The blind reviewer independently:
- reproduced the productbuild round-trip (rc=0) + pkgutil --expand and confirmed the
  installation-check, the hw.optional.arm64 read, and the Fatal result type survive byte-for-byte
  into the shipped Distribution file
- confirmed the try/catch fails CLOSED (any sysctl throw refuses with the clear message rather than
  silently allowing Intel), and that hw.optional.arm64 = 1 on the Apple-silicon test box (the
  positive branch)
- confirmed the hostArchitectures="arm64,x86_64" retention is necessary (dropping x86_64 would make
  Installer refuse Intel with its OWN generic message before the check runs)
- confirmed XML/shell safety (no $, backtick, or XML-special char in the added heredoc block;
  xmllint clean; productbuild clean)
- confirmed the test is non-vacuous (7/7 incl. the negative control) and registered in test:shell
  (tools.every-test-runs.test.js passes), and that setup.sh's own guard is untouched (additive
  defense-in-depth), test-pkg-input-guard still passes, no em dashes

### Deferred finding

- **NIT** tools/test-pkg-arch-guard-2792.sh: only one explicit negative control; the other four
  presence assertions are plain literal-string greps. DEFERRED: the reviewer itself calls this "not
  a real gap" -- a literal-string `grep -q` is trivially falsifiable by inspection, and the one
  negative control proves the harness can fail. Adding four more controls is gold-plating a
  fast presence test; the coverage that matters (the guard is present, Fatal, names Apple silicon,
  reads the sysctl, keeps x86_64) is asserted.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | NIT | tools/test-pkg-arch-guard-2792.sh | BRANCH | one explicit negative control, not one per assertion | DEFERRED | reviewer: "not a real gap"; literal greps are trivially falsifiable |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking)
- tools/test-pkg-arch-guard-2792.sh: one negative control rather than one per presence assertion (deferred, see above)

### Strengths (across all iterations)
- The installer arch guard is verified end-to-end into the shipped artifact (productbuild + pkgutil expand), not just asserted (iteration 1)
- Fails closed: any sysctl throw refuses Intel with the clear message rather than silently allowing it (iteration 1)
- Additive defense-in-depth: setup.sh's own guard is untouched; the fix adds the missing .pkg-path clear message (iteration 1)
- The new guard is locked in by a registered, non-vacuous test so a future template edit cannot silently drop it (iteration 1)

### Stated limitation (carried from the plan, not a review finding)
The macOS Installer JS engine cannot be exercised on a real INTEL Mac from this Apple-silicon box,
so the LIVE Intel refusal is not machine-verified here -- only its presence, shape, and productbuild
acceptance are. A one-time hand-verify on Intel hardware (or a signed test build) is recommended at
the next cut. The fix cannot make Intel worse than the pre-fix generic failure, so this does not
block it.
