# #2683 - org-chart hover mis-targets a neighbour; remove the chevron; click-avatar-to-open

## The card
Josh, design channel 2026-09-10:
- The org-chart hover is mis-targeting: hovering directly over one avatar (Darius Cole) activates
  a neighbour's label (Elena Torres). Show the hover label only when the mouse is over that
  avatar's own circle, not a neighbour's.
- The label shows name + title, but REMOVE the chevron-right.
- Clicking the avatar directly opens that agent (no need to mouse up to a chevron).

## Root cause of the mis-targeting
Each `.onode` is a `<button>` containing `.face` (the avatar circle) and a `.callout` (name + role
+ a `.co-go` chevron). The callout is positioned `bottom:50px` -- ABOVE its node -- and is
`opacity:0` until `.onode:hover`, with `pointer-events:auto` (given so the button-looking callout
could be clicked, Mona Lisa #284).

An `opacity:0` element with `pointer-events:auto` STILL captures the pointer. So a node's invisible
callout, sitting above its node, overlaps a neighbouring avatar that is positioned above it; moving
the mouse over that neighbour's avatar hits the lower node's invisible callout, whose `:hover`
propagates to the lower `.onode`, and the lower node's label lights. That is exactly "hover directly
over one avatar -> a neighbour's label", the reported bug.

## Change
1. `.onode .callout { pointer-events: none; }` (was `auto`). The callout is now a plain hover
   LABEL; an invisible callout can no longer capture hover/clicks over a neighbour's avatar. The
   avatar (the `.onode` button) is the hover-and-click target.
2. Remove the chevron: drop `<span class="co-go" ...>&rsaquo;</span>` from the node render, remove
   the `.co-go` CSS rule, and make the callout padding symmetric (`6px 12px`, dropping the
   chevron's asymmetric padding + gap).
3. Click-avatar-to-open: ALREADY works -- the `orgmap` click handler does
   `closest('.onode')` -> `openDetail(dataset.agent)`, so a click anywhere on the node (the face
   included) opens the agent. With the callout now `pointer-events:none` and the chevron gone, the
   callout no longer invites a click it should not take; the avatar is the sole target. No handler
   change needed.

## Why not clip the hit-area to a circle
Josh says "only when over that avatar's own circle". The button is a 44x44 square; a `clip-path:
circle(50%)` on `.onode` would make hover strictly circular, but it also clips the callout (a child
positioned above the node) out of view, and the `.onode` is the focusable keyboard target with a
careful identity-based focus-restore (paintOrg). Restructuring the button into a non-interactive
container to move the hit-area to `.face` risks that focus handling. The reported bug is the
NEIGHBOUR mis-fire (the invisible-callout capture), which `pointer-events:none` fixes cleanly;
hovering one's own square corner still shows one's OWN label, which is benign. See Weakest premise.

## What I rejected
- `clip-path: circle(50%)` on `.onode`: clips the callout that must render above the node; and
  risks the keyboard focus target. Rejected for the reasons above.
- Keeping the callout clickable (pointer-events:auto) but shrinking it: it is the capture that
  causes the bug, and Josh wants the avatar clicked, not the callout. Removing its interactivity is
  the aligned fix.

## Verification
- `web.org-view.test.js`: the #392 callout test updated to assert NO chevron (`co-go` / `&rsaquo;`
  absent); a new #2683 test source-pins `.onode .callout { pointer-events: none; }` present and
  `pointer-events: auto` absent (the mis-targeting-cause regression guard).
- `docs/browser-checks/render-org-chart.js`: the `calloutEvents === 'auto'` assertion inverted to
  `=== 'none'`; added runtime assertions that no node has a `.co-go` chevron, that hovering an
  avatar shows ITS OWN callout and exactly one callout (no neighbour mis-fire), and that clicking
  the avatar `.face` opens the agent detail. Verified all 12 pass on a real browser against a rich
  board (5 agents); the new assertions read real values (none / 0 / 1 / detailOpen=true) that
  invert on the pre-#2683 code (auto / >0 / a neighbour / no-open).
- Full node suite + both #1720 browser-check gates.

## Weakest premise
That Josh's "only when over that avatar's own circle" means "stop the neighbour mis-fire" rather
than "make the hover hit-area a mathematically perfect circle". I read it as the former because the
reported symptom is a NEIGHBOUR's label firing, and a perfect-circle hit-area would require clipping
the callout (which must render outside the circle) or restructuring the focusable button. If Josh
wants the square corners excluded too, the follow-up is a hit-area restructure; this change fixes
the reported bug and satisfies all three asks.

Browser-check: render-org-chart.js (callout pointer-events + chevron-absent + hover-targeting + click-opens).
