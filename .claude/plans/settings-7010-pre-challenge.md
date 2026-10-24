---
pre_challenge: true
method: challenge-loop
branch: settings-7010
diff_hash: 9ad53b2a99b9b21de099c977754545c4b0f745b99d028f8d7b825122621879f2
validation: passed (validation_log_run_or_skip on 440bab2a77, rebased on main: 23628 node tests, 0 failed, build passed, hash 9ad53b2a99b9; ios/LogicTests/run.sh 531/531 and run-settings.sh 41/41; xcodebuild simulator Debug build succeeded; simulator shots light and dark in ~/work/design-shots/kosmos-7010/; mutation controls: a label change, a label swap (both suites), the account-ownership check removed, the barTab mapping removed, the tracker's native rule removed, each fails)
subdir_audit: passed
timestamp: 2026-10-24T01:25:47Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (one blind reviewer at a time: opus, sonnet, opus).

### Iteration 1 (opus)
- [BLOCKER] The board's own Settings became unreachable on the phone: the bar followed ?tab=settings to the native tab, covering the section a chat's fix button sends the person to. Fixed: AppTabs.barTab maps the board's Settings to Today, follow does not move a native tab, and a row opens the board's Settings under Today.
- [WARNING] Pressing Settings poked the hidden page (a chat lost its place; a box on the board blocked the tab). Fixed: the bar never presses Settings.
- [WARNING] "Use another computer" did not change the computer this screen controls. Removed.
- [WARNING] Switches snapped back while saving, and a stale read could overwrite a write. Fixed: the chosen value shows while saving, and a generation guard.
- [WARNING] A new URLSession per call without the no-redirect rule. Fixed: one shared session that refuses redirects.
- [WARNING] Wording: a failed read said "did not save"; the computer's reason shown raw; per-kind switches shown when nothing is sent; signed out read as not connected; the busy-room hint was short. All fixed.
- [WARNING] The label checks could not catch a swap. Fixed: each label is checked against its own board row (a swap fails both suites).
- [NIT] Passcode wording; keptMac duplicated Board.usableSaved. Fixed.

### Iteration 2 (sonnet)
- [WARNING] Skipping the press for Settings left an earlier waiting press able to pull the bar off native Settings; a lock on Settings replayed a press. Fixed: AppTabs.isNative in the press tracker; three generic checks moved to .tasks (agreed with Angel), five checks added.
- [NIT] The delete footer's "code we email you": verified against the coordinator's delete page in round 1. Kept.

### Iteration 3 (opus)
- [WARNING] From the Kosmos+ account page the row had no board to press. Fixed: BoardWeb.pressBoardSection loads the board first and the press waits for it.
- [NIT] No check that a section press waits with no page or a loading one, and a force-unwrap in a check. Fixed (two checks, no unwrap).
- [STRENGTH] Replaying every waiting press as a section press is safe (only press and drop set pending, both guarded); every other bar path goes through barTab; the moved checks lost no coverage.

## Final ledger

1 BLOCKER, 10 WARNING, 4 NIT; all fixed except one NIT kept with reason. Converged at iteration 3.
