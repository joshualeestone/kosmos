# #4880 Tasks tab: a task row reads as clickable

Josh, #admin, 2026-10-01 09:21 CDT (verbatim): "On the Tasks tab can we get a subtle rollover state when I roll over one of the tasks, similar to how we show it on that Tasks page? When you roll over a card you get an active state so you know it's clickable"

## Done means
Hovering or tabbing to a task on the Tasks tab shows an active state; a browser check asserts the hover paint differs from rest, with a control that fails on main. Served in a build.

## Calls (Mona Lisa)
- **Ground, not border.** The rows are list rows inside one rounded list, not separate cards, so the room's card treatment (border colour in the old look, `--k-bg` ground in the new look) is translated to a ground tint on the row. Rejected: a border per row (rows share rules; a border on hover would shift or double the rule).
- **A see-through tint** `color-mix(in srgb, var(--k-ink) 5%, transparent)` over the row's own ground. First attempt mixed toward `--k-surface`, which on the old look's cream list read as a cooler grey (wrong direction for Josh's warm-cream preference). A tint over the ground keeps cream warm, shades white softly, and lifts dark.
- **:focus-within as well as :hover**, so a keyboard user sees the same state.
- **A ticked row keeps its gold wash** (`:not(.sel)`).
- **The row itself opens the task on click** (empty parts only). A row that lights up but does nothing when clicked would be an affordance it cannot honour; only the title opened the task before. Controls keep their own action; a click ending a text selection does not navigate.
- Weakest premise: that Josh wants the whole row clickable, not just a visual cue. If not, drop the click handler; the hover stays.

## Check
`docs/browser-checks/render-taskhover-4880.js`: painted pixels at the row's empty right end (rest vs hover vs focus), box unchanged, cursor pointer, ticked row unchanged under hover, project-name click opens the project (control), empty-part click opens the task. Old and new look, light and dark. Control: fails on main (hover, cursor, focus, row-click lines).

Wiring: README row, `docs/browser-checks/gated.txt`, reason-grep EXPECTED_SITES 227 -> 228 (measured).
