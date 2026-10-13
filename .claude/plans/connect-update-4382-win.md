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

## Decisions after review
- **The engine reads the mode file even while `FirstRunChoice` is off (kept, not gated).** The switch is a compile-time constant in Kosmos.exe that the engine cannot see. With it off nothing writes `%LOCALAPPDATA%\Kosmos\mode`, so the file is absent, `readsConnect` is false, and every path behaves exactly as before. The helper already obeys the same file regardless of the switch (#4381: H7/H8 start no board on `connect`); gating only the update side would let the two disagree on one computer. And a hand-written `connect` file is how a test box exercises this before the switch goes on.
- **Rollback on a connect computer only to a connect-ready build:** one that carries `app\engine\win32connectupdate.js`. The launcher is committed beside the engine, so such a build's Kosmos.exe is launcher 8.1 or later and honours the choice; an older one would start a board and could never update again, so it is neither offered nor restored, with a sentence saying why.
- **No `/End` on a connect computer with nothing to stop** (pid unknown, no answer, port free): `win32board.end` reads "not running" only in English.
- **Waiting with no board:** the journal's own record (finished as updated, or confirmed) counts, so a status file that could not be written does not turn a good update into a failure.
- **The window's decisions are pure** (`AfterConnectUpdate`, `AfterNotNow`, `UpdateLookIsDue`, `UpdatePickedAction`, `UpdateUnderWayOnDisk`) and tested through a probe compiled beside the launcher. No look while an installed update waits for Restart (a second update's cleanup would delete the folder the window runs from). "Run agents" also waits while the updater's own files show an update on its way (a window closed mid-install releases the one-window lock).

## Weakest part
With no board, a new build that will not boot is not caught by H7 (nothing is started to confirm). It surfaces when the person opens Kosmos (the relaunch) or picks Run agents; the Roll back menu item is the way back only if the new Kosmos.exe itself still opens.
