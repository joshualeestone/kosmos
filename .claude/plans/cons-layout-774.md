# cons-layout-774: the consolidated view renders the same whatever the Agents page was left on (#774)

Josh, 2026-08-24 22:34 in #chaoskosmos-design, two screenshots: "If I go into
settings and switch to consolidated view, depending on what I left my agents on
affects how the consolidated view renders." The second screenshot showed both
rails folded and a blank centre: "I have no way to get back."

## Finished looks like

- Arriving in the consolidated view with the Agents page last left on grid,
  list or the org chart renders identically: the agents rail is the list, the
  projects rail sits beside it at the same height, no chart and no grid.
- The tab view still keeps the person's chosen layout, org chart included.
- With nothing open, the consolidated centre says what to press. With the
  projects rail folded, it says where the list went. It never appears in the
  tab view and disappears the moment a project is open.
- A page check renders all of that in a real browser and is wired into
  tools/browser-checks.sh; a unit test pins the guard and the sentence.

## The mechanism

- `boardApplyVisibility` already forced the rail to the list under
  `body.consolidated` but still showed `#orgview` from `BOARD_LAYOUT === 'org'`.
  One more guard on that line; `BOARD_LAYOUT` itself is untouched so the tabs
  get the chart back.
- `#pj-none`, one `<p class="fhint">` before `#pj-list-view`, painted by
  `paintPjNone` from `pjView` (every view change) and `railFoldsApply` (every
  fold change). It sits in grid column 2, row 1, so it does not push the
  projects rail into a second row (the first cut did, by 273px; measured).

## Out of scope

- The fold buttons' own affordance (a folded rail's `›` is small); carded
  separately if Josh raises it.
- Why the org chart is a tab-only layout: unchanged design, not this card.
