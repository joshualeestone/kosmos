# #4608: "Signing in..." and a ring loader while this computer connects to Kosmos+

## Finished looks like
- In Settings > Kosmos Plus, while "Connecting this computer as <address>..." runs, the card's heading reads
  "Signing in..." and the app's ring loader (the Sweep spinner, .spin-sweep, gold, with its own
  reduced-motion pulse) turns beside the words. On a failure or cancel the heading returns to "Sign in to
  activate Kosmos+" and the loader hides; on success the connected flow takes the pane.
- Same web UI on the Mac and Windows apps.

## What was found
No Kosmos K animates in the page during this step (searched: the card, startKLoader's callers, kGlyph, the
update and restart overlays). The K Josh describes is not drawn by this state's page code, so there was no
K to replace; the ring loader is added. Weakest premise: that the K he saw was not something this card should
remove (for example a native-app or a board-restart overlay during the connect). If it recurs, a screenshot of
the moment it shows would name it.

## How
- Markup: a hidden `.spin spin-sweep` (#plus-si-spin) at the start of #plus-si-owned.
- plusSiDoRegister: sets the heading to "Signing in..." and shows the loader (automatic register) before the
  POST; after it, hides the loader and restores the heading if it still says "Signing in...".

## Verification
- render-plus-signin-3478: the first register answer is held 1.5 s; during it the heading, the loader and no K
  in the card are asserted (FAILS on origin/main: the old heading, no loader); after the failure both go back.
- Unit: web.*.test.js + tools.plus-signin-2036.test.js 2182.
