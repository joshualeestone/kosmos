# #7369: a signed-out Claude account holds and shows, on Windows and the Mac

**Posture:** production

## Problem
#5948 holds messages for a signed-out agent and says so, but chat.signinHeldVerdict returns null for runner 'claude'.
Why (plan signedout-5948.md, "Why not Claude"): the hold keys on a REPORTED auth_failed, and for Claude nothing ever
writes the clearing report, so after a sign-in the agent would stay held for a day. Result today:
- Mac: the card reads "Sign-in Issue" (screen-read AUTH_FAILED, status.js authFailed), but messages are still typed into
  the signed-out session and counted delivered.
- Windows: nothing at all. A Claude agent runs `claude -p` stream-json; a turn that fails on sign-in ends in a `result`
  event that win32streamstate reads as IDLE; classify never yields AUTH_FAILED; send answers ok once bytes flush. A user
  went 5 days with silent agents (#7366).

## Design
1. Windows detection (engine/win32streamstate.js, as its usage-limit parsing does): a `result` event that is an error
   whose text is a sign-in failure (the same phrases status.js authFailed matches: "Invalid API key", "OAuth token
   revoked", "OAuth access token has expired/been revoked/is invalid", "Please run /login", "Not logged in",
   authentication_error / 401) puts the pane in AUTH_FAILED (screen-read class, not reported), so the card shows
   "Sign-in Issue" as on the Mac. Any later successful turn, or a release (below), clears it.
2. Clearing, both platforms, the Mac's existing path: while a Claude card reads AUTH_FAILED, authprobe (`claude auth
   status`, cached 30 s per config dir, async, off the tick) is kicked; HEALTHY drops the auth state (reconcileReport,
   unless the 401 count grew). Windows gets the same kick and drop.
3. Hold: signinHeldVerdict also holds for runner 'claude' when the card reads AUTH_FAILED from the screen/stream class
   (not the never-cleared StopFailure report). Same words as #5948 ("held: it is signed out of Claude; Kosmos sends it
   once it is signed in again"), same #5805 queue, released when the card no longer reads AUTH_FAILED.
   No deadlock: the release does not need a turn, the probe does it.
4. Show: the card's existing "Sign-in Issue" label, now on Windows too; the held sentence where #5948 already shows it
   (room/DM delivery state).

## Not in this card
- The stall reason (PigeonPete, #7212 slice 3): after a 30-min stall, one live account check names the sign-in. This card
  makes the cause visible at once on the card for Claude; slice 3 can read the card's AUTH_FAILED instead of its own
  check where the card already says it.
- The one message consumed by the turn that discovered the sign-out (Windows) is not replayed.

## Tests
Per platform with controls: Windows stream (a sign-in error result -> AUTH_FAILED; a usage-limit result and a normal
result do not); Mac screen AUTH_FAILED Claude card -> held (control: idle Claude card not held; control: non-claude
behaviour unchanged); release when the probe reads HEALTHY (control: still held while it reads signed out).

## Review 1 (decided)
- Hold only when the agent's own account check POSITIVELY reads signed out (status.claudeSignedOutConfirmed: authprobe
  EXPIRED), never on the card label alone. Fixes: a stale HEALTHY being re-checked (UNCHECKED a few seconds every 30 s)
  no longer flaps a healthy agent into the hold; a Mac agent printing live 401s over a HEALTHY account is not held.
- Residual, as before #7369: `claude auth status` reads healthy while `claude -p` keeps refusing (a revoked token it
  still calls logged in). The card may read idle and messages go to a dead session. That is #7212 slice 3's live check
  (PigeonPete), not this card.

## Review 2 (decided)
- A Windows refusal the account check has read as stale stays cleared (status keeps it by the refusal's own `since`),
  so an idle card does not flicker back to "Sign-in Issue" each time the 30 s check is re-asked. Each refusal is now
  stamped with its own time, so a NEW refusal after a clear still shows.
- Declined: giving the underlying idle reading `liveToken`. #5949 withholds it from Windows Claude idle on purpose (that
  idle cannot prove no turn is running), and this reading follows the same rule as the plain Claude idle token.
- Kept: status.claudeSignInCheckable (tests assert the guard set through it; claudeSignedOutConfirmed shares it).

## Review 3 (decided)
- A Windows refusal is remembered as cleared only by a HEALTHY check that BEGAN after it (authprobe now records each
  check's start). A cached HEALTHY from before a new sign-out shows the plain state for at most one 30 s cache window
  (the false calm authprobe already accepts, #1930), never for good. Test keeps a fresh HEALTHY across a new refusal.
- Accepted: after a board restart a cleared record reads "Sign-in Issue" for a few seconds until the first check
  answers (no hold: a check in flight is not EXPIRED).
- Acceptable by design: signed out again with no new refusal reads idle until the next message is refused (that one
  message is lost, as before #7369); then the check shows and holds it.

## Review 4 (decided)
- An API-key account (#2420: key file in its folder) is not checkable: `claude auth status` reads it logged in
  whenever a key exists, revoked or not (measured), so a HEALTHY answer could only hide the key's refusal. Its card
  shows Sign-in Issue and nothing is held (as for no job, Qwen and vendor homes).
- Windows detection also reads the real stream's own markers (captured from the installed Claude Code): the refused
  assistant message's `error: "authentication_failed"` (per turn, reset when the next message is written) and the
  result's `api_error_status: 401`, so a new wording still reads signed out. The phrase list stays as a second net.
- The cleared memory is keyed by agent name and refusal time (two agents refused in the same millisecond stay apart).
