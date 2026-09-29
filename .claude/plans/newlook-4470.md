# #4470: the new look behind a hidden switch, part 1 (switch, tokens, project page)

## Finished looks like
- Settings > Advanced has "Try the new look", a switch that is Off by default. Off (nothing stored) sets
  no attribute, so no new-look rule can match: the app is today's app.
- On stores `kosmos-look=new` in this browser only (no server call); the head script applies
  `html[data-look="new"]` before paint, so a reload keeps it without a flash.
- With it on, the colour tokens follow Josh's drawings (Files/kosmos-project-two-col-v9 light, -v7-dark
  dark), in system dark and chosen Dark alike (the forced-dark copy is generated).
- With it on, in the tab layout, the project page matches the v9 drawing: two columns; Members, Tasks and
  Files in one grey box; the conversation unboxed on the page; a round back button and "Projects / name"
  as the header; member rows with the state word; compact task rows; your messages grey, an agent's with
  no bubble; the composer a grey pill; the top bar's tabs marked by ink, not an underline.
- The consolidated layout keeps today's ARRANGEMENT in both states; with the look on, its colours follow the new
  tokens and the top bar's tab styling, like every other page.

## How
- Head script beside the theme one; `lookPaint` / `lookToggleClick` beside the engineering-mode switch.
- CSS under `:root[data-look="new"]` (and `body:not(.consolidated)` for the project page), placed before the
  generated forced-dark section; `tools/sync-forced-theme.js` now joins a compound `:root[...]` selector.
- `placeLook(cons)` at the same chokepoint as `placeAppSettings`: MOVES Tasks into the left box and the
  crumb row into the conversation header (and back), so the keyboard order matches the eye (#1017).
- Member row: a `.pj-member-st` state word (stateCopyOf / cardStOf), display:none outside the new look.
- Task card: markup unchanged. The new look draws "#n" from the button's existing `data-task` and clips
  the "Task n" text like `.vh`, so a screen reader still reads it.

## Decided (weakest premise named)
- The member state word follows the v9 drawing over the 6.72 room-column ruling (#3212), only in the new
  look. Weakest: that the drawing's word is meant. One CSS rule removes it.
- The task claim line stays as a small second line though the drawing omits it (2026-08-19 ruling: a claim
  state never renders as nothing). Weakest: that Josh left it out for space.
- Settings then search keep markup order (the drawing has search first) rather than a CSS reorder.
- The working pulse (#3956) is off on member rows in the new look; the dot and word carry the state.

## Rejected
- CSS-only placement of Tasks / the crumb (keyboard order would differ from what is seen: #1017).
- Rewriting today's markup for the new look (every existing test and check reads today's markup).

## Verification
- `web.newlook-4470.test.js` (head script, token sets, switch), `docs/browser-checks/render-newlook-4470.js`
  (light / dark / 390, both states, a direct load onto the project, chosen Dark arms, seeded tasks and a
  working agent; its own output prints the count), wired
  in gated.txt and the README. Negative controls run for the composer and the working-row pulse.
