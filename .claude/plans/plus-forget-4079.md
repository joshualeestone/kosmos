# #4079: Kosmos Plus, Disconnect this computer

## Finished looks like
Under Settings, Kosmos Plus, a connected computer has a separate "Disconnect this computer" control, distinct
from the pause. It confirms in plain words, calls /api/remote/forget, and shows the result honestly (including
the account not being told); after it succeeds the pane is back in the not-connected sign-in state. A browser
check covers the paths. Shared page code, so Windows gets it too.

## Change
- web/index.html: #plus-forget section under "I lost my phone" (shown when enrolled); a two-step confirm in place
  that the 5-second repaint does not close; POST /api/remote/forget; the result line #plus-forgot-msg at the top of
  the not-connected pane (cleared when a sign-in starts); on failure, the pane stays connected and says so.
- "Turn off" is now "Pause" (the on-state quiet control), so it cannot be mistaken for Disconnect.
- docs/browser-checks/render-plus-panel-3829.js: Pause pinned; three disconnect outcomes (told, untold, fails),
  the confirm surviving a repaint, Cancel sending nothing.

## Decided
- The untold case shows the engine's own sentence (it already says the address may still show on the account),
  never the "done" sentence. Rejected: a generic success, which would hide that the account was not updated.
- Weakest premise: the engine route was not exercised for real here (a real forget would disconnect this Mac from
  a live account); the check stubs /api/remote/forget with the engine's documented response shapes.
