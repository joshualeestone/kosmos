---
pre_challenge: true
method: challenge-loop
branch: updater-manifest-6466
diff_hash: 8999f4c85592b5e6df6f540013fbf95ed853bcb3714690c80c4bac38f3a5198f
validation: passed
timestamp: 2026-10-19T15:51:07Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 rounds by one blind reviewer (kept small on purpose: the Claude account is shared on this box)
**Converged:** Yes (round 2: NITs only)
**Total findings:** 0 BLOCKERs, 1 WARNING, 8 NITs
**Fixed:** the WARNING and 4 NITs; 3 NITs kept with reasons in the code and docs; 1 NIT answered with a comment

diff_hash is the sha256 of `git diff origin/main...HEAD` at cb6934217 (before this file was added).

Validation (Windows 11 box, every node run through the no-schtasks preload): engine/win32*.test.js,
engine/update*.test.js, tools.win-*.test.js and tools.build-windows*.test.js: 1490 pass, 2 fail, 8 skipped; the 2 are
engine/update.marker-1728.test.js shell arms that fail identically on an origin/main export here. The four suites
this change touches: 169 pass, 0 fail, 1 skip. tools.win-setup-ps1.test.js (the real setup.ps1 against the real
signed Kosmos.exe): 49 pass, 1 skip. tools/test-publish-r2-3725.sh under Windows PowerShell 5.1: the 9 new #6466
cases pass; 23 older cases fail here exactly as on origin/main (env-var /tmp paths 5.1 cannot read; CI runs pwsh on
macOS). Mac installer suites: identical results with the old and new engine/manifest-verify.js. Negative control: with
the B1b/B3b and plain-file checks disabled, 8 of the 10 #6466 updater tests fail.

## Final ledger
### Round 1: 1 WARNING, 6 NITs
- [WARNING] promote did not re-check that installkosmos.com still serves the manifest and .sig (FIXED: Assert-Served
  before any prod write; deploy-site.sh coverage written down in RELEASING.md as an operator follow-up)
- [NIT] the publish check compared the manifest's arch with itself (FIXED: the publish's arch is passed and checked)
- [NIT] the publish check uses this checkout's KEYS, not the served build's pinned_keys (KEPT: written as a LIMIT that
  points at manifest-sign.js check-served for a rotation; one key today)
- [NIT] promote reads "prod checks" from a manifest existing, not from the checker (FIXED: commented; it fails safe)
- [NIT] the Mac verify() does not refuse platform "win32" (KEPT: a Mac change; a Windows manifest already fails there)
- [NIT] the Kosmos.exe link arm needs a file symlink (FIXED: an unprivileged junction arm added)
- [NIT] the exact subject string could break on a format change (KEPT: the trade-off is in the EXPECTED_SUBJECT comment)
### Round 2: NITs only
- [NIT] the junction arm accepts the older completeness refusal too (ANSWERED: comment says so; the wording is pinned by
  the file-link arm, which ran here)
- [NIT] promote's served re-read is not covered by the offline harness (KEPT: it is the same Assert-Served the stage
  uses, which the harness exercises; noted as not verified in the PR)
