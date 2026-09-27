# orghover-4052: hovering an agent must not move any cluster on the org chart (#4052)

## Why

Josh, 2026-09-26 18:14: "When I'm on the org chart view and I mouse around onto other agents, it makes
the cluster icons jiggle and shift about maybe 1 or 2 pixels".

## What was measured

- Hover never re-runs the org layout (pointermove acts only in a drag) and changes no box: the only
  hover rules are `z-index: 2` on the node and the face contents' opacity (.5 to 1, a .12s transition).
- Reproduced in Chromium with a pixel comparison: hovering one swarm (crew2) redrew another cluster
  (crew) differently, 20 pixels at the edge of its circles, while every circle's getBoundingClientRect
  was identical to the thousandth of a pixel. So the card's suggested rect-only guard stays green on
  this bug.
- Rounding node positions to whole pixels did NOT fix it. `will-change: opacity` on the face contents
  did, on its own (both measured in a scratch worktree).

## The change

`.onode .face > * { will-change: opacity }`: every face's contents sit on a layer of their own from the
start, so hovering one node no longer changes how its neighbours are layered and rasterized.

## The check

`render-swarm-ui-3564.js` S41: on the settled org chart (preconditions: settled, and crew and crew2
really drawn as clusters), hover each of rex, crew and crew2 in turn and assert no cluster's box moves
(the hovered one included, so a border or scale planted on hover reds it) and no pixel of a cluster that
is not hovered changes (a CONTROL shows two untouched captures are identical). The hovered cluster's own
pixels change by design (half to full strength).

## Rejected

- Rounding positions: measured, no effect.
- Removing the hover opacity: Josh's ruling keeps portraits quieter than the ring (#284).

## Weakest premise

Josh sees it in the Mac app, a WKWebView. It is reproduced and fixed here in Chromium only. Playwright's
WebKit drew no cluster in the fixture (so its run compared nothing and proves nothing), and it is not the
app's WKWebView anyway. The mechanism (a layer created only during a transition) is shared by WebKit and
`will-change` is honoured there, but that is reasoned, not measured. Checking it on the next cut build in
the app is what would confirm it.
