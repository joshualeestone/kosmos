# Project page (tab view) styling pass, #2711, strokes + header-rule batch

Second batch of Josh's 17-item project-page (tab view) styling pass (the copy
batch shipped in PR #2723). This branch does the two "remove the outlines"
items, both tab-view CSS removals:

- Item 5: remove the horizontal rule (a `border-bottom`) under the project
  title + search box in the tab view. The consolidated header keeps its own
  separator (its own `.pjmidhead` rule carries the border).
- Item 1: remove the light-gray strokes around the members card, the files
  card, the tasks box, and the dialog area (the conversation column `.pjmid`
  and its `.thread`) in the tab view.

## How it is scoped (dual-layout safety)

The base `.pjcard` / `.pjcol` / `.thread` border rules are shared with the
consolidated layout, whose tests pin that it keeps real borders. So item 1 is a
`body:not(.consolidated)`-scoped override that zeroes the borders only in the
tab view; the base rules still apply in consolidated. Verified against
`web.consolidated-match-mock.test.js` and `web.consolidated-980.test.js` (both
pass). Backgrounds are left untouched here (item 6 handles the dialog fill); the
box fills still differ from the page ground, so nothing becomes invisible.

## Gates

- #2518 surface gate: pass (no surface token an existing browser-check asserts
  changed).
- #1720 browser-check gate: satisfied with a `Browser-check:` trailer, since
  this is a CSS-only border removal that no page-layer browser-check asserts.

## Not in this branch

The remaining #2711 items (2 remove description triangle, 3 cog left of title,
4 search expand, 6 dialog white, 7 dialog always visible, 8 hover emoji picker,
10 add-buttons top-right, 15 agent file-post grey, 16 member 3-state colours,
17 remove back arrow) continue on later branches. Item 6 (white dialog) and 15
(file-post grey) are a coupled pair; several items are visual and want Josh's
eyes in the running app.

## Ownership

Design + content pass on the project page, Mona Lisa's lane, assigned by Josh in
`#chaoskosmos-design`. No engine/CLI/server changes. Collision check clear.
