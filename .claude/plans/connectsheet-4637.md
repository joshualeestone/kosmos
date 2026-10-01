# connectsheet-4637: the "wants to connect" sheet, on-brand and in human words (kosmos#4637, part B)

Josh, 2026-09-29 15:12, on the old "PizzaRama (Kosmos app) is asking to use this Kosmos. [Review]" strip and its card:
"looks like some engineer/developer thing and doesn't fit the branding". Built on Josh's go (2026-09-30 17:34) from
Mona Lisa's flow outline on #4754 (steps 6 and 9), and reviewed by her (approved with W1, W2 and two spacing NITs,
all in).

## What changes
- web/index.html, the Allow moment (#567): each waiting request is a Kosmos+ sheet (navy, Kosmos+ blue): the brand,
  the device's icon beside who wants in and when, one line, the code once as one large line (read out a character at
  a time), then Allow and a quiet Not me.
  - Another of the person's computers joining (#4773's `joining_computer`): "Your computer "windowsbox" wants to
    join", "Allow it if you just signed it in, and it shows this code."
  - A phone or browser: "<name> wants to connect to your Kosmos", "Allow only if this code is showing on the device
    in your hand."
  - After Allow: "windowsbox is connected." with where to remove it later.
  - Under "Waiting for you" (shown only while something waits), waiting sheets come first and answered lines after.
    A request whose Allow or Not me failed still waits.
- The notice on every other page is a navy Kosmos+ strip in the same words, lined up with the banner under it.
- engine/remote.js: `pendingDevices` passes `joining_computer` through (a computer name by NAME_RULE, else null).

## Decided (overridable)
- Not me is back, in place of Deny (#3829 had removed it; the outline brings it back). One way to say no, not two.
- The code is one large line, not letter boxes (the card's ask). What #3952 protected is kept: read out a character
  at a time, directly above Allow so matching and allowing stay one glance, inside its card, readable on the navy.
- The line comes before the code (Josh's #3952 rule, code directly above Allow) rather than after it as the outline
  draws it.
- The heading "Asking to use this Kosmos" is now "Waiting for you".

## Weakest premise
That the phone's own screen will match: it still draws its code in boxes, so the two sides now differ in style
though the characters match. And the computer variant is dormant until #4773's producer sends `joining_computer`.

## Checks
- docs/browser-checks/render-connect-sheet-4637.js (gated): words, the phone control, the code and buttons, the
  order after Allow, a failed Allow still waiting, the heading only while something waits, the notice lined up
  with the banner, one-request notice wording; 1400 and 390.
- web.allow-card.test.js (pins updated on purpose), engine/remote.test.js (joining_computer), and the existing
  render-plus-panel-3829, render-waiting-phone-718 and render-plus-asks-signin-4610 checks.
- Design shots: ~/work/design-shots/kosmos-4637/ (connect-sheet, connect-connected, connect-notice).
