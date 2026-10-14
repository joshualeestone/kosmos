# kosmos#6158: a restart nobody asked for never takes focus

## Measured (origin/main)
Every focus-taking call in Kosmos was swept (`/usr/bin/open` callers, NSApp.activate, makeKeyAndOrderFront,
orderFrontRegardless, AppleScript activate). All run on a person's press except one: the app's silent restart onto a
new version. With another app in front it waits only for the Mac to have no input for relaunchQuietSeconds (30 s), which
an agent scripting the iOS Simulator never breaks; it opens the fresh copy with a default (activating)
NSWorkspace.OpenConfiguration, and the fresh copy calls NSApp.activate(ignoringOtherApps: true) at launch. So it takes
focus once per new version, mid-verification.

## Change (native-app/main.swift)
- `relaunchMayActivate(asked:wasActive:)`: only when the person pressed Restart, or Kosmos was already in front.
- `relaunch()`: `conf.activates` follows it; a quiet restart hands the fresh copy `KOSMOS_RELAUNCH_QUIET=1` (removed
  from the copied environment first, so only this restart decides it); the log says which way it opened.
- Launch: `consumeQuietRelaunch()` reads and unsets the flag once; a quiet launch logs and does not activate.

## Decided
- Rejected: never restarting while another app is in front (an update could wait for ever behind an open simulator or
  editor), and a longer idle threshold (moves the moment, does not stop it).
- The window still opens (behind the front app); clicking Kosmos brings it forward as usual.

## Weakest premise
That this is the only cause on the reporting install. Its app log decides: a "relaunch: ... no question asked" line at
each moment focus was taken. Focus taken with no such line means a second cause, and #6158 stays open for it.

## Evidence
- Swift selftest `--kosmos-app-stale-selftest`, six "quiet:" rows (the rule's three cases; the flag read once, unset
  after, only "1" counts): 68 checks pass; making the rule always true reds it.
- native-app.quiet-relaunch-6158.test.js (source shape, as stale-silences does for AppKit paths): activates follows the
  rule and is set before openApplication; the flag is removed then set; the launch reads it once and activates only
  when not quiet. Removing the launch guard or forcing activates true reds it.
- native-app.instance-guard-2124.test.js: its merge assertion now pins the rule (the handed-over environment starts
  from the current one, directly or via one local copy), and still reds on a fresh dictionary.
