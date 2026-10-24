---
pre_challenge: true
method: challenge-loop
branch: startmenu-6985
diff_hash: 2069bc3a6cad2bdb706ecc8720e153f3c9d1eb6a3953b10af8bbc7e0b2ce33b7
validation: passed (validation_log_run_or_skip on 7127de3841: 23522 node tests, 0 failed, build passed, hash 2069bc3a6cad; browser check render-win32-board-copy PASS on chromium and webkit including "win32 not-signed-in panel points at the Start menu (#6985)"; surface gate rc=0; all 413 web.*.test.js pass; revert control: the old slow-remedy sentence put back fails web.update-settle-win32)
subdir_audit: passed
timestamp: 2026-10-23T15:48:07Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (one blind reviewer at a time: opus, then sonnet).

### Iteration 1 (opus)
- [BLOCKER] web.win32-update-offer.test.js:209 still pinned the manual update's old last step and would fail CI. Fixed in 2c60d21: it expects the Start menu and refuses Kosmos.exe.
- [WARNING, pre-existing] worldSwitchRestart's remedy is not true when the logon job is missing or Kosmos was started by hand; the old wording had the same gap. Written on #6985 for Homer, not changed here.
- [NIT, pre-existing] "Kosmos folder" names two folders on Windows; a failed Start menu shortcut is only logged. Not this card.
- [STRENGTH] Each new sentence checked true against KosmosLauncher.cs (the shortcut follows the copy Kosmos runs from) and win32handoff.js; the tests refuse the old words both ways.

### Iteration 2 (sonnet)
- [QUESTION] Does "Open my Kosmos folder" reveal the installed root, so step 5's Start menu opens the swapped build? Traced: machine.revealApp opens windowsKosmosFolder (the running root), which the Start menu entry runs. Consistent.
- [NIT] A comment at web/index.html:24969 quoted the old panel wording. Fixed in 7229384.
- [STRENGTH] No other test, caller or surface pins the old sentences; no em dashes.

## Final ledger

1 BLOCKER (fixed), 1 WARNING and 2 NITs pre-existing (recorded on the card), 1 NIT fixed. Converged at iteration 2.
