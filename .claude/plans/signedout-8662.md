# signedout-8662: an agent page signed out mid-session says so, and its model picker is not offered (kosmos#8662, ask 1)

## Report (feedback 11-17)
Many agents read "unknown model" and the model picker did nothing; the tab had been signed out by an update.

## Measured (sandboxed board, every /api read answered 403 with the board's own body, old and new look)
- A tab that LOADS signed out says "This board is not signed in" on every view (#2023/#6358): no "unknown model".
- A tab already on an agent's page when it is signed out (a restart or an update does that) said nothing: it kept its
  last reading, "Can't tell", and the Model section's Switch & Restart and Move, which the board then refuses. That is
  the report's path. Screenshots in the session's scratch (before/after).

## Change
- web/index.html: `#d-signedout`, one note above the agent page's sections (its words live once, in paintDetailSignedOut:
  the page shows what it last read, nothing on it can be saved until a sign-in, its model controls are paused, and
  "See how to sign in" links the board, where the sign-in steps are; a relay sign-out gets the board's own sentence
  and Sign in button). `paintDetailSignedOut()` shows it and makes `#d-sec-model` inert while
  `BOARD_NEEDS_SIGNIN` (403, this computer's page) or `BOARD_SIGNED_OUT` (#718 relay) holds. Driven by the STATUS poll
  only (its refusal path, both success paths and the outage path, #268): loadProjects also writes the flags, and a
  projects read failing another way while status says 403 would flip the lock and keyboard focus on alternate polls.
  Shown first, then written (a live region written while hidden is not reliably announced), and written again on every
  new sign-out. Focus inside the section moves to the note when it locks and back to the section when it unlocks. The
  reading is not dimmed (the note tells the person to rely on it). Wording is platform-neutral ("This page"), and the
  link says what it does ("See how to sign in" on the board).
- `modelLine`: with no model read and the board signed out, "Signed out: sign in to see its model", not "Unknown
  Model" (typeof-guarded, so a lifted modelLine without the flags keeps the old lines).
- docs/browser-checks/render-detail-signedout-8662.js: both looks; control before the sign-out; note + inert after;
  both cleared on sign-in; the relay sign-out's own wording and button; an outage after a sign-out clears the note
  (#268); keyboard focus moves to the note when the section locks and back when it unlocks. Red against main's page on the sign-out
  and relay arms (measured on the first version: 4 of 11 then; the check now has 23), and on the outage arms with that repaint removed (measured).
- web.made-before.test.js: modelLine signed out, with signed-in controls.

## Split
Asks 2-4 filed as #8665 (model in `kosmos agent list`), #8666 (view/set a model from the CLI), #8667 ("no model recorded",
linking AI Settings).

## Cards
A mid-session sign-out replaces the grid and the list with the board's own "not signed in" box (#2023), and a tab that
loads signed out draws no cards, so a card does not keep its old text there. The modelLine wording is the fallback for
any surface drawn from what the page last read; it is pinned by the unit test, not by a browser arm.

## Deferred from review
- Shared constants for "Made before Kosmos recorded this" and the signed-out line: tests lift modelLine, tileModelLine
  and lmodelCell alone, so a page-level constant breaks them (measured: 4 failures); the words stay literal, pinned by
  web.made-before.test.js against modelLine's own output.

## Residual
- loadProjects also writes the sign-in flags (it does not repaint the agent page, on purpose). When status says 403 and
  a projects read fails another way, modelLine's wording can read "Unknown Model" until the next status poll while the
  note stays up. Cosmetic, and it self-heals on the next poll.

## Not done
Only the Model section is made inert. Other sections' writes (Instructions, Remove, Memory's Compact/Clear) are also
refused by the board while signed out; the note says nothing on the page can be saved until a sign-in, which is true
of all of them, and that its model controls are paused, which is the part this page enforces. Making every section inert is a wider change than the card's ask.
