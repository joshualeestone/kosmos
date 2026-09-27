# unreadtail-3743: the unread gold edge returns, drawn round the bubble's tail

Card: #3743 (reopened 2026-09-27), after #3967 / PR #3988 removed the first edge.

## Done means

An unread agent message in a Direct Message, a project room and the setup guide carries a 1px gold
outline that follows the whole bubble including the tail, fades over 1.2s once read, and a read
bubble looks exactly as it does on main. Measured by render-unread-edge-3743.js (U1, U2, U14, U15,
U17, U18), with the old inset-shadow edge as a control that must go red on U17.

## Why the first edge was removed

Josh 2026-09-26 09:01: the outline "doesn't go around the little message nipple thing ... it looks
broken this way", and "I really like the dark gold stroke that appears and fades out". It was an
inset box-shadow on `.msg-bd`; the tail is `::before` (wing) carved by `::after` (a ground-coloured
mask), both outside the box, so no box property can reach them.

## Approach

1. Outline = four 1px `drop-shadow`s on `.msg-bd` (a filter traces everything the element paints,
   pseudo-elements included).
2. The filter would also trace the `::after` ground mask's block, so the wing carves itself with a
   CSS mask (same ellipse the `::after` carves: 12px x 16px, centred 12px outside the bubble edge
   and 16px above its bottom). Applied always, on agent bubbles only; it removes only wing pixels
   `::after` already paints over, so a read bubble is unchanged (measured: 0 differing pixels vs
   main, light and dark).
3. While `data-unread`: `::after` is `visibility: hidden`. On read, `::after` returns via
   `transition: visibility 0s 1.2s`, i.e. only after the filter's 1.2s fade, so the fade never
   outlines the mask block.
4. Dark / navy `--unread-edge` becomes opaque `#a8842f`: four stacked translucent shadows compound
   unevenly where they overlap.
5. `.dmthread` gets `padding-bottom: 2px`: a filter is not scrollable overflow, so scrolled to the
   end the newest bubble's bottom stroke was clipped. Static padding, so reading moves nothing and
   the scroll repin (render-room-scroll.js) is untouched. The room thread already has 12-14px.

## Rejected

- Redrawing the tail as one SVG/clip-path shape: matches, but the tail geometry is pinned by
  server.test.js and pixel oracles (render-room-msgbox-2806.js); this approach leaves read bubbles
  byte-for-byte the same render.
- A separate stroke on the wing (box-shadow on `::before`/`::after`): leaves a seam where the wing
  meets the bubble and an overshoot past the wing tip.
- An SVG `feMorphology` filter: exact single-colour outline, but cannot fade per bubble.

## Weakest premise

Measured in Playwright Chromium and WebKit, not in Safari on Josh's Mac. The mask ellipse is hand
derived from the `::after` geometry; if that geometry changes, the two carves diverge (only visible
while unread).
