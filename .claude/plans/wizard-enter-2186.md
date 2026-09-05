# Plan: Install steps — Enter/Return triggers Continue when the step is valid (kosmos#2186)

## Problem
In the first-run / install wizard, pressing Enter/Return after filling a step's
fields does not activate Continue. The user has to click Continue on every step.
Reported by Josh during the 0.6.30 fresh-install test.

## Goal
On each wizard step, when the step is valid (Continue enabled), Enter/Return
submits the step — the exact equivalent of clicking Continue. When invalid it
does nothing harmful; it never submits from a multi-line field; and it never
double-submits.

## Approach
The wizard (`#firstrun` in `web/index.html`) drives every step through one shared
primary button `#fr-next`, whose action `frActions` rebinds per step. So a single
wizard-wide keydown handler on the container, acting on whatever `#fr-next`
currently is, covers every step without knowing which step it is on.

Add a named `frEnterSubmit(e)` handler attached once to `#firstrun`:
- Fire only on Enter, not `e.repeat` (held-Enter), not mid-IME (`isComposing` /
  keyCode 229).
- Skip when focus is in a field/element with its own Enter semantics or native
  behaviour: `TEXTAREA`, contentEditable, `BUTTON`/`A`/`SELECT` (native
  activation), and `INPUT[type=search]` (a live-filter field, not fill-and-continue).
- No-op unless the wizard is open and `#fr-next` is shown AND enabled (mirror its
  `hidden`/`disabled`/`aria-disabled` state — this is the "step is valid" test).
- Otherwise `preventDefault()` and `#fr-next.click()`.

Fields with their own Enter gesture (`#fr-openai-key`, `#fr-conn-code`)
`stopPropagation` so they never also trip the shared Continue.

Named (not an inline lambda) so a unit test can lift and run the real handler.

## Scope
Wizard-wide keyboard-submit handler only. No behavioural change to any step's
Continue action, validation, or copy. `agent-workforce/web/index.html` plus tests.

## Verification
- `web.firstrun-enter-2186.test.js`: lifts and runs the real `frEnterSubmit`
  against stub events (valid, disabled, hidden, aria-disabled, wizard-closed,
  textarea, contentEditable, search, text-positive, button, link, select, held,
  IME, non-Enter), plus a CONTROL asserting the lift and the `#firstrun` wiring.
- `docs/browser-checks/render-firstrun-enter-2186.js`: real keydown in a headless
  browser on the gated About-you step (empty => no advance; filled => real
  `PUT /api/you` + advance); perturbation-verified to red without the handler.
  Wired into `tools/browser-checks.sh` + README.

## Out of scope / not done
- No change to which fields gate Continue, or to any step's validation.
- No new wizard steps or copy.

## Decisions
- Carve out `type=search` specifically (not a blanket INPUT skip): the About-you
  text inputs must still advance on Enter, but the found-agents search box must
  not eject the user via `frFinish`. (Surfaced by the challenge loop.)
- `frEnterSubmit` uses `preventDefault` without `stopPropagation` deliberately —
  every document-level keydown handler guards on Escape/Tab, so nothing
  double-acts; documented inline for the future.
