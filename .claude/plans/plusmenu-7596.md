# plusmenu-7596: the + menu restyled, with Camera (kosmos#7596)

Josh, 2026-10-29 21:27 CDT, with a screenshot of ChatGPT's iOS + menu: "We should fasten up our attachment buttons and
add these other options that ChatGPT does". 21:28: "Plugins and think harder don't really make sense". So the menu is
Camera, Photos, Files.

## Finished looks like
- Tapping + in a chat or a project room opens a larger panel, each row a round tile (44 pt, growing with the text
  size) with its symbol and the choice's name: Camera, Photos, Files. On iOS 16.4 and later it is a popover kept as a
  popover on a phone, the system material behind it; before 16.4, a half-height sheet.
- Camera opens the phone's camera for one photo; the photo goes up as a picked photo does, JPEG, named
  "Photo <date> at <time>.jpg" (Board.photoName).
- Photos and Files open what they opened before (the photo picker, the file picker).
- At the ten-file limit every row is dimmed and disabled, as the old menu items were; the + keeps its label and hint.
- A device with no camera shows Camera dimmed, "Not available on this device" under it. Where Kosmos is not allowed
  the camera, Camera says "Turned off for Kosmos in Settings" and opens Settings. Not yet asked: iOS asks first, and
  the camera opens only on yes. Restricted by Screen Time or a device profile (Kosmos's Settings page cannot undo
  it): dimmed, "Not allowed on this device".
- At the largest text sizes the rows scroll inside the panel.
- The camera's photo is encoded off the main thread, inside the upload's load, as a picked photo is read.
- A choice opens once the panel has gone (its onDisappear), never on a timer. A UI test (AttachMenuUITests, opt-in with
  TEST_RUNNER_KOSMOS_UI_PLUS=1) shows Photos and Files opening after the panel closes, with a control (the panel closed
  with no choice leaves the + tappable). Measured 10-29 23:00 on an iPhone 17 Pro Max simulator, iOS 27: all three pass.
  Not measured: the camera (no simulator camera) and the pre-16.4 sheet (no iOS 16 runtime here); both owed on a device.
- One shared view (AttachMenu.swift) for the chat and the room, so the two cannot drift.
- The choices and their rules (Board.cameraState, attachRowOff, cameraNote) are in BoardLogic and tested in LogicTests
  with controls; room source checks hold both screens to the one panel and the camera wiring.

## Decided
- A popover panel, not a bottom sheet: it is what Josh pointed at (a panel over the keyboard) and keeps the chat in
  view. Rejected: a SwiftUI Menu, which cannot draw tiles. Weakest premise: before iOS 16.4 the popover becomes a short
  sheet (.medium, room for the rows at any text size); the app targets iOS 16, so that path exists but is rare.
- Camera dimmed rather than hidden on a phone without one, so the menu is the same everywhere and says why.
- "Photo Library" is now "Photos", the word in Josh's screenshot and Apple's own app name.

## Not in scope
- Video from the camera (photos only; the usage text already allows video for a later card).
- Plugins and Think harder (Josh, 21:28).
