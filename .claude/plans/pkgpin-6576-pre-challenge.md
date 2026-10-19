---
pre_challenge: true
method: challenge-loop
branch: pkgpin-6576
diff_hash: 8567c419069907a142c7779cd55f3fb77a38ee8c312348c65b8a38a3aa54173c
validation: passed
subdir_audit: passed
timestamp: 2026-10-19T17:17:27Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes
**Total findings:** 1 BLOCKER, 13 WARNINGs, 3 CONVENTIONs, many NITs
**Fixed:** 15 | **Deferred:** 5 | **Asked (awaiting user):** 0

Validation note, stated plainly: per-iteration checks were the focused suites (install.pkg-verify-6576.test.js, test-pkg-checksum-1670, test-postinstall-inline-quoting, test-install-page-readable-3268, test-install-progress-emit-3233, test-pkg-input-guard, test-pkg-arch-gate-1562, tools.pkg-checksum-home-6507, install.installing-page) with perturbation controls; 6j's full validation ran once on the converged HEAD 4b6c1d1cb1: PASSED (22199 tests, 0 fail), audit clean. The weakest premise (Apple notarizes a package whose scripts carry a signed Mach-O) was measured: a trial package built by tools/build-installer-pkg.sh from this branch was notarized and stapled; the helper inside it is Developer ID signed with the hardened runtime and checks the served staging release.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 5 WARNINGs, 2 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] tools/lib/pkg-inputs.sh - the unreadable check never saw the release-check dir --> FIXED (0a6a16cdb9), tested both arms
- [WARNING] install/pkg-scripts/postinstall - existing-install predicate looser than the hand-off --> FIXED: every install is pinned when on
- [WARNING] install/pkg-scripts/postinstall - pointer read without cache-buster; version not handed on --> FIXED: busted, KOSMOS_PINNED_VERSION
- [WARNING] install/pkg-scripts/postinstall - a mismatching installer was not rechecked --> FIXED: retried on the budget, tested (recheck then success)
- [WARNING] install/setup.sh - the pin call sites were untested --> FIXED: a test pins them right after the checksum, before unpack
- [CONVENTION] tools/build-installer-pkg.sh, tools/lib/pkg-inputs.sh - stale headers --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0
- [WARNING] postinstall - a pinned run skips the #6474 hand-off --> FIXED (comment); the installed verifier still refuses an older release (manifest-verify.js:90)
- [WARNING] main.swift - a signed staging release passes a production package --> DEFERRED: documented limit (a manifest names no channel; still a Kosmos-signed release)
- NITs fixed: byte-wise hex, status-2 wording, build note, tmux republish note

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 7 NITs (fixed: status mapping, a.b.c before use, manifest cache-bust, stale comments, the existing-install test now proves the hand-off is not reached with a control that sees it run)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 3 NITs
- [WARNING] setup.sh - pins leaked into the board's environment (the next in-app update would refuse) --> FIXED (6967fd5097): read once, unset; tested
- [WARNING] postinstall - a 97 was not retried --> FIXED: rechecked on the budget
- [NIT] main.swift - numeric version compare --> FIXED: exact string, tested (0.7.060)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs, 4 NITs
- [BLOCKER] postinstall/setup.sh - an older genuinely signed installer ignores the pins, so the downloads would go unchecked --> FIXED (4b6c1d1cb1): the checked installer must carry "# kosmos-pkg-pins: honored" (read after its sha256 matched the signed release); tested
- [WARNING] postinstall - installer fetch not cache-busted --> FIXED
- [WARNING] main.swift - old packages refuse after a key rotation --> DEFERRED: documented residual
- NITs fixed: arm64 check, retry sleep clamp, release.sh 3c comment

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs; 2 WARNINGs, both duplicates (rollback bounded by the floor: iteration 2's documented limit; the Application identity requirement: iteration 2's note); NITs only
**Converged** - no new actionable findings.

### Final Ledger (actionable)

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | tools/lib/pkg-inputs.sh | BRANCH | release-check dir not in the unreadable check | FIXED | 0a6a16cdb9 |
| 2 | 1 | WARNING | install/pkg-scripts/postinstall | BRANCH | existing-install predicate | FIXED | 0a6a16cdb9 |
| 3 | 1 | WARNING | install/pkg-scripts/postinstall | BRANCH | pointer cache / version hand-off | FIXED | 0a6a16cdb9 |
| 4 | 1 | WARNING | install/pkg-scripts/postinstall | BRANCH | mismatch not rechecked | FIXED | 0a6a16cdb9 |
| 5 | 1 | WARNING | install/setup.sh | BRANCH | pin call sites untested | FIXED | 0a6a16cdb9 |
| 6 | 2 | WARNING | install/pkg-verify/main.swift | BRANCH | staging release passes | DEFERRED | documented limit |
| 7 | 4 | WARNING | install/setup.sh | BRANCH | pins leak to the board | FIXED | 6967fd5097 |
| 8 | 4 | WARNING | install/pkg-scripts/postinstall | BRANCH | 97 not retried | FIXED | 6967fd5097 |
| 9 | 5 | BLOCKER | install/pkg-scripts/postinstall | BRANCH | old installer ignores pins | FIXED | 4b6c1d1cb1 |
| 10 | 5 | WARNING | install/pkg-scripts/postinstall | BRANCH | installer fetch not busted | FIXED | 4b6c1d1cb1 |
| 11 | 5 | WARNING | install/pkg-verify/main.swift | BRANCH | old packages after rotation | DEFERRED | documented residual |

### NITs (non-blocking)
- tools/macos-floor is not a pkg input (documented residual)
- the progress page stays up on a refusal; the sentence goes to the Installer log and failure screen
- KOSMOS_TMUX_SRC / local bundle overrides are outside the pins (user-controlled)

### Strengths
- the signature is checked over the manifest's exact bytes before any field is read; no pin is printed until all three check
- root downloads into a root-owned folder; the person's shell runs exactly the checked file and downloads nothing
- fail-closed throughout, with distinct sentences for a refused release and a check that could not run
- tests run the real compiled helper with a throwaway key and the real postinstall step against a file:// site with the real curl
