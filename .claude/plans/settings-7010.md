# settings-7010: the iPhone Settings tab, native (kosmos#7010, slice 10 of #6838)

## Finished means
The Settings tab is a native screen: the computer's own phone switches (read and written through GET/PUT
/api/phone-notify with the computer sign-in the app keeps), the computer shown, the Kosmos+ account (its own
/account and /delete-account pages in the app's web view), Face ID only while the app asks for it, and a row to the
board's own Settings, which stays reachable under Today. Checked in the simulator, light and dark; logic tested.

## The change
- New: ios/Kosmos/SettingsView.swift, ios/Kosmos/SettingsLogic.swift, ios/LogicTests/run-settings.sh +
  settings/main.swift (its own suite), web.ios-settings-labels-7010.test.js (every PR).
- ios/Kosmos/ShellLogic.swift: AppTabs.isNative; barTab maps the board's Settings section to Today; follow does
  not move a native tab; the press tracker ends a waiting press for a native tab and replays none after a lock.
- ios/Kosmos/ContentView.swift: Settings native in tabPage; BoardWeb.press(section:) and pressBoardSection.
- ios/LogicTests/main.swift (agreed with Angel): one assertion updated, three generic checks moved to .tasks,
  ten #7010 checks. .github/workflows/ios.yml: runs the new suite.

## Decided, and why
- No Face ID line: the lock is off (requireBiometricUnlock false, a product decision).
- Sign out and delete open Kosmos+'s own pages: /v1/session/forget accepts only the sign-in page; deletion is
  Kosmos+'s own confirmed flow.
- No "use another computer": the web chooser never changed the computer this screen controls.
- System green switches: the ink tint read as off in dark.
- Weakest premise: PUT /api/phone-notify through the remote gate with only the gate cookie; review traced the gate
  and the board's cross-site check, but it needs the real-iPhone check (#6838's list).

## Order and rollback
Independent of #7008 (no shared files except LogicTests/main.swift, agreed). Rollback: revert.
