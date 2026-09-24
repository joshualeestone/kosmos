# Plan: #3326, sign-up always forces a fresh Claude login, without the 0.6.84 strand

## Ruling
Josh, 2026-09-24 14:38 CDT, #admin: "on #2, i want to force a fresh login everytime. I have
seen the other way fail multiple times which was why we switched to always force a fresh login."

## Finished looks like
Every default sign-up runs a real `claude auth login`, including for someone whose Claude login
already works, and that login finishes as connected when it lands, even if the brief "Login
successful" screen is missed. A forced login that did not land still goes stuck, never false-connected.

## Why the old always-force stranded people (read from connect.js)
For a still-working credential, the live check reads CONNECTED off the OLD credential from the first
tick, so CONNECTED proves nothing. `claude auth login` exits on success and closes the pane; if
"Login successful" fell between ticks, every completion gate (`!needsLogin || sawLoginDone`, plus
`deadCredential` on the pane-death path) was false, and the flow went to becomeStuck: the 0.6.84
strand. #3367 avoided it by not forcing when the probe said live. Josh has ruled that out.

## Change
- `engine/connect.js`: `loginLanded(owner)`, a single proof used by all four completion gates.
  It is true on the login-done screen, OR when the credential's `refreshTokenExpiresAt` has moved
  past a baseline read just before the launch (a real login moves it ~1 month). It reads through
  `loginexpiry.refreshExpiryFor`, which returns only the timestamp and never a token, from the
  entry the launch writes (`CLAUDE_CONFIG_DIR` = launchDir, or unset). Reads are throttled to
  one per 3 s, behind a `setRefreshExpiryReader` seam, and never touch the real keychain under `node --test`.
- `server.js`: the default sign-up start forwards `reauth` unconditionally; `reauthDecision`
  and the liveness probe gate are removed.
- `web/index.html`: the `st.liveVerified` short-circuit is removed (the server never sends it now).
- Tests: `engine/connect.test.js` adds a reauth-of-live whose pane closed, where a moved expiry
  finishes CONNECTED and an unchanged one stays STUCK, and both assert the reader was asked about
  the launch's config dir. `server.test.js` pins the unconditional forward and forbids the gate returning.

## Rejected
- Keep #3367's gate: Josh ruled against it.
- Treat checkLive CONNECTED as success for a forced login: it reads the old credential, which is
  the #1937 false success.
- Compare the access-token expiry (`expiresAt`): it auto-refreshes hourly without a login.

## Weakest premise
That `claude auth login` over a working credential rewrites the same keychain entry with a later
`refreshTokenExpiresAt`. #3532's memory measured /login moving it about a month, but not
`auth login` on a still-valid credential. The real-Mac check (a live-credentialed sign-up
finishing connected) is the served proof, as #3367 also required.
