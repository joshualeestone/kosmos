# signedout-8662: an agent page signed out mid-session says so, and its model picker is not offered (kosmos#8662, ask 1)

## Report (feedback 11-17)
Many agents read "unknown model" and the model picker did nothing; the tab had been signed out by an update.

## Measured (sandboxed board, every /api read answered 403 with the board's own body, old and new look)
- A tab that LOADS signed out says "This board is not signed in" on every view (#2023/#6358): no "unknown model".
- A tab already on an agent's page when it is signed out (a restart or an update does that) said nothing: it kept its
  last reading, "Can't tell", and the Model section's Switch & Restart and Move, which the board then refuses. That is
  the report's path. Screenshots in the session's scratch (before/after).

## Change
- web/index.html: `#d-signedout`, one note above the agent page's sections ("This tab is signed out, so this page shows
  what it last read and cannot change anything, the model included. Sign this tab in again to see and change models",
  linking the board, where the sign-in steps are). `paintDetailSignedOut()` shows it and makes `#d-sec-model` inert while
  `BOARD_NEEDS_SIGNIN` (403, this computer's tab) or `BOARD_SIGNED_OUT` (#718 relay) holds; run from the status poll's
  refusal path and its success path, so a sign-in clears both on the next poll.
- `modelLine`: with no model read and the board signed out, "Signed out: sign in to see its model", not "Unknown
  Model" (typeof-guarded, so a lifted modelLine without the flags keeps the old lines).
- docs/browser-checks/render-detail-signedout-8662.js: both looks; control before the sign-out; note + inert after;
  both cleared on sign-in. Red against main's page (4 of 11 fail, measured).
- web.made-before.test.js: modelLine signed out, with signed-in controls.

## Split
Asks 2-4 filed as #8665 (model in `kosmos agent list`), #8666 (view/set a model from the CLI), #8667 ("no model recorded",
linking AI Settings).

## Not done
Only the Model section is made inert. Other sections' writes (Instructions, Remove, Memory's Compact/Clear) are also
refused while signed out; the note says the page "cannot change anything", and the board refuses them with its own
sentence. Making every section inert is a wider change than the card's ask.
