# Plan: permission sliders gray-until-granted + animate + clickable-to-open (#2620)

## Goal
Josh, #2620: on the first-run S3 (Automation) screen, the two mock macOS permission switches
(.s3-sw, in the Energy and Accessibility illustration windows) were hardcoded blue/On. Make them
honest and useful: gray while the real permission is not granted, blue once it is, with a gentle
"go flip this" swipe hint, and clickable to open the exact macOS pane. Mona owns the design; this
plan is her approved spec.

## Scope
- The mock `.s3-sw` MIRRORS its paired gate row's state instead of a hardcoded On. Gray `#e2e2e5`
  (knob left) until the gate is granted, then blue `#2f7bf6` (knob `transform:translateX(16px)` on
  `::after`). State (`data-granted`/`data-checking`/`data-battonly`) is copied from the gate row by
  `frPollGates` (CSS cannot select a preceding sibling and the mock sits above its row).
- Swipe hint: paired `@keyframes s3-sw-hint-bg` + `s3-sw-hint-knob`, 2.6s ease-in-out infinite, on
  the timeline 0-8% hold OFF / 8-32% flip ON / 32-55% hold ON / 55-79% flip OFF / 79-100% hold OFF.
  Shown ONLY while `:not([data-granted]):not([data-battonly])` (not granted and satisfiable).
- `@media (prefers-reduced-motion: reduce)`: no animation, switch shows its honest static position.
- battonly (sleep-on-battery, no macOS switch): static gray, no hint.
- Clickable: a REAL focusable button (`.s3-sw-open`) is lifted OUT of the aria-hidden `.s3-win`
  subtree (into a `.s3-mock` position:relative wrapper) and positioned over the switch. It opens the
  exact macOS pane (Energy for sleep, Accessibility for tmux) via the same `frFirePermission` map as
  the row's "Turn On" button. The Turn On button is KEPT.

## Key decisions (Mona approved 2026-09-09)
- Keep `.s3-win` decorative (aria-hidden + pointer-events:none) so the 0.6.41 decoy fix holds (a
  click on the decoy switch cannot be mistaken for the real action). The real click + a11y live on
  the separate overlay button, not the in-mock switch. Preserves the render-gated-next:252 invariant.
- The two mocks DIFFER IN HEIGHT (Energy label is one line, Accessibility is two: "Kosmos" +
  "Control your computer"), so the switch's vertical position differs per mock. `frSyncSwitchOverlays()`
  MEASURES each switch's rect (getBoundingClientRect, headless-safe) and positions its overlay, rather
  than hardcoding an offset. Called from `frGateStart` and on resize; typeof-guarded so eval-sliced
  unit tests do not throw.
- Mona's 5 refinements, all applied: cursor:pointer; visible :focus-visible ring (WCAG AA); aria-label
  names the target ("Open Energy settings" / "Open Accessibility settings for Kosmos"); pointer-events
  :auto sized to the switch only (no accidental opens); hint only when not-granted.

## Tests / gates
- Full node suite must stay green (the fr functions are eval-sliced by node tests; new globals go
  beside siblings or stay typeof-guarded). Currently green: 5567/5567.
- web/index.html change -> browser-check gate (CI). Existing s3 browser-checks confirmed not
  false-red (.s3-win stays pointer-events:none; sub-text unchanged). ADD a #2620 browser-check for the
  new behavior (gray-when-not-granted, blue-when-granted, overlay covers switch + is focusable).
- Headed pass (claude-fe, routed to Renet + Mona): confirm overlay alignment across both mock heights
  and the swipe feel reads gentle. Challenge-loop before PR; beta = merge on green, squash, no reviewer.
