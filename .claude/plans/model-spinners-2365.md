# model-spinners-2365: inline spinners on the Choose-a-Model loading states (0.6.40 #11)

Josh's 0.6.40 fresh-macOS re-test, item #11: "inject the existing inline spinners wherever
something is loading / being waited on, on the Choose-a-Model screen." Routed to Angel by
Splinter (Mona takes #9/#10); design call from Mona: use the app's existing `.kspin`
inline spinner, not a new one. Disjoint region from Mona (I am in the `fr-pane-5` connect
painter + `#fr-sub`; she is in `fr-pane-3` `.s3-step-cap` + `fr-pane-4` `.s4-gear`).

## Problem

On the Choose-a-Model screen, several system-working waiting states showed a title + text
with no motion, so a person watching read them as stalled: "Setting Claude up on this
computer... A moment or two." with nothing moving.

## Fix

Inject the existing `.kspin` breathing spinner (via `kGlyph()`) into the Choose-a-Model
SYSTEM-working loading/waiting states:
- `frPaintConnect` connect phases: `downloading` (beside the existing progress bar),
  `installing`, `signin-launching`, `signin-completing`.
- The OpenAI "Adding..." validate state (`#fr-openai-msg`, while the key is checked against
  api.openai.com).
- The initial connection check: `FR_GLYPH_LOCAL.checking` swapped from a static `…` to
  `kGlyph()`, so the `checking` row's mark box shows the breathing spinner. `checking` is
  only ever rendered via the first-run `allowLocal` path, so this is scoped to this screen.

Deliberately NOT on the USER-action waits, because a "working" spinner there would
misrepresent who the screen is waiting on:
- `signin-browser-open` ("Your browser has opened. Sign in to Claude there.") -- waiting on
  the person to sign in.
- `signin-awaiting-code` -- waiting on the person to paste a code.

`.kspin` already pins static under `prefers-reduced-motion` (no change needed). The spinner
is `aria-hidden` (decorative); the wait text carries the meaning.

## Verification

- `docs/browser-checks/render-model-spinners-2365.js`: drives the page's own painters and
  asserts a `.kspin` in each system-working state (4 connect phases + OpenAI Adding + the
  checking row), and asserts `signin-browser-open` (user-action wait) does NOT get one.
  Control: the pre-fix page renders none of these `.kspin` and reds (6 arms). Registered in
  tools/browser-checks.sh + README; reason-grep counts bumped 64->65, 39->40.
- Full node suite green. Challenge-loop converged.

## Follow-up

Reversible. Josh eyeballs it on his next fresh-macOS re-test (the connect states only appear
during a real connect). Whether the user-action waits should ALSO carry a spinner is his
call; a one-line add if so.
