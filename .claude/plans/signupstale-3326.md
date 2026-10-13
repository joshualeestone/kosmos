# #3326: does sign-up still accept a stale Claude "Connected"? Measured on 0.7.44: no. Pin it.

**Branch:** `signupstale-3326` · **Card:** kosmos#3326 · Routed by Splinter, 2026-10-13 04:08 CDT.

## Done looks like

The question "on 0.7.44, does sign-up accept a stale Connected without a live check?" has an
answer measured on the shipped code, and the card's own case (a credential the local file calls
connected but that is expired or cannot be verified) is held by tests that fail when either half
of the behaviour is removed. needs-browser stays only for the real-Mac sign-up walk.

## What I measured

Staging 0.7.44 (`dist/latest-staging.json`, tarball sha256 `eec99bb0...`, hash matches the pointer).
The tests below were run on a scratch tree with the SHIPPED `server.js`, `engine/` and `web/`
overlaid (byte-compared after the copy), with
`node --test --test-name-pattern='3326|1585|2645' server.connect.test.js web.firstrun-model.test.js`:
all 10 matching tests pass (the #3326, #1585 and #2645 arms in both files).

Three layers, each read in code:
1. **Page.** `frConnectStartConfirmed` posts `{ installConfirmed, reauth: true }` on every sign-up
   start, and `frPaintSubscription` paints the green "Connected" only once `FR_SUB_LOGIN_VERIFIED`
   is set, which happens only when the watch sees a login it ran finish.
2. **Route.** The default `/api/connect/start` forwards `reauth` to `connect.start` (the probe gate,
   #3367, was removed by PR #3646).
3. **Engine.** `connect.start` skips the already-connected short-circuit when `reauth` is set and
   launches `claude auth login --claudeai`; every finish needs login evidence (login-done screen,
   a dead-to-live transition, or the refresh expiry moving).

## The gap, and the change

Existing tests covered reauth over a LIVE credential and a dead credential WITHOUT reauth. Nothing
drove the card's case through sign-up, and nothing pinned what the page sends. Added:
- `server.connect.test.js`: sign-up with reauth over an EXPIRED and an UNVERIFIABLE credential
  answers something other than connected on the first response and launches `claude auth login
  --claudeai`. Those two are what the tests pin; how the flow ends after the launch is not asserted
  here (it takes several engine ticks, and the engine tests in `engine/connect.test.js` cover
  the finish gates).
- `web.firstrun-model.test.js`: the sign-up start body, evaluated (not matched), carries
  `reauth: true` for both install-confirm values.

Tests only. No product code changes.

## Shown failing

- Route stops forwarding reauth: the UNVERIFIABLE arm and the existing LIVE arm fail.
  The EXPIRED arm still passes, because #2645's dead-credential path forces a login on its own.
  That is a second defence, not a weak test; the UNVERIFIABLE arm is the one that discriminates.
- Page drops `reauth: true`: the new web test fails.

## Weakest premise

That `claude auth status` reports a six-month-old credential as either signed out or unreachable.
If it reports it as logged in (it may read local state only), that is the LIVE case, which the
forced login also covers. So the conclusion holds for all three live answers; what is not measured
is the real CLI's answer on a really stale credential, which only the real-Mac walk can show.

## Rejected

- A product change. Nothing is live to fix on 0.7.44.
- Closing the card. Its done line is the three real-Mac cases, which no code test can stand in for.
