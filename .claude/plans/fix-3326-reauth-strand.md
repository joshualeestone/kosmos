# Plan: #3326 regression fix — stop force-reauthing a LIVE credential at sign-up

Branch: `fix-3326-reauth-strand` · The 0.6.85 launch gate (Josh's Anthropic-agent hold).

## Problem (the 0.6.84 regression)
#3326 (my card) made sign-up send `reauth:true` UNCONDITIONALLY, forcing a real `claude auth login`
on every start — even for a genuinely LIVE, signed-in user. A forced re-login the person is already
past strands them (and their spawned agent, which dead-ends at "choose a login method") when it does
not complete. Josh: both providers worked until 0.6.84; only Anthropic (account sign-in) broke,
OpenAI (API key) untouched. ICK's full-tree diff: the spawn/cred-resolution code is byte-identical
to working 0.6.83 — the only credential/login change in the release is #3326.

## Fix (server + client), per create.js's #1315/#1903 doctrine (force only on positively-dead, fail open)
1. **server.js** — new pure, exported `reauthDecision(reauth, fileConnected, live, STATE)`. The
   default sign-up start, when the FILE already claims connected (the shallow case #3326 targeted),
   runs the REAL liveness probe (`create.claudeAccountLive(undefined)`) and forces the login ONLY on
   `STATE.NONE` (positively dead). Live/unprobable → do NOT force (no strand) + mark `st.liveVerified`.
   The accountDir "Sign in again" repair is untouched (a deliberate user request keeps forcing).
2. **web/index.html** — `frConnectStart` accepts a `st.liveVerified` short-circuit as a completed
   login (`FR_SUB_LOGIN_VERIFIED = true`). Required because `frConnWatch` — the only other place that
   flag is set — does NOT run for a short-circuit (it only starts on an active phase), so a
   verified-live user would otherwise stick at "connected but not done".

## Why the decision is EXTRACTED
The regression (a live credential must not be force-re-logged-in) is behavioural; the old #3326
guard was source-level ("the default call forwards reauth") and could not see the over-forcing.
`reauthDecision` is pure + exported so server.test.js unit-tests the real decision (5 cases).

## Verify
- `reauthDecision` unit test (5 cases incl. file-connected+LIVE → no force + verified; +NONE → force).
- server.test.js 320/320, connect web 89/89, engine connect 75 + create 36 green.
- 🛑 REAL-MAC VERIFY (the 0.6.85 gate): auth carry cannot be fully unit-tested. A live-credentialed
  sign-up must be watched NOT force-re-logging-in, sign-up completing, and the spawned Claude agent
  talking. This is the same real-tester gate the whole 0.6.85 hold is about.

## Coordination
Posted to #3326 for ICK/Renet async review (ICK's claude-msg sends were truncating; she flagged
card comments as the reliable channel). ICK disproved spawn-env + handed #3326 to me; Splinter locked
it as mine.
