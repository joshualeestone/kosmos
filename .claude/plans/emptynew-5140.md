# emptynew-5140: on a new user's empty board on a phone, a floating notice no longer clips New agent

Card: kosmos#5140 (day-one, Splinter 2026-10-03 06:57). Rides 0.7.22.

## What finished looks like
On an empty board (no agents) at phone width, with a floating notice showing (the update notice, the one an empty
board can really get), New agent is fully clear of the notice and takes the click. With agents, at desktop width, or
with no notice, nothing moves.

## Measured before the fix (main bfe941d2f, headless, the update check's own empty board, welcome completed)
New agent [24,113,94,58], update notice [65,86,245,32]: they overlap (the notice's bottom 118 is below New agent's top
113). New agent still took the click at its centre. A taller notice (the offline notice, two lines) covers more.
The existing "toast overlaps newagent" test at 375 compared against null: it runs with the welcome dismissed by Escape,
where New agent is not shown, so it could not fail.

## Change
- web/index.html: at max-width 720px, on an empty board (`#grid > .pj-empty`) with the Allow card and the
  Claude-unreachable line hidden, `#boardbar` takes margin-top `--topnotes-clear` (#5116's clearance: the stack's height
  + 16px, 0 with no notice).
- docs/browser-checks/render-update-toast.js: a new arm on the agents board at 375, welcome completed, update notice up:
  CONTROL that the board, New agent and the notice render; New agent not covered and takes the click.

## Decisions
- Only the empty board, only phones. Josh's #5018 ruling: notices float and never push the page. An empty board has
  nothing below New agent for the move to push, so the ruling holds; on a populated board the row stays.
- Rejected: moving the stack (right-aligned on phones). The login notice is ~327px wide at 375, so it cannot avoid a
  left button; and it would change Josh's ruled placement.
- Weakest premise: that `#grid > .pj-empty` is the empty-board signal in every empty state. boardEmpty() also returns
  signed-out / offline / cannot-read blocks; whether each uses .pj-empty is not checked here (if one does not, that
  state keeps today's behaviour, not a worse one).

## Validation
- The new arm: RED on main (overlap true), GREEN with the fix (New agent at y 145, clear of the notice's bottom 118).
