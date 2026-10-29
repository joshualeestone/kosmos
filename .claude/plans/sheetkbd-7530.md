# sheetkbd-7530: the message sheet opens above the keyboard, and the chat's working dots stagger (TestFlight build 16)

## Finished looks like

- #7530 (Josh 10-28 19:23, build 15): with the keyboard up, a long press on a message opens the reaction sheet in view, the keyboard going down first. Keyboard down, as before. Simulator, measured: the control (KOSMOS_SAMPLE_KEEPKBD=1) reproduces his shot (dim and lit bubble, sheet behind the keyboard); the fix shows the sheet.
- #7427 (Josh 10-28, build 15: the DM's "is working" dots bounced in unison; the Agents pill staggers): the chat's three dots are drawn by Core Animation, each a fixed phase 0.16 s behind the one before, sitting on the line's baseline. Shots light and dark in ~/work/design-shots/kosmos-7530-7427.

## Decided

- #7530: the host that opens the sheet (chat and project rooms share it) resigns the first responder before it sets the sheet's target. Reply still puts the cursor back in the box. Rejected: waiting for the keyboard to finish going down before presenting (slower, and the simulator shows the sheet lands correctly without it).
- #7530: the resign is the app's first responder, so a long press (or VoiceOver's Message actions) with the search field focused drops that keyboard too, and closing the sheet any way but Reply leaves the keyboard down. Both deliberate: a sheet over a keyboard is the bug, and only Reply means "keep typing".
- #7427: not the Agents pill's clock-drawn WorkingDots, which was moved out of the chat because redrawing 30 times a second kept the thread from following new messages with the keyboard up (#7427 review 2). Layer animations move only the layers, never ask SwiftUI to lay out, and cannot be restarted together by a re-render. The board's numbers are kept (1.1 s ease-in-out, 4 pt rise, .45 to 1; Reduce Motion 1.6 s, .35 to 1, no rise). WaveDots stays for the KOSMOS_SAMPLE_SWIFTDOTS control.
- A UIKit view gives SwiftUI no baseline, so the dots take an explicit firstTextBaseline guide (measured: without it they hung about 5 pt below the words).

- Review 1 (opus): implicit layer animations disabled around the colour and opacity writes; the dots' two restart paths (reaching a window, returning to the foreground) are now checked; the old WaveDots checks are named as the control. Not done: resolving the colour for Increase Contrast (Palette.pair has no contrast variant, so there is nothing to miss).

## Weakest premise

- #7427: the simulator never showed build 15's dots in unison, so the cause on the phone is unproven; layer-drawn dots remove every SwiftUI path to a shared restart, which is why this is the fix, but only Josh's phone can confirm it.
- The layers' animations are re-added on the app returning to the foreground and on the view reaching a window; a path that strips them without either would leave still dots.

## Not verified

- Not run on a device.
