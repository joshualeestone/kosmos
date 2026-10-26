---
pre_challenge: true
method: challenge-loop
branch: pickerfront-7209
diff_hash: bb810818a3d6ff452cde633f606f97f48e010bf3234d47cf9b0271a67ee89006
validation: passed
subdir_audit: passed
timestamp: 2026-10-26T17:09:25Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (opus, a fresh blind reviewer each round). **Converged:** Yes, at iteration 2 (zero BLOCKER/WARNING).
**Total findings:** 2 WARNINGs, 2 NITs. **Fixed:** 1 | **Accepted and stated:** 1 | **No action:** 2

The Mac app's file picker is shown at the floating level so a click on the Kosmos window cannot bury it (#7209), with
a selftest arm in the release gate. Validation: the selftest built with swiftc, control (main's level) red on the new
arm, fix green on every arm; tools.filepanel-gate.test.js 21/21; every test that reads main.swift or
build-kosmos-bundle.sh, 878 pass, 0 fail.

### Per-Iteration Breakdown

#### Iteration 1 (opus)
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT.
- Checked that the floating level breaks nothing else: the #4412 watch and openPanelStillUp read only isVisible and
  NSApp.isActive; ownDialogOpen reads modalWindow, attachedSheet and openPanelOutstanding; runModal alerts sit at
  modal-panel level, above floating; the with-a-sheet-up arm's picker now floats over the sheet; no other window
  sets a level.
- [WARNING] main.swift selftest arm: no proof the reorder landed; a picker shown last could stay in front and pass
  on a build without the fix --> FIXED: the arm also requires p.level above win.level (commit 57c0cf56fa); re-run:
  control red, fix green.
- [WARNING] main.swift runOpenPanelWith: a floating picker left open covers other apps while Kosmos is in the
  background --> ACCEPTED, stated in the code comment, the plan and the PR (hidesOnDeactivate would hide the
  picker in the gate's selftest, which can never become the active app, measured).
- [NIT] tools.filepanel-gate.test.js: slice edits correct; no exit-1 test naming the new arm --> no action (the
  drop-each-line loop covers its absence at exit 0, and exit 1 fails the gate regardless).

#### Iteration 2 (opus)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT.
- Re-checked alerts, the #4412 watch, other windows, the #2807 arm and multiple displays against the floating
  level: unchanged behaviour. The new arm cannot pass on a broken build (both windows at normal level fail the
  level check). Gate list and fixture order, and the three slice bumps, match their comments.
- [NIT] main.swift:3703: the certificate-pin warning is a sheet on the main window and would sit under a floating
  picker if both were up at once --> no action: rare, nothing is lost, both stay answerable.
**Converged.**

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status |
|---|------|----------|------|--------|-------------|--------|
| 1 | 1 | WARNING | native-app/main.swift | BRANCH | arm could pass without a real reorder | FIXED (level check) |
| 2 | 1 | WARNING | native-app/main.swift | BRANCH | floating picker covers other apps while away | ACCEPTED, stated |
| 3 | 1 | NIT | tools.filepanel-gate.test.js | BRANCH | no exit-1 test names the new arm | NO ACTION |
| 4 | 2 | NIT | native-app/main.swift | PRE-EXISTING | pin-warning sheet under a floating picker | NO ACTION |
