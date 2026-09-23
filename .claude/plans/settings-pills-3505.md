# #3505 - settings pages: pills off the left vertical rule + sized to their label

Josh, 2026-09-23 (design channel, screenshot), plus a 15:05 refinement comment. Two display-only
fixes to the settings navigation pills, applying to the settings pages across the app.

## The two asks

(a) **Left margin off the vertical rule.** The settings nav pills sit flush against the left
vertical rule (the projects-list column's right border in the consolidated view). Measured: the
settings panel's left edge equals the projects-list column's right edge, so the pills had a zero
gap to the rule. Add a real gap.

(b) **Size pills to their label, not full-width** (Josh 15:05): "the settings pills should be only
as wide as their largest text label, not stretched full-width - reduces clutter." The pills were
`width: 100%`, so short labels ("Updates", "Advanced") were as wide as long ones ("Kosmos Plus").

## What I changed (display-only, scoped to the settings nav)

- **(a)** consolidated `#panel-projects > #panel-settings` gained a left inset (`padding-left:
  var(--space-8)`, matching the existing top/right insets from #3054). The panel's left edge sat on
  the projects-list rule; padding insets the content (nav + sections) off it. Padding is inside the
  border-box, so the #2842 fill assertion (border-box width) is unaffected.
- **(b)** `#s-nav { width: max-content; max-width: 100%; }`. `.snav` is a flex column, so
  max-content shrinks the nav to its widest button and the existing `width: 100%` buttons all match
  that one width: uniform, left-aligned, no longer full-column.

## Decisions and what I rejected

- **Scoped to `#s-nav`, NOT the shared `.snav`.** `.snav` is used by both the settings nav
  (`#s-nav`) and the agent-detail nav (`#d-nav`). #3500 is a separate, in-flight redesign of the
  agent nav (icon+label rounded boxes, active-state options for Josh to compare). Changing `.snav`
  here would pre-empt #3500's design. So #3505 touches only the settings nav; the settings/agent-nav
  consistency Josh mentioned lands when #3500 does.
- **Rejected: shrinking the consolidated nav grid column too.** The column stays `minmax(120px,
  30%)`; the narrower pills leave whitespace before the content card, which reads fine (the content
  card is clearly separated) and avoids touching the #2842 fill assertion.
- **Interpreted "as wide as their largest text label" as uniform-at-longest** (all pills the same
  width = the longest label), not each-pill-its-own-width (which reads ragged in a vertical column).

## Weakest premise

That deferring the settings/agent-nav visual consistency to #3500 is what Josh wants, rather than
changing both navs now. If he wants them consistent immediately, #3500 (also mine) is the vehicle
and will match this treatment. What would change my mind: Josh saying the agent nav should match
before #3500 lands.

## Verification

- Rendered both the tab-view and consolidated settings (headless, pinned Playwright). Confirmed the
  gap off the rule (0 -> 24px) and the pill width (full-column -> longest-label).
- Extended `render-consolidated-settings-2842.js` with two assertions (gap off the rule; pill sized
  to label), positive-controlled: with the CSS reverted both go red across both themes (26 passed, 4
  FAILED); with the fix, 30 passed.
- `render-settings-nav.js` measures `#s-nav` width directly (1400/920/420px), so I re-ran it (not
  just reasoned): all passed. The nav track geometry is fixed by `grid-template-columns`, so the
  narrower `max-content` nav still sits at the track start and its relative-position/overflow
  assertions hold.
