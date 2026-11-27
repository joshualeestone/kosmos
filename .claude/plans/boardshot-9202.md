# kosmos#9202: a UI test that renders the web board's Close bar and ground, and fails on navy

## Why
#9101 moved the native colour behind the iPhone app's web board from navy (#17233D) to UIColor.boardGround (#faf9f7
light, #0c0d0f dark). Nothing rendered it: build 75's behaviour pass had no test that shows the board, so Splinter asked
for hand-run simulator shots (#9101, 11-27). This is the durable guard.

## Change
- ios/KosmosUITests/BoardGroundUITests.swift: on the sample board (KOSMOS_SAMPLE_AGENTS, no computer address), Agents'
  + asks, then opens the board page over the tabs with its Close bar. Screenshot; read the pixels of the Close bar row's
  empty right side and the strip just above it (both native); every point must be one exact ground (within 3), never
  navy. A control runs the same judge on solid navy, light, dark and another colour.
- ios/tools/ui-sample.sh: BoardGroundUITests:2 in the sample-board CI list (lazy arm).

## Decided, and the weakest premise
- Pixels from the screenshot, not an accessibility or source read: only pixels see what a person sees.
- Accept either ground: the iOS 27 simulator ignores XCUIDevice.appearance, and the app follows the board's own
  Light/Dark, so the test names which ground it saw. CI runs it in light; dark is a by-hand run.
- Weakest premise: that XCUIScreenshot returns the ground's exact value (within 3). The build-75 simulator shots taken
  with simctl read exactly #faf9f7 and #0c0d0f at these places; XCUITest's screenshot is measured when this runs.
- Covers the Close bar row and the strip above it, not all five #9101 places (the others sit under the web view).

## Review round 1 (opus, blind, read-only): no critical
- [WARNING] UIImage.scale may not be the device scale --> FIXED: pixels per point from the image's own width, asserted 2 or 3.
- [WARNING] the top sample point near the notch or island --> FIXED: right side, just above the Close row.
- [WARNING] a fixed 1 s settle could catch the question's fade --> FIXED: wait for the question to be gone, then 0.5 s.
- [NIT] control format pinned to standard sRGB; raw colours attached on a pass; the five-places claim and the dark run's
  dependence on the board's own appearance stated in the header --> FIXED.
