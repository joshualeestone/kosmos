# pickerfront-7209: a click on the Kosmos window can no longer bury the open file picker

Card: joshualeestone/kosmos#7209 (Josh, 2026-10-26 10:31, Mac app on 10102026: the + in a DM does not open the
file picker; nothing appears).

## Finished looks like
With a file picker open, clicking anywhere in the Kosmos window leaves the picker in front, so the person always
sees the picker they opened, and the build gate's file-picker selftest fails on a build where the window can
cover it.

## What was measured
- The page is fine: in Chromium, the DM composer's + (agent on and off) is enabled, uncovered, and a real
  mouse press opens the file chooser.
- In the Mac app's own selftest (real NSOpenPanel, real WKWebView): after `win.makeKeyAndOrderFront` (what a click
  on the window does), the window server's stacking order puts the window IN FRONT of the open picker on main.
- A second file-input click while the picker is open never reaches `runOpenPanelWith`: WebKit drops it while its
  own picker is unanswered (no "refused" log line). So a buried picker makes every later + look dead, in a DM or
  a room, until the person finds the picker.

## Change
- `panel.level = .floating` before `panel.begin` in `runOpenPanelWith` (native-app/main.swift).
- Selftest arm `press:window-clicked-over-the-picker picker-stays-in-front:yes`, read from
  CGWindowListCopyWindowInfo (NSApp.orderedWindows leaves panels out, measured). Red on main's level, green
  with the fix. Added to the gate's required lines (tools/build-kosmos-bundle.sh) and to
  tools.filepanel-gate.test.js (GOOD shape, the per-line drop test, and the two slice counts it shifts).
- The first commit's approach (bring the panel forward on a refused press) is replaced: it could never run.

## Rejected
- hidesOnDeactivate = true (so a floating picker does not cover other apps): the selftest process can never
  become the active app (measured, NSApp.activate leaves isActive false), so the picker is hidden there and
  the gate could not see it on any cut.
- A sheet on the window: #2807, sheets were silently dropped.
- Re-ordering the panel on windowDidBecomeKey: needs an active app to observe too, and floating does the same
  job with one line.

## Accepted cost
A picker left open while the person switches to another app floats over that app until they answer it.

## Weakest premise
That Josh's picker was buried behind the window. His app log would show the open panel with no answer at
10:31; it is on his test Mac, which we cannot reach. If the picker never appeared at all, this is not the cause.

## Checks
- Selftest built with swiftc on Agent1s: main-level control red on the new arm, fix green on every arm.
- tools.filepanel-gate.test.js 21/21; every test reading main.swift or build-kosmos-bundle.sh: 878 pass, 0 fail.
