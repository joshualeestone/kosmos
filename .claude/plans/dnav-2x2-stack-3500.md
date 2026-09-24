# dnav-2x2-stack-3500: agent-nav four-pack as a 2x2 (Josh #3500 follow-up)

## Context
Josh, in #chaoskosmos-design 2026-09-24, on the #3500 boxed agent-nav (live in the app):
- icons and labels **stacked** (icon over label, centred) in every box, not side by side;
- the four boxes below Direct Message as a **2x2 grid**, all four tiles the **exact same size**;
- labels must **never wrap**; if a label would wrap at that width, fall back to a single
  stacked column at that point, but **the 2x2 is the ideal**;
- he likes the existing gold **active** treatment (unchanged);
- and he asked what **mouseover** should look like -> approved a low-intensity preview of the
  selected gold ("i dig it").

## Change (web/index.html, #d-nav scoped)
- `#d-nav.dnav-boxed button`: `flex-direction: row` -> `column`, `text-align: left` -> `center`,
  gap 10 -> 6. Icon over label, centred, in the DM box and the four pack tiles alike.
- `#d-nav .dnav-pack`: `flex column` -> `display: grid; grid-template-columns: 1fr 1fr`. Two equal
  `1fr` columns = a 2x2 of identical tiles, capped at two across (never three). Tile padding
  14/8; pack label 0.875rem (the longest label "Instructions" is ~80px, fits the ~90px cell
  with margin; measured).
- `@media (max-width: 56rem)`: add `#d-nav .dnav-pack { grid-template-columns: 1fr; }` so when the
  whole panel reflows narrow the pack drops to one column rather than being forced into a 2x2 that
  no longer fits -> a label never wraps.
- Mouseover: `#d-nav.dnav-boxed button:not(.on):hover` -> a faint warm wash
  `rgba(214,166,46,.06)` + a medium-gold edge `rgba(214,166,46,.5)` + label/icon warmed to ink
  (but NOT the gold icon, reserved for `.on`), so hover previews selection without reading as it.
  `:not(.on)` so a selected tile does not shift under the pointer.
- Active treatment (`.on`) unchanged.

## Why a grid, not auto-fit
`repeat(auto-fit, minmax(...))` is unbounded -- at a wide reflow it could give three columns.
`1fr 1fr` + a single-column media fallback caps it at two and matches Josh's "2x2 or a single
column, never a wrapped label".

## Verification
- render-agent-nav.js (updated, both themes): the pack is two equal columns at the 220px nav
  (`tracks=2`), one column at 420px (`tracks=1`), every label on one line with no truncation
  (`scrollWidth<=clientWidth` on all four). Negative control: forcing the grid single-column at
  wide reds the two-column arm (`tracks=1`). The #3045 one-line/no-overflow guard on the bold
  active label still PASS.
- render-talk-fill-2622.js (a SIBLING cut-time check, NOT in this diff -- run separately to
  confirm no cross-check regression): A2c `navGapInDleft=0`, i.e. the now-taller stacked nav still
  sits flush in its `.dleft` row (that check's `.dleft` is `overflow:auto` in the Talk state, so a
  taller nav scrolls rather than reflowing the flush row). Verified out-of-band, not gated by this
  changeset.
- web.agent-nav.test.js: 5/5 (markup unaffected).
- Ad-hoc in-process board render (a throwaway screenshot script, not committed): 2x2 = `106px 106px`,
  zero label overflow at a 1400px viewport; a single `382px` column at a 430px viewport. The
  committed narrow assertion in render-agent-nav.js tests the single-column state at 420px.
  Screenshots shown to Josh.

## Scope
web/index.html (nav CSS only) + docs/browser-checks/render-agent-nav.js (assertion). No behaviour
change, no product-logic change. #3500 design follow-up.
