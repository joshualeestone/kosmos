# plusrow-4744: the Kosmos+ box says where other devices reach this computer, with Copy, on one line

Card: kosmos#4744. Josh, 2026-09-30 11:23 (Windows channel), for Mac and Windows: instead of "Sign in at
login.kosmosplus.com. [Open]", "Access this computer from other devices at <bold>login.kosmosplus.com</bold>" and
"[Copy] so you can copy the URL to send to other devices", "all fits on one line".

## Done looks like
On a connected computer the box reads his sentence verbatim with the address bold and a Copy button beside it, one
line at 1400 and at 640 wide (the desktop app's narrowest window, the Windows launcher's floor); Copy puts
https://login.kosmosplus.com/ on the clipboard and says Copied (button and screen reader) for 2 seconds; no Open.
Checked in a browser; served in a build.

## Decided (reversible, on the card)
- Copy copies the full https URL (he said "copy the URL"; it pastes as a link).
- "Copied" for 2s, the app's existing copy pattern; the live region says it too.
- Open is gone (his version has Copy only; View account stays in the bottom row).
- One line: measured, the Settings column caps the panel at 544px on a desktop window, where the sentence at .9rem
  needs ~452px of ~404 beside Copy. So the box reaches into the panel's side padding, Copy is compact, and the
  sentence's size follows the box's width (container units, .75rem to .9rem): 12.8px at 1024 and 1400, .9rem at 800,
  one line from 600 up with ~7% to spare; a phone wraps rather than cuts a word.
- Copy tries execCommand first (as the file's other copy buttons do), then the clipboard API, both with the full URL. If
  both refuse, the address is selected and the line under the box says so until the next press or until the box goes
  (the button keeps a fixed width, so the sentence never moves). No Mac-only keystroke is named.

## Weakest premise
The Windows fit is reasoned, not measured: the ~8% margin (/34) is for Segoe UI running wider than the Mac's font, but
every measurement here is Chromium on this Mac. A Windows run of render-plus-panel-3829 (or Josh's own screen) is the
real test. Also: 640 is the Windows launcher's outer minimum; the check measures 640 and 600 (inside the frame and a
classic scrollbar). No Mac minimum window is set in this repo.
