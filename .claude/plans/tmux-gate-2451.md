# Plan: S3 tmux-gate fix - gate on Kosmos.app, relabel tmux -> Kosmos (#2451)

## Problem (measured, and Josh's symptom)

Josh, 0.6.47 re-test (#2451): on the first-run Automation screen (S3) the tmux row
was "stuck in the state that said 'Checking,' but the Next button was already
activated [enabled]... it should say that it needs access." And he asked whether the
macOS prompt should name Terminal/tmux or Kosmos.

Root cause, confirmed on current main (06176b68):
- The web S3 gate is ALREADY correct + tested: FR_GATES maps data-gate="tmux" ->
  `/api/a11y-status`, grants only on `checkable:true && trusted:true`, blocks on
  `checkable:true && trusted:false`, FAIL-SAFE (enables, never false-green) on
  `checkable:false`. render-gated-next.js covers all arms (it mocks the route, so it
  is agnostic to which engine fn the route calls).
- The bug is purely the ROUTE wiring. `server.js` `/api/a11y-status` serves
  `a11ystatus.tmuxGrant()` (tmux's OWN path-keyed TCC row, #2085). On Josh's box
  tmux is absent / path-key-mismatched, so tmuxGrant returns `checkable:false`
  forever -> the pill sticks on "Checking..." AND the gate treats uncheckable as
  fail-safe -> Next stays ENABLED. That is exactly his symptom.

## Why Kosmos.app is the right subject (Kitty's #2125 resolution, relayed 2026-09-09)

Accessibility is keyed on the CALLING BINARY. The onboarding "Turn On" registers
Kosmos.app (Josh sees "Kosmos" in the Accessibility list). tmux disclaims
responsibility for its children and can never hold the grant the onboarding
registers. `engine/a11ystatus.js read()` ALREADY returns Kosmos.app's own
AXIsProcessTrusted verdict (the native app writes a11y-status.json on launch + every
60s, inside the 5-min staleness window, per promptrequest.js:50 + main.swift:1123). So
`read()` is the correct subject; `tmuxGrant()` answers about the wrong one.

The #2085 comment called read()'s app-trust a "false TMUX ACTIVATED" pill, but that was
under the now-disproven belief that tmux must hold the grant. Under Kitty's ruling the
app being trusted IS the real, correct signal.

## Fix (minimal, reversible, safe ahead of the #2125 KEEP/DROP fork)

1. `server.js` `/api/a11y-status`: `a11ystatus.tmuxGrant()` -> `a11ystatus.read()`,
   rewrite the route comment to the corrected identity model. Same {checkable,
   trusted} shape, so the web gate + render-gated-next consume it unchanged.
2. Relabel the user-visible S3 strings tmux -> Kosmos: the gate row label ("TMUX" ->
   "Kosmos"), the mock Accessibility window row ("tmux" -> "Kosmos"), and the step
   caption ("switch TMUX to On" -> "switch Kosmos to On").

## Decisions

- **Keep the internal `data-gate="tmux"` key.** It is invisible to the user and is the
  selector for FR_GATES, the Turn On handler, render-gated-next.js and the node tests.
  Renaming ripples across all of those for zero user-visible benefit and risks a missed
  reference silently breaking the Turn On button. A clarifying comment records that the
  key is historical and the subject is Kosmos.app. Rejected: renaming to "a11y".
- **Leave `tmuxGrant()` in the engine** (exported + tested). It is a valid library
  function; #2125-KEEP may re-wire a grant through a tmux identity. Not called by the
  route any more; not dead engine code.
- **Leave the Settings-side "If you see a box asking about tmux" help box** (#2236
  territory, a safety net for the edge where macOS does name a tmux binary). Out of
  scope; the grant-necessity question (#2125 KEEP/DROP, and whether Kosmos.app's grant
  reaches the agent runtime) is Josh's/Kitty's, and Kitty confirmed it does NOT block
  this fix.

## Safe under both forks (Kitty)
- KEEP: gating on Kosmos.app is correct.
- DROP: the accessibility ask is removed entirely -> this gate is moot, but not wrong.

## Verification
- `render-gated-next.js` (existing): add an assertion that the a11y gate row label +
  mock read "Kosmos" and NOT "tmux" (net browser-check change -> satisfies #1720).
- `web.firstrun-a11y-1214.test.js`: add a guard that the `/api/a11y-status` route
  serves `a11ystatus.read()` (the Kosmos.app subject), not `tmuxGrant()`.
- Full run-tests.sh + render-gated-next.js headless.
- Weakest premise: that the native app keeps a11y-status.json fresh during S3 on a
  native install. If it does NOT, read() -> checkable:false -> fail-safe enabled =
  today's symptom, i.e. STRICTLY NO WORSE than the tmuxGrant status quo (which is
  always uncheckable). Mitigated: the app refreshes on launch + every 60s (measured in
  promptrequest.js / main.swift).
