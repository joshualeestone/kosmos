# agentseg-4594: the Agents view switch is one segmented control (kosmos#4594)

## Why
Josh, #admin 2026-09-29 12:01 CDT: "we should jsut display the segment controller for the different views here".
In the consolidated view, the Agents column's Grid / Org chart switch is two separate pills (`.cons-agents-lay`).

## Reuse, not a new control
The app's segmented language is `.laypick` / `.pj-mode`: a 0.5px separator track, `radius-control`, the elevated
ground, and a GOLD selected segment with #14161a ink (the "selected is gold" ruling). This switch carries words,
so its segments are sized to them (like `.pj-mode`), not `.laypick`'s 38px icon squares. Same selector
convention as those: its own block with the shared values, not a shared selector.

## Change
- CSS: `.cons-agents-lay` becomes the track; its buttons are segments with a separator between them.
- Semantics: `role=radiogroup` of `role=radio` with `aria-checked` (was `aria-pressed`), one tab stop on the
  checked segment (the first when none is, e.g. a saved 'list'), Left/Right/Up/Down move, choose and wrap,
  Home/End go to the first/last (a key landing on the chosen segment only moves focus).
  `consLaySync()` keeps state, tab stop and BOARD_LAYOUT together.
- Only in the consolidated view (>= 960px), so there is no phone form of this switch.

## Checks
render-consolidated-nav-4345.js: the radiogroup, one connected track (bordered, clipped, segments touching),
the gold selected segment, one tab stop, ArrowRight chooses Org chart and wraps back; both themes. Putting the
pill CSS back reds the track check in both themes. Screenshots for Mona via /design-shots.
