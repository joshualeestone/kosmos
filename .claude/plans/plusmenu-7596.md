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
  the camera opens only on yes; on Don't Allow the line above the composer says the camera is off and where to turn it
  on. Restricted by Screen Time or a device profile (Kosmos's Settings page cannot undo it): dimmed, "Not allowed on
  this device".
- At the largest text sizes the rows scroll inside the panel, which is held to 360 pt. Seen 10-29 23:24 at
  Accessibility XXXL on the iOS 27 simulator: Camera and Photos showing, Files below them inside the scroll view (the
  layout, not a scroll gesture, was checked).
- The camera's photo is encoded off the main thread, inside the upload's load, as a picked photo is read.
- A choice opens once the panel has gone (its onDisappear), never on a timer. A UI test (AttachMenuUITests, opt-in with
  TEST_RUNNER_KOSMOS_UI_PLUS=1) shows Photos and Files opening after the panel closes, with a control (the panel closed
  with no choice leaves the + tappable). Measured 10-29 23:00 on an iPhone 17 Pro Max simulator, iOS 27: all three pass.
  Not measured: the camera (no simulator camera) and the pre-16.4 sheet (no iOS 16 runtime here); both owed on a device.
- One shared view (AttachMenu.swift) for the chat and the room, so the two cannot drift.
- The choices and their rules (Board.cameraState, attachRowOff, cameraNote) are in BoardLogic and tested in LogicTests
  with controls; room source checks hold both screens to the one panel and the camera wiring.
- The photo carries the account or computer Camera was chosen under (before any permission prompt); a photo across a
  switch is dropped without touching the new account's line.

## Decided
- A popover panel, not a bottom sheet: it is what Josh pointed at (a panel over the keyboard) and keeps the chat in
  view. Rejected: a SwiftUI Menu, which cannot draw tiles. Weakest premise: before iOS 16.4 the popover becomes a short
  sheet (.medium, room for the rows at any text size); the app targets iOS 16, so that path exists but is rare.
- Camera dimmed rather than hidden on a phone without one, so the menu is the same everywhere and says why.
- "Photo Library" is now "Photos", the word in Josh's screenshot and Apple's own app name.

## Not in scope
- Video from the camera (photos only; the usage text already allows video for a later card).
- Plugins and Think harder (Josh, 21:28).

## Review ledger
Rounds 1 to 15 ran in the session before the fleet restart of 10-30 00:21; each round's fixes are in its own commit
("challenge-loop iteration N findings"). Rounds 6, 10, 12 and 14 have no commit: whatever they found was not carried
across the restart, so they are recorded as unknown, not as clean.
- Round 16 (fresh session, declared the last full round before it ran): no BLOCKER, no WARNING. Three NITs. NIT 1 (rows
  of unequal width leave a strip that closes the panel) was taken and FIXED with fixedSize; NIT 2 (an Allow after the
  screen closed sets state on a screen that is gone; the epoch guard still holds) and NIT 3 (camera state read once
  per panel) accepted as recorded.
- Round 17 (a review of the NIT 1 fix alone): BLOCKER, fixedSize stops wrapping and pushes the rows off the screen at
  the largest text. Measured both arms: the screenshot at Accessibility XXXL showed it, and a control run showed the
  rows were ALREADY equal on the old layout (the popover gives them its width), so NIT 1 was a false finding. The
  fix was taken back; AttachMenu.swift is byte-identical to round 15's. The width tests stay, with a check that every
  row fits across the screen, which fails on the fixedSize layout (control) and passes on the shipped one.
- Converged at round 17: the only code change after round 16 was reverted, and the tests added are checked both ways.

## Validation (head after round 17)
- LogicTests/run.sh: PASS 1706/1706. The 11 repo test files that read ios/: 82/82.
- AttachMenuUITests on a fresh iPhone 17 Pro simulator, iOS 27: Photos, Files, Photos from a room, the no-choice
  control, and the two width checks.
- Still owed on a device: the camera itself and the pre-16.4 sheet.
