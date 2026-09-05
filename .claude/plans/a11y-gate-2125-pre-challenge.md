---
pre_challenge: true
method: challenge-loop
branch: a11y-gate-2125
diff_hash: 60d6993869ce2c3318ad29aa1b30dc4037c46045aa1e1fa420dff063c7fe9a93
validation: passed
subdir_audit: passed
timestamp: 2026-09-05T02:57:26Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (6.0 fix-and-validate = iteration 1; two fresh blind reviews)
**Converged:** Yes — iteration 3 returned zero NEW BLOCKER/WARNING/CONVENTION.
**Total findings:** 1 BLOCKER (initial-validation), 1 WARNING, 6 NITs; plus many STRENGTHs.
**Fixed:** 5 | **Deferred:** 3 (2 NITs by design + 1 NIT duplicate) | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1 (6.0 baseline validation)
**New findings:** 1 BLOCKER.
- [BLOCKER] web.firstrun-a11y-1214.test.js — the full suite red 3 of its tests: slice-3's Continue-gate + copy change (committed earlier) superseded the #1214/#1940 offer-not-require contract these tests pinned, but they were never reconciled. --> FIXED (commit 88e5420b): updated to the shipped #2125 gated contract, keeping every still-valid assertion (button exists, "Tmux in Accessibility" copy, 7 steps, Settings box unchanged, no em dashes). This is the "run the existing suite before 'no regression'" lesson: a shared-surface change breaks contracts in EXISTING module tests, not just the new one.

#### Iteration 2 (first fresh blind review)
**New findings:** 1 WARNING, 2 NITs.
- [WARNING] native-app/main.swift — the under-tmux spawn path (startA11yTrustChecks/spawnAxHatchUnderTmux) was exercised by no test that actually runs it; every test invoked the binary directly. --> FIXED (commit a3abf829): added a real under-tmux arm to tools/test-a11y-writer-mock-2125.sh that spawns via the actual `tmux -L kosmos-axcheck new-session -d '<exe> --kosmos-app-axcheck'` shape with AGENT_WORKFORCE_DATA set and asserts the reading lands under the store the engine reads. Measured: a private -L socket is a fresh tmux server that inherits the parent environment, so AGENT_WORKFORCE_DATA propagates and the hatch resolves the same store as the board.
- [NIT] native-app.a11y-writer-2125.test.js — a dead `const fn` slice in the shape test. --> FIXED (a3abf829).
- [NIT] web/index.html — the gate is soft-open at entry (Continue enabled until the first async poll). --> FIXED (a3abf829): made the intended fail-safe behavior explicit in a comment so it is not "fixed" into a hard-close; that comment exposed a brittle fixed-distance test window, now sliced-to-the-block.

#### Iteration 3 (second fresh blind review)
**New findings:** 0 BLOCKER, 0 WARNING, 0 CONVENTION. **Converged.** 4 NITs:
- [NIT] soft-open at entry — DUPLICATE of iteration 2's, already addressed. Confirmed resolved.
- [NIT] native-app/main.swift currentlyTrusted() ignored staleness — a days-old trusted:true could suppress the launch prompt. --> FIXED (commit c736fa79): bounded to 300s, mirroring a11ystatus.STALE_AFTER_MS, pinned by a source-wiring assertion.
- [NIT] KOSMOS_AXCHECK_FORCE_TRUSTED is a live env seam in the shipped binary (a user env carrying =0 would false-block). --> DEFERRED: the seam MUST be live in the release binary for the build-bundle smoke to exercise both trust states; it follows the codebase's established release-binary test-seam pattern (KOSMOS_APP_TEST_*, KOSMOS_URL), obscure name, never set by the installer.
- [NIT] build-smoke --kosmos-app-axprompt surfaces a system dialog on an untrusted build host. --> DEFERRED: benign on a cut machine (headless hosts do not show it, headed cuts auto-handle the non-blocking dialog under the alarm) and it preserves the flag-drift catch.

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | BLOCKER | web.firstrun-a11y-1214.test.js | 3 #1214/#1940 tests red vs the #2125 gate | FIXED | 88e5420b |
| 2 | 2 | WARNING | native-app/main.swift | under-tmux spawn path untested | FIXED | a3abf829 |
| 3 | 2 | NIT | native-app.a11y-writer-2125.test.js | dead `fn` slice | FIXED | a3abf829 |
| 4 | 2 | NIT | web/index.html | soft-open-at-entry undocumented | FIXED | a3abf829 |
| 5 | 3 | NIT | native-app/main.swift | currentlyTrusted ignored staleness | FIXED | c736fa79 |
| 6 | 3 | NIT | native-app/main.swift | KOSMOS_AXCHECK_FORCE_TRUSTED live seam | DEFERRED | necessary for the release-binary build smoke; codebase test-seam pattern |
| 7 | 3 | NIT | tools/build-kosmos-bundle.sh | axprompt dialog on build host | DEFERRED | benign on cut machines; preserves flag-drift catch |

### Outstanding questions (ASKED, still unresolved)
None.

### NITs (non-blocking)
- KOSMOS_AXCHECK_FORCE_TRUSTED live env seam (deferred, iteration 3)
- build-smoke axprompt dialog (deferred, iteration 3)

### Strengths (across iterations)
- Fail-safe integrity holds end to end: the ONLY state that disables Continue is a positive checkable:true+trusted:false; every uncheckable/stale/malformed/fetch-error state leaves Continue enabled, so no unmeasured state can false-block (both reviewers verified by tracing every state).
- The cross-language path seam is correct across all three resolution arms and doubly pinned (source-wiring test + mock shell test assert byte-identical writer/reader paths).
- The hand-built JSON contract is exact and validated live through the engine for both trust states.
- The mock shell test is honest and non-vacuous: it compiles a real binary, drives both trust states across the writer->file->engine seam, exercises the real under-tmux private-socket spawn, and carries a count floor.
- The load-bearing attribution unknown is clearly flagged as a DEFERRED fresh-install gate on #2125, with the bias-to-trusted mitigation documented and prod protected by the fail-safe frontend gate.

## 🛑 DEFERRED FRESH-INSTALL GATE (to flag on #2125)
The under-tmux attribution (does the AX read report tmux's trust or the app's?) is UNVERIFIED. Before #2125 promotes to prod, verify on a FRESH macOS install that granting Tmux flips the reading to trusted and unblocks Continue, and an ungranted Tmux blocks with the pane's guidance. Prod stays protected until then (the frontend gate is fail-safe).
