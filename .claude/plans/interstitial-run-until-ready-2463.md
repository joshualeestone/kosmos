# Interstitial follow-ups to #2463 (Mona's two-part spec)

Branch: `interstitial-run-until-ready-2463`. Repo: agent-workforce (kosmos). Owner: Angel.
Source: Mona's 2026-09-08 01:27 message (recorded in angel-2200.md handoff).

## Definition of done (what will be TRUE when finished)
1. The model-switch restart interstitial holds until the restart finishes (fetch resolves),
   with the fixed ~10s hold demoted to a ~2s FLOOR. A fast restart shows the breathing K for
   ~2s then reduces to "Say hello to <agent> to reactivate them on <provider>."
2. The provider-switch dialog shows the SAME interstitial: a breathing-K "Setting up OpenAI"
   (or "Setting up Anthropic") state while it works, then reduces to
   "Say hello to <agent> to reactivate them on <provider>." on a real restart.
3. The #1313 "modal can never get stuck" guarantee still holds on every path (a failure /
   partial renders at once, never held behind the K).
4. The web/ change trips the #1720 browser-check gate; the existing browser-check
   `render-model-restart-interstitial.js` is MODIFIED to (a) assert the new 2s floor and
   (b) drive + verify the provider interstitial. FULL run-tests.sh green.

## Edits (web/index.html, origin/main line numbers approx)
- **Part 1 (run-until-ready):** `RESTART_HOLD_MS = 10000` -> `2000` (~28053) + reframe its
  doc from "fixed ~10s" to "~2s floor; holds until the fetch resolves." changeDialog's hold
  logic is ALREADY a floor (`Math.max(0, minBusyMs - elapsed)`, say fires post-fetch), so no
  function-body change is needed - only the constant + docs.
- **Part 2a:** factor `RESTART_BUSY_HTML` into a `chgBusyHtml(line)` builder (~28054) so the
  provider switch can pass "Setting up <label>". App-derived text only, innerHTML stays safe.
- **Part 2b:** the `d-provider-go` changeDialog call (~27932) gains
  `busyHtml: chgBusyHtml('Setting up ' + label)` + `minBusyMs` (same __kosmosRestartHoldMs
  test seam). `label` already = toOpenai ? 'OpenAI' : 'Anthropic'.
- **Part 2c:** `changeProviderNow` success `tell(out.because || 'Switched.', true)` (~27836)
  -> reduced reactivate line on `out.outcome === 'changed'`, mirroring changeModelNow;
  `partial`/failure keep the engine words and render at once (ok=false). Section-line
  `msg.textContent = out.because` is unchanged, so the full sentence still stands behind.
- **Part 2d:** update the stale "the other FOUR callers ... are byte-unchanged" comment in
  changeDialog (~27136) to THREE (account move, compact, clear); provider switch now opts in.

## Guard updates
- `docs/browser-checks/render-model-restart-interstitial.js`: control `RESTART_HOLD_MS = 10000`
  -> `2000` (reframed as floor); correct the "four other callers unchanged" prose to three;
  ADD a provider-flow block (stub POST /provider, drive real #d-provider-go, assert
  "Setting up OpenAI" K interstitial then "reactivate them on OpenAI").
- Node guards unaffected: web.change-dialog.test.js + exit-1313 drive changeDialog WITHOUT
  busyHtml/minBusyMs (bypass the hold); openai-alldead + switch-account-1373 pin the refusal
  path / source regexes, not the success message. Verified by reading each.

## Verify
- `node --test web.change-dialog.test.js web.change-dialog-exit-1313.test.js web.openai-alldead-1561.test.js web.switch-account-1373.test.js`
- `NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-model-restart-interstitial.js`
- FULL `run-tests.sh` on the box (catches meta-tests: reason-grep EXPECTED_SITES etc.).
- /challenge-loop before PR.
