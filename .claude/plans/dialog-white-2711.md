# Project page (tab view) styling pass, #2711, white dialog + grey file cards

Third batch of Josh's 17-item project-page (tab view) styling pass (copy batch
#2723, strokes batch #2730 shipped). This branch does the coupled pair items 6
and 15, both tab-view CSS fills, building on the item 1/5 strokes removal:

- Item 6: the dialog area (`.pjmid .thread`) is white (`--k-surface`) instead of
  the super-light gray (`--k-bg`). The `.pjmid` column is already white, so with
  item 1's borders gone the thread joins it as one flat white area. Josh's
  rationale was that a white dialog helps the blue own-message tint stand out;
  in practice that `--usermsg-tint` lives on the agent-DM thread and the "Talk
  to one of them" panel, not on `#pj-room` (whose posts render plain), so in the
  room this is a cleaner-surface change rather than a blue-contrast one. Flagged
  for Josh; the code comment says the same.
- Item 15: a file an agent posts (the `.att` card, currently `--k-surface`
  white, which would vanish on the white dialog) gets the light gray the dialog
  used to be (`--k-bg`) - Josh's own suggestion - so it stays visible.

## Scoping and safety

Both rules are `body:not(.consolidated) .pjmid .thread ...` scoped, so:
- the consolidated view keeps its own thread fill (`background: none`, asserted
  in web.consolidated-867.test.js) and the `.att` default;
- the agent DM thread (`#d-dmthread`) is untouched, so render-talk.js's
  usermsg-tint contrast check (which reads `#d-dmthread .dm.mine`) is unaffected.

Contrast: making the thread white raises text contrast (dark ink on white beats
dark ink on off-white), which is the direction item 6 wants (the blue user
messages become MORE visible); the `.att` off-white keeps the file name well
above the text floor. render-thread.js measures text contrast, which improves.

## Gates

- #2518 surface gate: pass (no browser-check-asserted surface token changed).
- #1720 browser-check gate: satisfied with a `Browser-check:` trailer (CSS-only
  fill change; the contrast checks measure floors white maintains or improves).

## Not in this branch

Remaining #2711 items: 2 (remove description triangle), 3 (cog left of title),
4 (search expand), 7 (dialog always visible), 8 (hover emoji picker), 10
(add-buttons top-right), 16 (member 3-state colours), 17 (remove back arrow).

## Ownership

Design + content pass on the project page, Mona Lisa's lane, assigned by Josh in
`#chaoskosmos-design`. No engine/CLI/server changes. Collision check clear.
