# #4880 Tasks tab: a task row reads as clickable

Josh, #admin, 2026-10-01 09:21 CDT (verbatim): "On the Tasks tab can we get a subtle rollover state when I roll over one of the tasks, similar to how we show it on that Tasks page? When you roll over a card you get an active state so you know it's clickable"

## Done means
Hovering or tabbing to a task on the Tasks tab shows an active state; a browser check asserts the hover paint differs from rest, with a control that fails on main. Served in a build.

## Calls (Mona Lisa)
- **Ground, not border.** The rows are list rows inside one rounded list, not separate cards, so the room's card treatment (border colour in the old look, `--k-bg` ground in the new look) is translated to a ground tint on the row. Rejected: a border per row (rows share rules; a border on hover would shift or double the rule).
- **A see-through tint** `color-mix(in srgb, var(--k-ink) 5%, transparent)` over the row's own ground. First attempt mixed toward `--k-surface`, which on the old look's cream list read as a cooler grey (wrong direction for Josh's warm-cream preference). A tint over the ground keeps cream warm, shades white softly, and lifts dark.
- **Keyboard focus as well as hover** (`:has(:focus-visible)`, changed from `:focus-within` in review round 1), so a keyboard user sees the same state.
- **A ticked row keeps its gold wash** (`:not(.sel)`).
- **The row itself opens the task on click** (anywhere outside the row's controls, its text included). A row that lights up but does nothing when clicked would be an affordance it cannot honour; only the title opened the task before. Controls keep their own action; a click ending a text selection does not navigate.
- Weakest premise: that Josh wants the whole row clickable, not just a visual cue. If not, drop the click handler; the hover stays.

## Check
`docs/browser-checks/render-taskhover-4880.js`: painted pixels at the row's empty right end (rest vs hover vs focus), box unchanged, cursor pointer, ticked row unchanged under hover, project-name click opens the project (control), empty-part click opens the task. Old and new look, light and dark. Control: fails on main (hover, cursor, focus, row-click lines).

Wiring: README row, `docs/browser-checks/gated.txt`, reason-grep EXPECTED_SITES 230 -> 231 after merging main (measured: 231 passes, 230 fails the test).

## Review round 1 (opus) changes
- Touchscreen: no tint, no pointer, and the row does not open on tap (`@media (hover: hover)` for the CSS; a `(hover: hover)` test in the handler). Its 44px tap areas sit close together (#4226), so a near-miss must not leave the view.
- The checkbox's column never opens the task (a click just below the 16px box is a missed tick).
- Keyboard state is `:has(:focus-visible)`, not `:focus-within`, so a mouse tick does not leave the row tinted.
- Known limit, accepted: the first click of a double-click on row text opens the task before the word can be selected. Selecting by drag still works. Text in a row can also be read on the task page.
- Check: project-open control now asserts the project page opened; a theme CONTROL; a phone pass (390, touch). Mutations removing the touch guard and the checkbox-column guard each turn their lines red.

## Review round 2 (sonnet) changes
- The control guard only counts a control INSIDE the row (`row.contains`), so an ancestor control can never swallow the row click.
- The checkbox guard covers everything left of the checkbox's right edge (the row's left padding and an indent too). Intended: that strip is the tick's territory.
- Check: desktop passes in Chromium AND WebKit (the Mac app is WebKit); one consolidated-layout pass (Tasks in the display column).

## Review rounds 4 to 6 changes
- The control guard also skips `[role]`, `[tabindex]` and `[contenteditable]` inside the row (never the row itself).
- The selection guard counts only a selection that touches this row (`containsNode(row, true)`), so a leftover selection elsewhere on the page cannot make a row dead.
- Comments say what the code does: any click in the row outside its controls opens the task; the gate is a hovering main pointer.
- Check: before the row click, a CONTROL line asserts the spot is inside the row and on no control, so a layout change fails loudly instead of misleadingly. Two header claims the script did not assert were removed.
- Accepted, not changed: the pointer and tint also show over the strip left of the checkbox's right edge, where a click does nothing (it is the tick's territory, and the box itself is a click target there).
