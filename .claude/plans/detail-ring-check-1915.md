# Plan: the rendered confirm for the detail-avatar memory ring (#1915)

## Goal / what "finished" looks like

The #1915 memory-ring fix (PR #1924) is merged but the card was left OPEN for one thing:
a RENDERED confirm on a real page, deferred at the time to #1769 ("no bot session can
drive the live app"). #1769 is now stale (committed headless browser-checks run from any
session via `~/work/pw-runtime`, per Renet on the card). Done when: a committed
`docs/browser-checks` check drives the real `openDetail` on the real page with a known
reading and pins the rendered `#d-ring` arc, it is wired into the runner + indexed in the
README, it passes headless, and it is proven able to RED.

## Context

`web.detail-ring-1915.test.js` already executes `detailRing()` in isolation and pins the
arc geometry. What no source test can see is the exact class of regression #1915 WAS: the
arc reaching the actual page. `detailRing()` can be perfect while the one `openDetail` wire
line is dropped, or the `.dring` rule removed, and the isolated test stays green through it.
The board/list rings have browser coverage; the detail ring did not.

## Approach

`docs/browser-checks/render-detail-ring-1915.js`, self-booting like `render-detail-header-1841.js`
(own mktemp roots, OS-chosen port via `srv.start(0)`, `fleet.install`, runs bare):

1. Install one fixture agent, open its detail page.
2. A fixture pane carries no context percent (no real Claude session in the sandbox), so
   set a known reading on the open agent's own `LAST` entry and re-drive the real
   `openDetail` wire, both in one evaluate so no 5s poll interleaves. Same technique
   `render-detail-header-1841.js` uses for states the fixture cannot arrange.
3. Read the rendered `#d-ring`: 30/70/88% -> ok/warn/high band, arc length = (pct/100) * C
   (C = 2 pi 47) to the decimal, the arc CHANGES with the reading (a fixed arc passes a node
   test and fails this), the element is laid out, and an unknown reading draws no ring.
4. Wire it into the `for n in` loop in `tools/browser-checks.sh` and add a README row.

## Verification

- Ran headless (`NODE_PATH=~/work/pw-runtime/node_modules HEADED=0`): 11/11 PASS, arc lengths
  match to the decimal (30% -> 88.59, 70% -> 206.72, 88% -> 259.87).
- Proven able to RED: dropping the one `openDetail` wire line reds all eight "a reading
  renders a ring" arms (the exact #1915 regression class, `detailRing` intact); the unknown
  and no-page-errors arms correctly stay green. Measured, then restored.
- Measured, NOT assumed: dropping the `.dring` CSS does NOT red the laid-out arm (the span
  keeps a non-zero size from its svg content), so the comment claims only the wire-drop and
  fixed-arc RED arms, not a CSS-size one.
- `browser-checks-indexed.test.js` + `tools.browser-checks-wired.test.js`: 9/9 pass (README
  row present, check wired into the runner).
- No web/index.html change in this PR (the render merged in #1924), so the #1720 web-diff
  gate does not apply; this PR is the check + wiring + docs only.
