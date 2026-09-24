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
- `engine/connect.js`: `expiryMoved(owner)`, used ONLY at the pane-death gate (the capture-fail
  rescue), where `claude auth login` has exited so its writes are done. It is true when the
  credential's `refreshTokenExpiresAt` is later than a baseline read just before the launch. It
  reads through `loginexpiry.refreshExpiryFor`, which returns only the timestamp, from the entry
  the launch writes (`CLAUDE_CONFIG_DIR` = launchDir, or unset). **Fails closed:** a null baseline
  (no entry OR a failed read) disables it for the flow, so a failed read followed by a good one
  cannot make the old credential look new. macOS only; never the real keychain under
  `node --test` (`setRefreshExpiryReader` seam). The gate still also requires checkLive CONNECTED.
- `server.js`: the default sign-up start forwards `reauth` unconditionally; `reauthDecision`
  and the liveness probe gate are removed.
- `web/index.html`: the `st.liveVerified` short-circuit is removed (the server never sends it now).
- Tests (`engine/connect.test.js` "#3326"): moved expiry finishes CONNECTED (CCD set, and CCD unset
  as production launches it); unchanged expiry stays STUCK; a null baseline stays STUCK even when a
  later read succeeds. The reader's config dir is checked against the recorded launch argv.
  `server.test.js` pins the unconditional forward. `engine.reachable.test.js` excuses the seam.

## Rejected
- Keep #3367's gate: Josh ruled against it.
- Treat checkLive CONNECTED as success for a forced login: it reads the old credential, which is
  the #1937 false success.
- Compare the access-token expiry (`expiresAt`): it auto-refreshes hourly without a login.

## Weakest premise
A concurrent login elsewhere on the same keychain entry (the bare entry is shared by every
CCD-unset Claude process) during a forced sign-up whose own login did not land would read as
landed. The gate also requires checkLive CONNECTED, so the worst case is finishing on a credential
that works, which is what #3367 did deliberately.

That `claude auth login` over a working credential rewrites the same keychain entry with a later
`refreshTokenExpiresAt`. #3532's memory measured /login moving it about a month, but not
`auth login` on a still-valid credential. The real-Mac check (a live-credentialed sign-up
finishing connected) is the served proof, as #3367 also required.
