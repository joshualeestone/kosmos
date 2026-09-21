# Sign-up connect frontend group: #3326 + #3335

Owner: Angel. Two grouped 0.6.83/onboarding connect-frontend cards (shared first-run connect flow),
per Splinter's routing. Built after the weekly-limit reset (Sep 21). Off current main (de3d1ad5).

## #3326 - sign-up ALWAYS forces a real Claude login (Josh's decision: option 2)
Bug: Josh installed Kosmos with his neighbor (Mac Mini); sign-up showed green "Connected" for a
Claude login unused ~6 months; agent creation then failed (expired). Root cause: sign-up's "Connected"
is checkLive PRESENCE (a credential exists), never a live-validity probe; only agent-creation runs the
real probe (create.claudeAccountLive). Josh: "what's it cost us - force it."

Frontend wiring (the reauth:true engine path already exists, #1937/#2645 - stays ICK's):
1. frConnectStartConfirmed: POST /api/connect/start now sends `reauth: true`, so connect.start()
   skips the CONNECTED short-circuit (connect.js `&& !reauth`) and runs a real `claude auth login`
   with login-success evidence, every time.
2. frPaintSubscription: the terminal green "Connected" (button + verdict row + skip-ahead Next) now
   requires a new session flag FR_SUB_LOGIN_VERIFIED (set in frConnSettle - reached only after a real
   forced-login connect completes), not the shallow checkLive `connected`. A shallow/unverified
   connected falls through to the verdict-free default arm (respects #1008: no Claude verdict shown
   when unverified), where the Claude Connect button runs the forced login. Sign-up can no longer
   finish on a "Connected" a later agent-creation probe rejects.

## #3335 - OpenAI sign-in: relabel, drop the explainer, open immediately (first-run only)
Josh's 0.6.83 sign-up feedback:
- "Sign in with ChatGPT" -> "Sign in with Subscription" (fr-openai-pick-sub).
- Deleted the "A ChatGPT subscription signs in through OpenAI..." explainer.
- Clicking it now opens the OpenAI sign-in IMMEDIATELY (no intermediate "press Sign in again" screen):
  extracted frOpenaiSubStart(); frOpenaiChoose('sub') hides the redundant sub-go button + calls it
  right away; the sub-step stays only for its live status (browser opening / device code / cancel);
  focus moves there; a start error re-shows the manual button for a retry. Settings keeps its own
  copy (per the #2338 precedent - Josh ruled on first-run).

## Tests/checks updated (all consequences of the #3326 verified-gate + the #3335 flow change)
- web.firstrun-model.test.js: inject FR_SUB_LOGIN_VERIFIED into the frPaintSubscription slice; assert
  the green Connected requires a verified login and a shallow connected reads as an action.
- server.test.js: firstRunHarness prelude declares FR_SUB_LOGIN_VERIFIED (default false, overridable);
  the "no subscription state renders a verdict" control drives the VERIFIED-connected case.
- docs/browser-checks/render-firstrun-connect-box-2187.js: the CONNECTED arm sets FR_SUB_LOGIN_VERIFIED
  = true before painting (10/10 green).
- docs/browser-checks/render-firstrun-openai-sub-2621.js: reworked to the immediate-open flow (stub
  before the single pick-sub click; assert start fires from that click + sub-go hidden). Green.
- Browser-check surface gate: render-firstrun-connect-box-2187 updated; render-chatgpt-signin-no-name-2913
  carries a Browser-check-surface trailer (the fr-openai-sub-go hide does not change what it asserts -
  it checks the button exists + no name field, not visibility). Gate green.

## Verification
- Node suite (run-tests.sh) + full browser-checks.sh (both re-run after the fixes).
- render-firstrun-openai-sub-2621, render-firstrun-connect-box-2187, render-chatgpt-signin-no-name-2913
  all verified green via pw-runtime.
- The real forced Claude login + the real OpenAI browser sign-in cannot fully run headless (they open a
  browser / run `claude auth login`), so Josh confirms both end-to-end in-app after the next cut.

## Weakest premise
That reauth:true is honored by /api/connect/start's start() in the first-run path (not only the Settings
"Sign in again" route). Verified in source: server.js:9045 reads reauth from the body and passes it to
connect.start(); connect.js:1475 gates the connected short-circuit on `&& !reauth`; connect.js:1857 runs
the real login for reauth. #1937 (the Settings-reconnect engine bug) stays ICK's, out of scope.
