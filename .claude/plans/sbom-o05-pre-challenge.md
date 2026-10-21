---
pre_challenge: true
method: challenge-loop
branch: sbom-o05
diff_hash: c1c49d8c143ab18ddadd43113c0b2a65252e94474f76b130eecd51325d2e62cd
validation: passed
subdir_audit: passed
timestamp: 2026-10-20T04:39:45Z
iterations: 40
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 40
**Converged:** Yes (iteration 40 found no BLOCKER, WARNING or CONVENTION; its notes were applied)
**Total findings:** about 230 across 40 rounds. Every round's findings and fixes are recorded in its own commit on this branch (`git log origin/main..HEAD`, 52 commits, each named "review N"), which is the ledger of record.
**Fixed:** all BLOCKERs and WARNINGs | **Deferred:** stated in the plan's "Not covered, by design" | **Asked (awaiting user):** 0

### Per-Iteration Breakdown (by theme; each round's detail is its commit)

#### Iterations 1 to 10
**Reviewer model:** alternating opus and sonnet
**Findings (themes):**
- [BLOCKER] Every lock source is handled or refused. --> FIXED
- [WARNING] Refs carry (source) when ambiguous. --> FIXED
- [WARNING] Tables end a package. --> FIXED
- [WARNING] Code-point ordering. --> FIXED
- [WARNING] The tmux bundle is read from its signed hash. --> FIXED
- [WARNING] The manifest is used only when its signature verifies under a pinned key. --> FIXED
- [WARNING] First-party places are exact. --> FIXED

#### Iterations 11 to 24
**Reviewer model:** alternating
**Findings (themes):**
- [BLOCKER] A hostile relay commit could act on this machine (a committed .cargo/config, rust-toolchain, .git or symlink). --> FIXED: plain files only, refusals per path, cat-file writes
- [WARNING] Git and Cargo environment isolation. --> FIXED
- [WARNING] Timeouts. --> FIXED
- [WARNING] The Swift imports are read by the compiler. --> FIXED

#### Iterations 25 to 36
**Reviewer model:** alternating
**Findings (themes):**
- [BLOCKER] The hand-written resolver lost to Cargo. --> FIXED: Cargo decides (cargo metadata --locked --offline, compared with the lock)
- [WARNING] Strict parsing of the lock. --> FIXED
- [WARNING] Atomic output. --> FIXED

#### Iterations 37 to 40
**Reviewer model:** opus, sonnet, opus, sonnet
**New findings:** 0 BLOCKERs at round 40
- [WARNING] The serial number covers the whole manifest. --> FIXED (37)
- [WARNING] Every vouched field has an arm. --> FIXED (37)
- [WARNING] A `..` path refusal arm. --> FIXED (38)
- [WARNING] Every pattern anchor has an arm. --> FIXED (38)
- [WARNING] Both targets of the universal connector are named (190 crates). --> FIXED (39)
- [WARNING] The installer is tied to install/setup.sh at the app commit. --> FIXED (39)
- [NIT] Strict UTF-8 reads, so a hash of the text is a hash of the file. --> FIXED (40)
**Converged.**

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 11-24 | BLOCKER | tools/lib/sbom.js cargoWorkspace | BRANCH | a relay commit could act on this machine | FIXED | plain-file tree, per-path refusals |
| 2 | 25-27 | BLOCKER | tools/lib/sbom.js | BRANCH | the hand-written resolver lost to Cargo | FIXED | cargo metadata --locked --offline |
| 3 | 39 | WARNING | tools/lib/sbom.js:634 | BRANCH | the closure note named one target of a universal binary | FIXED | both targets, 190 crates |
| 4 | 39 | WARNING | tools/lib/sbom.js build | BRANCH | the installer was called first-party unchecked | FIXED | tied to install/setup.sh |

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### NITs (non-blocking, across all iterations)
- Wording, counts and stale comments, applied as found (see the commits).

### Strengths (across all iterations)
- The real 0.7.59 release produces a schema-valid SBOM, byte-identical across runs and locales.
- Every guard has an arm that a mutant fails; where it does not, the survivor is recorded as equivalent in the plan.
- The limits are stated in the SBOM's own JSON, not only in the source.
