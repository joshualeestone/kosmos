---
pre_challenge: true
method: challenge-loop
branch: pw-version-assert-1708
diff_hash: 790f2037f3f37f9caaa6248ea49c5a9bcbd15d88e82d9b13101721ed9635d453
validation: passed
subdir_audit: passed
timestamp: 2026-09-01T00:18:00Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes (iteration 6 returned zero new BLOCKER/WARNING/CONVENTION after dedup)
**Total findings:** 12 (0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 8 NITs)
**Fixed:** 9 | **Deferred:** 3 | **Asked (awaiting user):** 0

kosmos#1708. The release page gate (`tools/browser-checks.sh`) now ASSERTS the
resolved Playwright equals the pinned `PW_VERSION` in `tools/provision-pw.sh`
(#1594 pinned the PROVISION with --save-exact; the gate never re-checked at run
time, so a drifted `pw-runtime` could silently render on a different browser
build). Default: warn loudly and continue. `KOSMOS_PW_STRICT_VERSION=1`: hard
stop (exit 2), including on an UNVERIFIABLE version (unverified is not pinned).
The release cut (`tools/release.sh`) sets that flag so a drifted or unpinned
build fails the cut; a manual dev run stays warn-only.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
- [WARNING] browser-checks.sh — STRICT did not hard-stop on an UNREADABLE version (fail-open under a fail-closed flag) --> FIXED (f292300c)
- [NIT] browser-checks.sh — pin derived from `$(dirname "$0")` not the freeze-aware `$REPO` --> FIXED (f292300c)
- [NIT] test — pin-read regex differed from production's `\([^"]*\)` --> FIXED (f292300c)
- [NIT] browser-checks.sh — greedy `_pw_got` sed could grab the last "version" in a minified file; switched to node parse --> FIXED (f292300c)

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
- [NIT] browser-checks.sh:247 — `require(PW_PKG)` treats a relative KOSMOS_PW_NODE_PATH as a module request --> false can't-verify --> FIXED (5cf2b379, path.resolve)
- [NIT] test — run_gate lacked KOSMOS_HARNESS_IGNORE_CUT=1; flaky when a real cut is live --> FIXED (5cf2b379)
- [NIT] test — per-invocation freeze overhead (~2s) --> DEFERRED: correct and self-cleaning, no skip env; noting only

#### Iteration 3
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
- [WARNING] test:36 — case 1 could not fail if non-strict drift started BLOCKING (only greped the DRIFT line) --> FIXED (a2fde872): assert launch-phase reached + refusal absent; red-capability verified by injecting the regression
- [WARNING] test:22 — test read the pin from the working tree while the frozen gate reads committed HEAD; spurious drift during a pin bump --> FIXED (a2fde872): read pin from `git show HEAD:`
- [WARNING] release.sh — the enforcement arm was dead code in the pipeline (nothing set STRICT) --> FIXED (a2fde872): cut invokes the gate with STRICT; plus case 5 guards the wiring
- [NIT] browser-checks.sh — pin-read sed anchors to `PW_VERSION="..."` at line start; a `readonly`/`export`/indented decl would empty it --> DEFERRED: matches provision-pw.sh today and the failure is loud and self-naming
- [NIT] browser-checks.sh — underscore-prefixed vars are top-level globals --> DEFERRED: matches this file's existing top-level convention (_eng, _err)

#### Iteration 4
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
- [WARNING] release.sh:419 — STRICT-in-cut tightens the unpinned npx-cache fallback: a release machine with no pw-runtime now hard-fails until provision-pw.sh runs --> DEFERRED (documented, not silenced): this is the intended enforcement; softening reintroduces the defect. Verified the current cut machine is pinned at 1.62.1 so its first cut will not red. Flagged in the PR body.
- [NIT] release.sh — the `🛑` refusal line is not in the summary grep --> DEFERRED: the `‼️` DRIFT line (names both versions) IS surfaced and the full log path is printed
- [NIT] browser-checks.sh — STRICT+SKIP+unreadable can't be skipped --> DEFERRED: correct fail-closed behavior; release.sh never sets SKIP (reviewer: noting only)

#### Iteration 5
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Converged** at this pass (zero new BLOCKER/WARNING/CONVENTION). Elected to close one high-consequence NIT before finalizing:
- [NIT] test — no arm proved STRICT PASSES a correctly-pinned build; since the cut runs STRICT on every release, a regression blocking correct builds would pass cases 1-5 --> FIXED (920b4fce): added case 6 (STRICT+match-proceed); red-capability verified by injecting the regression
- [NIT] browser-checks.sh — .version is a proxy for the build (playwright-core pins it) --> FIXED (920b4fce): one-line comment; launch check backstops a hand-mismatched wrapper

#### Iteration 6
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Converged** — the one NIT (the `🛑` summary-grep item) is a duplicate of the iteration-4 deferral. No new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | browser-checks.sh | STRICT fail-open on unreadable version | FIXED | f292300c |
| 2 | 1 | NIT | browser-checks.sh | pin from $0 not $REPO | FIXED | f292300c |
| 3 | 1 | NIT | test | pin regex mismatch | FIXED | f292300c |
| 4 | 1 | NIT | browser-checks.sh | greedy version sed | FIXED | f292300c |
| 5 | 2 | NIT | browser-checks.sh:247 | relative-path require false can't-verify | FIXED | 5cf2b379 |
| 6 | 2 | NIT | test | not hermetic vs live cut | FIXED | 5cf2b379 |
| 7 | 2 | NIT | test | freeze overhead | DEFERRED | correct, self-cleaning |
| 8 | 3 | WARNING | test:36 | case 1 could not fail on non-strict-blocks | FIXED | a2fde872 |
| 9 | 3 | WARNING | test:22 | pin from working tree not HEAD | FIXED | a2fde872 |
| 10 | 3 | WARNING | release.sh | enforcement dead in the cut | FIXED | a2fde872 |
| 11 | 3 | NIT | browser-checks.sh | brittle pin-read sed | DEFERRED | loud, self-naming failure |
| 12 | 3 | NIT | browser-checks.sh | underscore globals | DEFERRED | matches file convention |
| 13 | 4 | WARNING | release.sh:419 | STRICT tightens npx-cache path | DEFERRED | intended; documented in PR |
| 14 | 4 | NIT | release.sh | refusal not in summary grep | DEFERRED | DRIFT line surfaced instead |
| 15 | 4 | NIT | browser-checks.sh | STRICT+SKIP+unreadable | DEFERRED | correct fail-closed |
| 16 | 5 | NIT | test | no STRICT match-proceed arm | FIXED | 920b4fce |
| 17 | 5 | NIT | browser-checks.sh | .version is a build proxy | FIXED | 920b4fce |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### Process note (challenge-loop Step 4)
No separate `.claude/plans/` design file exists for this branch: it is a scoped
release-tooling hardening tracked by card #1708 and Splinter's "the risk is
unpinned, not unexecuted" flag, which serve as the plan for a change this size.
Recorded here as a deferred CONVENTION rather than left silent.

### NITs (non-blocking, deferred with reasoning)
- [NIT] test — per-invocation freeze overhead ~2s; correct and self-cleaning (iteration 2)
- [NIT] browser-checks.sh — pin-read sed anchors to a bare `PW_VERSION="..."`; loud, self-naming on a future refactor (iteration 3)
- [NIT] browser-checks.sh — underscore-prefixed vars are top-level globals, matching this file's existing convention (iteration 3)
- [NIT] release.sh — the `🛑` STRICT refusal line is not in the step's summary grep; the `‼️` DRIFT line (naming both versions) and the full log path are surfaced instead (iterations 4, 6)
- [NIT] browser-checks.sh — STRICT+SKIP+unreadable cannot be skipped; correct fail-closed behavior, and release.sh never sets SKIP (iteration 4)

### Strengths (across all iterations)
- Fail-closed is genuine and tested in both directions: STRICT hard-stops on drift (case 3) AND on an unreadable version (case 4), and PASSES a correctly-pinned build (case 6) -- the complete STRICT matrix
- The tests never trust rc alone: because both the version-stop and the launch failure exit 2, the STRICT cases pair `rc==2` with a branch-specific message grep, so a fail-open would still be caught
- Case 2 is a true two-arm control (identical fixture, matching version, asserts NO drift + "matches the pin"); case 1 additionally proves warn-by-default continues to the launch phase
- Case 5 pins the release.sh wiring so the enforcement cannot silently become dead code via a refactor
- The gate reads the pin from its single source of truth (no hardcoded version), and the test mirrors the gate's freeze-time read with `git show HEAD:`
