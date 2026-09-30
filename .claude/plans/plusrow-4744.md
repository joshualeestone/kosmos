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
- One line is held down to 640 wide at .9rem; on a phone, narrower than any desktop window, it may wrap rather than
  cut a word.
- If the clipboard refuses, the address is selected on screen and the button says "Now copy it" (no Mac-only
  keystroke named, since the row serves Windows too).

## Weakest premise
That 640 is the narrowest window that matters: it is the Windows launcher's minimum; no Mac minimum is set in this repo.
