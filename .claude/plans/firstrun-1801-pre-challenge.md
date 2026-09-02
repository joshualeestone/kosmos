---
pre_challenge: true
method: challenge-loop
branch: firstrun-1801
diff_hash: 292190e2e52b2430712aa7b18e522be8df391a31aa9b7807adf26b981dad0082
validation: passed
subdir_audit: passed
timestamp: 2026-09-02T13:20:00Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (three consecutive independent blind passes, 0 actionable findings each)
**Total findings:** 6 NITs, 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs (plus many STRENGTHs)
**Fixed:** 4 NITs | **Deferred (informational, no change):** 2 | **Asked:** 0

Validation for this change (a change isolated to `docs/browser-checks/` test
scripts, which no `*.test.js` imports except the README index test): `node --check`
on all five files, `browser-checks-indexed.test.js` (README<->files parity),
`git status --porcelain` clean, and a full headless behavioral run of the four
converted checks on a sandboxed board (the same `boot_board` / `boot_board_rich`
setup `tools/browser-checks.sh` uses). The full engine suite (`run-tests.sh`,
`node --test *.test.js`) does not exercise browser-check scripts and is orthogonal.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
- [NIT] lib-firstrun-steps.js:8 — header said "five checks", README says "four" --> FIXED (cdb957e0): aligned to four (the four step-index checks this change converts).
- [NIT] click-first-run.js:41 — advanceToAboutYou would hang ~30s if a future intermediate step gained a gate --> FIXED (cdb957e0): read at-About-you and Continue-disabled in one round-trip and fail fast with a clear reason.
- [NIT] lib-firstrun-steps.js:71 — gotoStepForAnchor does two navigations --> DEFERRED: necessary given panes-at-load; a comment already explains it.
- STRENGTHs: discovery keys on static markup (no boot race); paneCount cross-check non-tautological; waitAboutYouLeft repairs a now-vacuous wait; no orphaned hard-coded steps remain.

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Duplicates of prior findings:** 0
- [NIT] render-first-run.js:55 — stale "(step 6)" in a comment about the return-step fixtures (return step is the Success screen) --> FIXED (3b703d7b): dropped the stale number, in keeping with the change's theme.
- STRENGTHs: stepForAnchor fails loud not silent; segCount/total cross-checks non-vacuous; advanceToAboutYou checks atAboutYou before nextDisabled (About-you's own disabled Continue never false-throws); walk strictly more robust than the old rapid-fire clicks.

#### Iteration 3
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Duplicates of prior findings:** 1 (the two-navigation observation, already recorded)
- [NIT] render-first-run.js:373 — two-navigation discovery doubles page loads for `at:` shots --> DEFERRED: reviewer states "no change required"; the necessary pattern given panes-at-load.
- [NIT] click-first-run.js:41 — the "every step before About-you is ungated" comment slightly overstated the invariant (the model step's Continue can disable on a non-connected subscription, which these callers do not mock) --> FIXED (9314403e): named that condition rather than claiming an unconditional invariant.
- STRENGTHs: reviewer traced the walk path (steps 3->4->5) through frGo and confirmed no false-throw; showing-count fix covers fr-pane-7; scope discipline correct (structurally-fixed opening frames left numbered, only moved steps content-keyed).

**Convergence:** the actionable axis (BLOCKER/WARNING/CONVENTION) returned zero across all three independent blind passes. Remaining items were NITs (4 fixed, 2 informational) and STRENGTHs. No re-iteration was triggered by an actionable finding.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | NIT | lib-firstrun-steps.js:8 | "five checks" vs README "four" | FIXED | cdb957e0 |
| 2 | 1 | NIT | click-first-run.js:41 | walk could hang ~30s on a future gate | FIXED | cdb957e0 |
| 3 | 1 | NIT | lib-firstrun-steps.js:71 | two navigations per discovery | DEFERRED | necessary; commented |
| 4 | 2 | NIT | render-first-run.js:55 | stale "(step 6)" comment | FIXED | 3b703d7b |
| 5 | 3 | NIT | render-first-run.js:373 | two-nav doubles page loads | DEFERRED | reviewer: no change required |
| 6 | 3 | NIT | click-first-run.js:41 | walk-invariant comment overstated | FIXED | 9314403e |

### Outstanding questions (ASKED, still unresolved)
None.

### NITs (non-blocking, across all iterations)
- [NIT] lib-firstrun-steps.js:71 / render-first-run.js:373 — the two-navigation discovery (bare load to read the step, then navigate to it) adds one page load per discovery. Necessary because panes are read at load; deferred by design.

### Strengths (across all iterations)
- Identity-over-index is the correct structural fix; verified against origin/main markup (`#fr-you`->pane-6, `#fr-fleet`->pane-7, 7 static panes at domcontentloaded).
- stepForAnchor fails loud (throws) rather than falling back to an index — the exact silent-wrong-number failure #1801 exists to kill.
- paneCount cross-checks the dynamic crumb/segments against the static panes — genuinely non-vacuous.
- waitAboutYouLeft repairs a real silent false-pass (the old fr-pane-5 wait resolved instantly post-#1214).
- advanceToAboutYou is more robust than the old fixed-count clicks and fails fast on an unexpected gate.
- Scope discipline: only the moved steps (About-you, fleet) are content-keyed; structurally-fixed opening frames left as-is.

### Out-of-scope residual (documented, not this card's axis)
- click-first-run's `#roles-list .pick2:visible === 3` (~line 286) is #1652 (an added `pick-import` radio makes it 4), the same class as render-role-order, pre-existing on origin/main and fixed on a separate branch. Deliberately not touched here; it is the one red the behavioral run leaves.
