---
pre_challenge: true
method: challenge-loop
branch: dlrestart-9093
diff_hash: 1c69e2640e9e40f9ab69aeecca646160066b348d5fa40ef9eb635af1d1682d1e
validation: passed
subdir_audit: passed
timestamp: 2026-11-26T09:42:00Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 blind review rounds, each a fresh agent given the diff and the card, not my reasoning.
**Converged:** Yes. Round 2's findings were all fixed in 96c258837e and left nothing open. Every finding from both rounds is fixed; nothing was left.
**Change:** native-app/main.swift. A download macOS refuses (EPERM) in a window whose executable was replaced on disk since launch now asks "Kosmos was updated or moved while it was open". It offers Restart Kosmos (the existing stale-app relaunch), Choose Where to Save..., or Cancel. Details: .claude/plans/dlrestart-9093.md.

## Validation
- Full validation ON MORTALS (mortals-validate.sh), head 21b929a8d9: node suite 31,290 tests, 0 fail; test:shell 4 shards all green; status clean; the remote hash 1c69e2640e9e equals the local one, and the entry is recorded locally.
- The first full validation (on this Mac, head cd143e7201) failed one test. native-app.computer-mode-4356.test.js pins the native selftest's expected count, and this branch added 9 rows (320 to 329). It was fixed in 21b929a8d9, and both native-app files then passed 70 of 70.
- Native selftest 329/329 (a real rename-over, checked). native-app.download-5167.test.js 38/38. Removal controls go red.
- Subdir audit: the branch changes no subdirectory CLAUDE.md.

### Per-Iteration Breakdown
#### Iteration 1
- SHOULD: "your agents keep running" is false on a connect computer (#4356's rule) --> FIXED (the words no longer say it)
- SHOULD: Restart could drop words not yet sent --> FIXED (the page is asked first, through the stale-app question; unsent words are named)
- SHOULD: Choose Where to Save... was lost from the question --> FIXED (kept, through one shared guard, saveElsewhereRequest, used by both callers)
- SHOULD: a same-version replacement left relaunchedAtVersion, so #1182 would read it as a failed reopen --> FIXED (cleared)
- NIT: title and wording ("updated or moved"; "save to Downloads", not "save files") --> FIXED; selftest gained a real rename-over row and 2 word rows
- NIT: an unset selftest seam --> FIXED (removed)
#### Iteration 2
- SHOULD: offerSaveElsewhere reads the page only when called, so a page that changed while the person decided was not voided --> FIXED (the page at the failure is checked first)
- NIT: the words overstated certainty --> FIXED ("did not let... should let it save again"; the loss sentence tied to restarting; another place offered last)
- NIT: Escape had no answer --> FIXED (the safe button is titled Cancel, which NSAlert maps Escape to)
- Added JS pins: alertsOnScreen, Return and Escape, the #1182 marker clearing, the page answer, and the page check.

## Weakest premise (from the plan)
That the replaced executable is what causes the EPERM. My first theory for the dead Save panel failed its own test. This change only offers Restart when a replacement is detected, so a window whose file was not replaced sees the old alert unchanged.
