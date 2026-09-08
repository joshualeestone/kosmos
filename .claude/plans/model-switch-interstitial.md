# Plan: model-switch restart interstitial (Josh 0.6.47 notes, screenshot 5.51.59)

## What finished looks like
When you switch an agent's model (Change & Restart), the confirm dialog shows a clean
interstitial -- the breathing Kosmos K over "Restarting the agent" -- held while the agent
restarts, then reduces to "Say hello to <agent> to reactivate them on <provider>." The
other change dialogs (account move, provider switch, compact, clear) are unchanged.

## Josh's ask
"An interstitial of the K animating for some amount of time (arbitrary, ~10s) saying
'Restarting the agent', then reduce the confirm text tremendously to 'Say hello to
<agent name> to reactivate them on <provider>.'"

## Changes (web/index.html)
- `changeDialog({..., busyHtml, minBusyMs})` -- both OPT-IN, default to the exact prior
  behaviour (plain "Working…", no hold), so the account-move / provider-switch / compact / clear callers
  are byte-unchanged. When `busyHtml` is set: it replaces "Working…" and the now-decided
  confirm button + small text are hidden for a clean interstitial (the title stays, both
  for context and as the dialog's aria-labelledby target). `minBusyMs` holds the
  interstitial on SUCCESS for at least that long (a fast POST still shows the restart);
  the hold is success-only and bounded, so a failure renders at once and the modal can
  never trap (#1313 -- every path still calls `say`, which is the one exit).
- The model click handler passes `RESTART_BUSY_HTML` (K + "Restarting the agent") and
  `RESTART_HOLD_MS` (10000, Josh's "arbitrary" ~10s; a named constant, read at click
  time so a hermetic browser-check can shorten it via `window.__kosmosRestartHoldMs`).
- `changeModelNow`: on a real restart (`outcome === 'changed'`) the dialog `say` is the
  reduced "Say hello to <agent> to reactivate them on <provider>." A partial (saved, still
  on the old model) or a failure keeps the engine's exact sentence; the section line
  behind the dialog also keeps it. Provider is unchanged by a model switch, so it names
  the agent's current one (OpenAI / Claude).

## Decisions / weakest premises
- The 10s hold is an artificial minimum (Josh's "arbitrary ~10s"). Named constant, one
  edit to tune. Weakest premise: a fixed 10s may feel long; if so it is a one-line change,
  and it could be made dynamic (until the restart actually completes) later.
- The interstitial keeps the title visible. A fully bare "Restarting the agent" screen
  is an option; kept the title for context + a11y. This is the visual latitude Mona may
  refine.
- The K asset (`/icons/kosmos-48.png`) is server-served, so it renders in the real app
  but not in a `file://` browser-check -- the check verifies the img markup + the text,
  not the pixels (the pixels are verified by a served screenshot).

## Tests
`docs/browser-checks/render-model-restart-interstitial.js` (indexed in README): drives the
real changeDialog + the real #d-model-go flow. Asserts the interstitial paints + is a
clean interstitial (button/small hidden, no modal exit), HOLDS on success then renders,
renders a FAILURE at once, leaves a no-busyHtml caller byte-unchanged (control), and the
model dialog shows the K "Restarting the agent" then the reduced text. Source control pins
the prod hold at 10000. chromium, 9/9.

## Verify
Screenshot (served K): clean interstitial (title + gold K + "Restarting the agent").
Full gate to run once the box is free.
