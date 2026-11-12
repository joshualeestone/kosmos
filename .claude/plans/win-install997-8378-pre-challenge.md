---
pre_challenge: true
method: challenge-loop
branch: win-install997-8378
diff_hash: 759d403cbefe97b933d567b4f83bbeb5964f04f0bc0720d0391d018c19f12641
validation: local only, substituted (npm is not on this box, so validation_log_run_or_skip fails before running anything): on the Windows box, engine/connect.install-997 20/0/0 (was 4/16/0 on origin/main) on 16894c2eb4; windows-tests-1777 24/24; fixture-discipline 20, no-name-refs-3071 4, engine.reachable 8, win32-separator-guard 4, windows-coupling-audit-1732 8, all 0 failed; a reviewer ran the file without the preload, stdin closed, TEMP/TMP on an 8.3 short path (20/0); the full suite and the Windows job (which now runs this file) on the PR's CI
subdir_audit: passed (no CLAUDE.md in the diff)
timestamp: 2026-11-12T15:26:35Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2 returned no BLOCKER, WARNING or CONVENTION finding, one NIT)
**Total findings:** 1 actionable (0 BLOCKERs, 1 WARNING, 0 CONVENTIONs), plus 2 NITs
**Fixed:** 1 | **Deferred:** 0 | **Asked (awaiting user):** 0

Baseline (6.0): the validation helper exits 1 here (no npm or yarn), substituted with the direct runs in the
frontmatter. Subdir CLAUDE.md audit: 0.

How the change was made: drafted by a helper agent under a written brief that required telling a fixture fault from a
production bug (none found: engine/connect.js asks for claude.exe on Windows and runners.js applies PATHEXT, both right);
the review-1 fix by Homer. Homer read the diff, checked connect.js:1326, and re-ran the file after each change.

## Iteration 1

- [WARNING] engine/connect.install-997.test.js:125-127: the override path carried .exe, so pathextCandidates returned
  it unchanged and the PATHEXT lookup production uses (claude.exe behind the extensionless ~/.local/bin/claude,
  MANIFEST.claude.binName 'claude') never ran; the success arms proved less than they looked. FIXED in 16894c2eb4:
  the override stays extensionless and both stub installers write installedAt(path) (.exe on Windows only), so success
  is reachable only through that lookup. 20/0.
- [NIT] tools/windows-tests.js:62 line length: consistent with its neighbours, unchanged.
- Verified clean: the served name follows the same rule as the download; every failure arm (no runnable binary, cancel,
  partial sweep, unresolvable home, resolver throw) still fails for its own reason on Windows; macOS and Linux unchanged.

## Iteration 2

- No BLOCKER, WARNING or CONVENTION.
- [NIT] a comment at :503 names the darwin download as its example. Not changed: the comment is about the sweep's
  naming in general and was not touched by this change.
- Untested, and untested before this change too: where the vendor installer places the binary on Windows with no
  override set (installEnvFor); this file always sets the override.

## Residual

The first run on GitHub's Windows runner (node 26; a virus scanner holding a .part file during the sweep) is the
remaining check, on the PR's CI.
