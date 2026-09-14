# Project page (tab view) styling pass, #2711, search box

Fourth batch of Josh's 17-item project-page (tab view) styling pass (copy #2723,
strokes #2730, white dialog #2736 shipped). This branch does item 4, the
tab-view conversation search box:

- The placeholder is just "Search" now (was "Search this conversation"); the
  accessible name (aria-label) stays the fuller "Search this conversation" so a
  screen reader still gets the context the shorter visible hint drops.
- The box is narrower at rest (`min(190px, 30%)` vs the old `min(320px, 40%)`)
  and widens to `min(420px, 60%)` on focus (`:focus-within`), so the person has
  room to type once they click in. Only the flex-basis animates (0.15s).

## Scoping

The placeholder change is on `#pj-room-search` only (the room search). The
agent-DM search (`#d-talk-search`) keeps the fuller placeholder, so the
server.test.js assertion was re-keyed on `#pj-room-search` specifically (a bare
`includes()` would otherwise pass off the DM search). The width/focus rules are
`body:not(.consolidated) .pjmidhead:has(.pjhead) .tsearch ...` scoped; the
consolidated search keeps its own width (its higher-specificity
`.pjmidhead .tsearch` rule wins there anyway).

## Gates

- #2518 surface gate: `pj-room-search` is surface-mapped to render-head-row.js,
  which measures the search box only for non-overlap with the title/gear (a
  narrower box cannot break that, and it measures the unfocused state), so a
  `Browser-check-surface: render-head-row.js` trailer covers it.
- #1720 gate: a `Browser-check:` trailer (CSS + placeholder, no page-layer check
  asserts the placeholder text).

## Not covered by a browser-check

The expand-on-focus behavior has no page-layer check (a new Playwright check to
focus the search and assert it widens is out of scope for this batch); the CSS
is simple and Josh reviews it visually in the running app.

## Not in this branch

Remaining #2711 items: 2 (remove description triangle), 3 (cog left of title),
7 (dialog always visible), 8 (hover emoji picker), 10 (add-buttons top-right),
16 (member 3-state colours), 17 (remove back arrow).

## Ownership

Design + content pass on the project page, Mona Lisa's lane, assigned by Josh in
`#chaoskosmos-design`. No engine/CLI/server changes. Collision check clear.
