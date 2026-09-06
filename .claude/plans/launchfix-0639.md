# Plan: launch-gating fix (Josh 0.6.39 #3) — Connect Claude button was dead

## Goal

Fix Josh's 0.6.39 test item #3 ("one of the biggest"): the first-run "Connect
Claude" button is tappable but unresponsive, blocking the model-connect step.

## Root cause (measured)

`#fr-llm-connect` lives in `#fr-pane-5` (web/index.html:8030), but its click
handler was event-DELEGATED on `#fr-pane-3` (`getElementById('fr-pane-3')
.addEventListener('click', e => e.target.closest('#fr-llm-connect') ...)`). A click
on a pane-5 button never bubbles to a pane-3 listener, so `frConnectStart` was
never invoked. The delegation target went stale when the wizard grew screens and
the connect step moved to pane-5; nothing caught it because the node unit suite
never mounts the page and no browser check clicked the button.

## Fix

Bind a DIRECT listener on `#fr-llm-connect` (an IIFE, null-guarded, at parse time
when the static button is already in the DOM), matching the sibling
`#fr-openai-connect` which already uses a direct listener. `e.currentTarget` is
the button for both direct and child-`<span>` clicks, so the "grew a check" span
still fires the flow. All prior behavior preserved: close-on-second-press, the
one-press disabled guard, `frConnectStart({opener})`.

Removing the fragility (pane-coupling) is deliberate — a direct listener cannot be
broken by a future pane renumber, which is exactly what caused this bug.

## Guard

`docs/browser-checks/render-firstrun-connect-fires.js` (hermetic Playwright,
file://, no server): stubs `window.frConnectStart`, dispatches a real click, and
asserts `before=0/after=1`. Proven non-vacuous — REDS on the old delegated code
(`after=0`), greens on the fix, chromium + webkit. Registered in
tools/browser-checks.sh with its README row.

## Scope

This branch is ONLY #3. The other 0.6.39 launch items are separate:
- #1 (native permission trigger + tmux injection) — separate branch; the native
  app (native-app/main.swift) gets on-demand prompt endpoints + the #2189
  tmux-surfacing diagnosis.
- #7 (OpenAI blocked) — downstream of #1 (both connect buttons live on step 5,
  unreachable while the S3 tmux/Accessibility gate reads trusted:false); no
  separate fix, verifies once #1 lands.
The sub-vs-API-key picker (Pete's #2338) rides on top of the connect flow after
#3/#7 are solid.

## Verification

The new browser check is green (4/4, both engines); sibling first-run checks
(render-firstrun-connect-box-2187 10/10, render-firstrun-enter-2186,
render-firstrun-openai-connectbox-2241) still green — the isolated listener change
did not regress neighboring coverage. Pre-PR challenge loop: 2 iterations,
converged (see the pre-challenge proof).
