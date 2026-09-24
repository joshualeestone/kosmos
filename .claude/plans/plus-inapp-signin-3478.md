# Plan: wire the in-app Kosmos+ sign-in wizard (#3478)

## The bug
Kosmos+ sign-in kicks to the web instead of the in-app login flow. The two state-1
"Sign in" links (`plus-signin-top` / `plus-signin-bottom` in `web/index.html`) were
pinned to `href = KOSMOS_SITE + '/plus'` -- a deliberate #2625/#2626 stopgap "until
login.kosmosplus.com is live and branded" (so neither opened onto a 404).
login.kosmosplus.com is live now (200, post the Stripe/account cutover), and Josh's
ask is the IN-APP flow, not a web bounce.

## Key finding
The backend for the whole in-app account sign-in *with the second factor* was already
built server-side under #3149:
- `server.js` proxies `signin-start -> signin-verify -> signin-second -> signin-enrol
  -> signin-confirm-enrol -> signin-register`.
- `engine/remote.js` holds the 30-day session token + phone challenge engine-side
  (never returned to the page, #874) and drives a stage machine:
  `code_sent | session | second | enrol_second_factor | enrolment_started | registered`.

The ONLY missing piece was the CLIENT: `plus-state2` was dead markup (nothing revealed
it; `plus-signin-code` had zero handlers) and nothing anywhere called a `signin-*`
route. #1115 (Josh 2026-08-27) settled the product split: sign-UP happens on the site
(email+code+card); signing IN to that paid account happens in-app to give this computer
its address -- exactly `state2`'s purpose.

## The change (all in the worktree, off origin/main)
1. Re-route the two state-1 sign-in links to OPEN the in-app wizard (reveal state2)
   instead of the web. Handlers attach once at load, `preventDefault`, so no
   href/hostname lives in markup or JS (the no-hostname guard needs no pin).
2. Build the client stage-machine wizard in state2:
   email (`signin-start`) -> code (`signin-verify`) ->
   { phone code (`signin-second`) | set up a second factor: authenticator key or text
   (`signin-enrol` -> `signin-confirm-enrol`) } -> name this computer (`signin-register`)
   -> address issued. Reuses `PLUS_CODE_WORDS`, the rate-limit countdown, and the
   `.field`/`tk-inp`/`.btn` idiom. QR is deliberately not drawn (no QR lib loaded); the
   typed authenticator key works in every app.
3. `PLUS_SIGNIN_ACTIVE` keeps the wizard on screen across paintPlus's 5s repaint,
   `typeof`-guarded so `web.plus-tab.test.js`'s `new Function` harness (which defines
   only `PLUS_EPOCH`) does not ReferenceError.

## Guards
Kept green: no controls in state 1 (the wizard is in state 2), the "Sign-up is not open
yet" sentence, no hostname/price, paintPlus's enrolled/unenrolled shape, id-uniqueness.
Adjusted (documented in-place): `web.plus-signup.test.js`'s pane bounded to the state-1
sign-up region (state2 is now the sign-IN wizard, a different concern whose in-app
language is legitimate). Wired the new browser check into `tools/browser-checks.sh`
(#1387) so it runs.

## Verification
- Committed headless browser check `render-plus-signin-3478.js` drives all three
  `signin-verify` branches to a named, addressed computer against mocked routes and
  asserts the sign-in link no longer navigates away. All three pass headless.
- Full `node --test` + shell suite: green.

## Gates that remain (NOT auto-merge -- customer-facing, real money)
- Live end-to-end verification with a real Kosmos+ account + phone. Needs a browser +
  paid account; not doable from a headless bot session. This is the merge gate.
- Homer / Windows parity: the Windows client drives the SAME coordinator endpoints/
  stages (independent work, not a mutual block).
- Mona styling pass on the new screens.

## Decisions / rejected
- Reveal the wizard, NOT point the links at login.kosmosplus.com (Josh's #3478
  supersedes the #2625/#2626 "point to web" plan).
- Did NOT touch the state-1 "Sign-up is not open yet" sentence (launch-gating copy;
  Josh's call; independent of wiring sign-IN).
