# Plan: consolidated-breakpoint

Splinter unblocked this item (2026-08-25 ~17:52) after resolving a version
question that had nothing to do with it. Before building, asked Josh
directly which shape he wanted (rather than guess): "below 1280px, instead
of the hard drop, both side rails auto-fold down to icon-only first... and
only below some smaller floor (was thinking ~960px) does it actually fall
back to tabs." His answer, 17:58: "thats perfect, lets try that."

## The bug

The consolidated view was a hard binary switch at exactly 1280px: at or
above, consolidated; below, straight to the tab view, with no
intermediate adaptation. 1280px is also the design width the reference
mock (installkosmos.com/consolidated-mock) was drawn at, so the floor was
never arbitrary, but a person resizing the window even slightly below it
lost the whole view rather than seeing it adapt.

## Change

Two named width constants replace the one magic number:
`CONSOLIDATED_MIN_WIDTH = 960` (the real floor; below this, tabs) and
`CONSOLIDATED_FOLD_WIDTH = 1280` (below this, both rails auto-fold; at or
above, the view renders exactly as it always did).

- CSS: the whole consolidated `@media` block now gates at 960px instead
  of 1280px. No new CSS rules were needed -- the auto-fold reuses the
  existing `.fold-a`/`.fold-p` rules (already written for the manual
  per-rail fold buttons) exactly as they are.
- JS (`railFoldsApply`): a rail's fold state now has three possible
  sources instead of two -- an explicit stored `'1'` (always folded), an
  explicit stored `'0'` (always open), or, when neither has ever been set,
  the width itself (folded below `CONSOLIDATED_FOLD_WIDTH`). The click
  handler now always writes an explicit `'1'`/`'0'` rather than sometimes
  removing the key, so a rail a person has genuinely never touched keeps
  reacting to width, while one they have clicked stays pinned regardless
  of width, for the rest of the session (a fold is "a reading posture, not
  a setting", the existing code's own words -- once posed, it holds).
- The resize listener now re-runs `railFoldsApply()` on every resize while
  consolidated is active, not only when crossing the min-width boundary
  that switches consolidated vs. tabs -- otherwise resizing purely within
  960-1280px would never re-fold or re-open the rails.
- Updated the picker's own description text and the save-toast wording to
  match the new floor and mention the fold behavior.

## Verification

- [x] Live Playwright verification of the actual resize sequence, not
      just source assertions: 1400px (both rails open) -> 1100px (both
      auto-fold, still consolidated) -> 1000px (still auto-folded, still
      consolidated) -> 900px (falls back to tabs) -> back to 1400px
      (rails reset to open) -> explicit fold/unfold click at 1400px ->
      narrowed to 1100px again, confirming the explicitly-reopened rail
      STAYS open while the untouched rail auto-folds. Screenshot confirms
      the visual result matches (agents rail full width, projects rail
      icon-only, at 1100px).
- [x] `node --test web.consolidated-breakpoint.test.js` (new file): 5/5
      pass, pinning the auto-fold condition, the three-state precedence,
      the click handler always writing an explicit value, and the resize
      listener re-running the fold logic.
- [x] `node --test web.layout-picker.test.js`: updated for the new
      constants and floor text, 14/14 pass.
- [x] `npm test` (full suite): 2131 pass, 0 fail.
- [x] `bash tools/browser-checks.sh` (full suite).
