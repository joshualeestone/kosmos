# #4382 Windows half: a connect computer updates and rolls back with no board

**Posture:** production

## Finished looks like
- A Windows computer whose mode file reads `connect`, with its board stopped and its logon task off, looks for an update at Kosmos.exe launch and at least daily while the window is open.
- Newer and updates on (no `autoupdate.json`, or `on: true`): it installs through the existing Windows updater (win32update.begin + the win32apply helper) and the board stays stopped. Updates off: it is offered (bar + system menu), never installed until the person picks it.
- After an update, rollback to the kept build is reachable from the window's system menu with no board, through the existing rollbackToPrevious path, and the board stays stopped. Never-downgrade for forward installs is unchanged.
- Tests for each: offered with no board, installs, board stays stopped, daily re-check, rollback reachable. Each fails without the fix.

## Design
- engine/win32connectupdate.js: `--look|--install|--rollback --yes`, run by Kosmos.exe with the bundle's node through RunEngineHelper. Reuses update-ifnewer.decide (look + consent), win32update.begin / rollbackToPrevious (install, rollback), waitForOutcome (result). Refuses unless the mode reads exactly `connect`, no board answers, no agent asked.
- win32update B0: `connectComputer` precondition in place of the board-task rule; applyCli (newer download, setup.ps1) uses it on a connect computer.
- KosmosLauncher.cs: StartUpdateLooks after the connect stop; daily WinForms timer (1 h retry after an unreachable look); bar over the page (never in it); system-menu Update / Restart / Roll back; relaunch after a picked update or rollback, outside the window and after its lock. Counted in stopsInFlight so Run agents cannot start a board mid-swap.
- FirstRunChoice stays off; turning it on is a separate decision.

## Weakest part
With no board, a new build that will not boot is not caught by H7 (nothing is started to confirm). It surfaces when the person opens Kosmos (the relaunch) or picks Run agents; the Roll back menu item is the way back only if the new Kosmos.exe itself still opens.
