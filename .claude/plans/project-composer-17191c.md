# Project composer: dark input #17191c, inset (Josh 2026-09-21)

## Request (Josh, #chaoskosmos-design, 2026-09-21, with screenshots)
On the project room composer (tab + wide project views), dark mode:
1. Kill the grey bar separating the dialogue and the input box.
2. Add left/right margin so the input is completely surrounded by black.
3. Input box background = #17191c. Same for the tab-view dark-mode input.

## Diagnosis
In dark mode the two project composers (#pj-post room box, #pj-say agent-say box) were a
full-width recessed --k-sunk wash on a black strip (#3369/#3378). Full-width + a faint grey
wash = the "grey bar" Josh saw. #17191c is in fact the app's own dark card surface (--k-surface).

## Change (dark only, project composers, not plus)
- One dark rule (in the #3340 @media dark block, prefix-style matching its siblings), twinned
  to [data-theme="dark"] by tools/sync-forced-theme.js: fill the two project composerboxes a
  solid #17191c and margin-left/right:12px so the black ground shows on both sides.
- :not(.dragging) so the #2868 gold drag tint still wins (same guard the base fill carries).
- Light mode untouched (keeps the #3369 recessed fill, which Josh approved). Plus untouched
  (keeps its navy design; scoped body:not(.plus-active) like #3340).

### Rejected
- Insetting/recoloring in light mode too: Josh asked only for dark ("surrounded by black" is a
  dark concept), and light is an already-approved design. Left it. Theme-dependent width is a
  minor, deliberate consequence; easy to extend to light if Josh wants it.
- var(--k-surface) instead of the literal #17191c: identical in dark, but Josh gave the literal
  hex, so the rule states it literally and unambiguously.

### Weakest premise
- That #17191c on the black strip reads as a distinct-enough field. It is #17191c vs #000 (~23
  levels) plus the 12px inset + radius, which the render shows reading as a contained input.
  What would change my mind: Josh wanting more contrast, an easy nudge.

## Verification
- Rendered before/after headless (dark, consolidated); sent Josh the after for a look.
- render-composer-stroke.js extended: dark arm asserts #17191c fill + both-side inset; a
  light-mode control asserts the dark fill does not leak. 53 checks pass. sync-forced-theme
  --check clean. composer-drop-2868 + focus-ring unit tests green.

## Files
- web/index.html - one dark rule (+ its generated forced-theme twin).
- docs/browser-checks/render-composer-stroke.js - dark #17191c + inset assertions.
