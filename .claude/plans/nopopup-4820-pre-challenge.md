---
pre_challenge: true
method: challenge-loop
branch: nopopup-4820
diff_hash: 0d8b9eba41fdd9ef2b7cde37d4573f6f14635997af18c029a4000463e2ea70fb
validation: pending (full validation queued on Mortals)
subdir_audit: passed
timestamp: 2026-10-01T02:19:13Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 blind rounds, each with a fresh reviewer, 2026-09-30 (each recorded in the plan).
**Converged:** Yes (round 3: 0 BLOCKER, 0 WARNING, 2 NIT taken, 3 decided not built)

### Iteration 1: 0 BLOCKER, 1 WARNING, 3 NIT
- [WARNING] an unreadable community setting (200 with ok:false) left the first-run Community switch drawn ON while the engine shares nothing --> FIXED (it paints the answer's on:false, as the diagnostics switch does; the test reds with the ok check restored)
- [NIT] write() drops unknown keys, which only matters on a downgrade --> RECORDED (the old notice shows once)
- [NIT] the no-dialog check matches the notice's wording, so a future pop-up with other words would pass --> RECORDED in the plan
- [NIT] existing users who saw the old "held until you release" notice now publish straight away untold --> RECORDED (the #4781 behaviour; Josh's "no big message")
### Iteration 2: 0 BLOCKER, 1 WARNING, 4 NIT
- [WARNING] Settings read the Community and Daily report switches once at page load, so a switch turned Off on Screen 6 still read ON in Settings > Automation in the same session --> FIXED (settingsGo re-reads both when Automation opens, except while that switch's own save is in flight)
- [NIT] frRefreshCommunity's header comment still said ok:false leaves the default --> FIXED
- [NIT] the Call item and the first Weakest-premise paragraph contradicted round 1 --> FIXED (amended, marked superseded)
- [NIT] a person who presses Escape before Screen 6 never sees the first-run switch --> RECORDED (sharing stays ON, the Settings switch is still there; diagnostics behaves the same)
- [NIT] on a forced re-run a could-not-read leaves the switch drawn ON over a saved Off --> RECORDED (harmless direction: nothing is sent because of the drawing)
### Iteration 3: 0 BLOCKER, 0 WARNING (CONVERGED)
- [NIT] the FIRST-RUN OFF arm counted PUTs right after the optimistic flip, with the PUT possibly in flight --> FIXED (waits for the PUT's response first)
- [NIT] only the Community half of round 2's fix was pinned --> FIXED (FIRST-RUN OFF (Daily report) arm: #fr-s6-feedback Off, one PUT {"on":false} to /api/feedback-setting, #feedback-toggle reads "false" in Automation)
- [NIT] Settings ignores a first-run save still in flight when Automation opens --> DECIDED NOT BUILT (needs a human faster than a local PUT)
- [NIT] the tab view does not re-read when Settings is reopened by tab click on Automation --> DECIDED NOT BUILT (pre-existing for the mine and held lists too)
- [NIT] the knob briefly shows the old position while the re-read is in flight --> DECIDED NOT BUILT (settles within one local request)

### Tests
- render-community-switch-4288 via tools/browser-checks.sh (allowlisted, frozen at the committed test tree): rc=0, 40 PASS, 0 FAIL.
- The new Daily report arm, in a git-archive copy with refreshFeedback() removed from settingsGo: rc=1, 1 FAIL (exactly that arm: #feedback-toggle read "true"), every other assertion PASS.
- render-firstrun-s6-2037.js (hermetic, run directly): rc=0, OK.
- kosmos_browser_check_gate rc=0; kosmos_browser_check_surface_gate rc=0.
- Full validation: pending, queued on Mortals.
