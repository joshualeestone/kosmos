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

- `.onode .face > * { will-change: opacity }`: every face's contents sit on a layer of their own from the
  start, so a hover's opacity transition no longer re-rasterizes the faces around it. The hover callout
  gets the same (a precaution; not measured to matter in Chromium).
- `.orgmap .onode { will-change: transform }`: every node is a layer of its own, so the hover's
  `z-index: 2` only reorders layers and never repaints a neighbour. Counted in S41 attempts (one
  attempt hovers rex, crew and crew2 and compares 4 pairs; the runner retries a whole check once when
  any arm fails, so one run can hold two attempts): with only the faces layered, 2 of 6 attempts were
  red (a neighbour's pixels moved by 10/255); with the nodes layered as well, 12 of 12 attempts over
  11 runs passed (one run was retried for an unrelated arm, S4). Without either, every attempt is red.
- The cost is three small layers per agent (node, face contents, callout), plus a clip mask for a face
  with a picture, while the chart is shown; unmeasured on a large fleet. The selectors stay on the org
  chart's 44px nodes. The callout's layer is kept because it was part of the configuration measured.

## The check

`render-swarm-ui-3564.js` S41: on the settled org chart (preconditions: settled, and crew and crew2
really drawn as clusters; the comparison is skipped rather than run on a chart that failed them), with
the status poll held so no repaint lands mid-comparison, hover each of rex, crew and crew2 in turn and
assert no cluster element's box moves (the hovered one included: a border planted on hover squeezed it
from 44 to 40px and reddened the check) and no pixel of a cluster that is not hovered moves (its face;
swarmLayout keeps the circles inside the node's box), unless something the raised hovered node paints
lies over it. The captures are DECODED and compared per pixel with a 2/255 noise floor: comparing the
PNG bytes failed on identical pixels (two encodings differ), and a 6px margin picked up 1/255 anti-alias
noise, which made the check red with and without the fix. The shift it guards measured 9/255.

## Rejected

- Rounding positions: measured, no effect.
- Removing the hover opacity: Josh's ruling keeps portraits quieter than the ring (#284).

## Weakest premise

The fix is measured, not proven: the jiggle was intermittent, and 0 red in 12 attempts shows it is far
rarer, not that it is impossible. If S41 goes red now and then in CI, read it as this race first, not
as a new regression, and look at the pixel figure it prints (a real shift measured 10/255).

Text on a layer of its own can lose subpixel antialiasing, which could soften it on a non-Retina display
(and on Windows, where WebView2 uses ClearType). No names show at rest on this chart, but the layers do
carry text: the initials in every face without a picture (`.oinit`, at rest), the unread-count badge on
a node, and the hover callout. Those are what to look at. Unmeasured on a non-Retina display.

Josh sees it in the Mac app, a WKWebView. It is reproduced and fixed here in Chromium only. Playwright's
WebKit drew no cluster in the fixture (so its run compared nothing and proves nothing), and it is not the
app's WKWebView anyway. The mechanism (a layer created only during a transition) is shared by WebKit and
`will-change` is honoured there, but that is reasoned, not measured. Checking it on the next cut build in
the app is what would confirm it.
