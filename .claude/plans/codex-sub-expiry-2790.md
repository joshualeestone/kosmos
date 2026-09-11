# Plan: kosmos#2790 Phase 2 -- red a dead ChatGPT-subscription from the offline sub-validity window

## The problem (and why the on-pane approach fails)

#2790: a codex ChatGPT-subscription sign-in that is DEAD sits grey ("not checked live")
with no way to tell it from a working one. Phase 1 (#2413) greens a WORKING sub from an
observed rollout completion; the RED half is this card.

The on-pane approach my handoff assumed does not work: a dead chatgpt sub shows only an
AMBIGUOUS reconnect 401 (classifies WORKING, #249), never the definite auth-error line, and
codexauthprobe's checkLive returns UNKNOWN for an id_token (not a bearer key). Both signals
fail for the actual case. (Full analysis: comment on #2790.)

## The signal

The chatgpt `id_token` payload carries `https://api.openai.com/auth.chatgpt_subscription_active_until`
-- the subscription's own validity end, written and refreshed by OpenAI. A value in the PAST
is a lapsed subscription with no ambiguity. This is offline (the id_token is already decoded
for email at identityFromData), reliable, and cheap -- no probe (#1921/#1959 forbid a costly
probe on the badge path). NOT the token `exp`, which is short and refreshable.

## The change (engine/openaiaccounts.js)

- `chatgptSubscriptionActiveUntil(parsed)`: pure, offline. Decodes the id_token payload and
  returns `chatgpt_subscription_active_until` as epoch ms, or null on any doubt (not chatgpt,
  no/undecodable id_token, absent/empty/unparseable claim). Exported for a direct unit test.
- `checkLive`'s chatgpt branch: if the window is a valid PAST date -> STATE.NONE (the badge
  reds via the existing checkLive -> verdict -> 'signed_out' path). Everything else -- absent,
  unparseable, future -> STATE.UNKNOWN (grey), exactly as before.

## Safety (the load-bearing property)

A false red -- telling a working sub it is dead -- is the inverted #874 harm. So the red
fires ONLY on a valid, parseable, PAST window; every uncertain case fails open to grey. Tests
pin all four fail-open cases plus the red, and a negative control (neutralising the red) reds
the PAST test. 111 existing openaiaccounts/chatgpt tests still pass (existing fixtures carry no
window claim -> null -> UNKNOWN, unchanged).

## Interaction with Phase 1

verdict() checks a FRESH observed outcome before checkLive, so a lapsed sub only reds when it
has no fresh OK -- which it cannot have, since a lapsed sub cannot complete a real turn. A
stale OK ages out. No conflict.

## Open question (does not affect safety)

Whether a lapsed sub's id_token still refreshes (updating the window) or freezes with a past
value determines whether reading the current on-disk claim catches every lapse or only some.
Either way it never false-reds. Pin against a real lapsed sub at the release gate if available.

## Rejected

- On-pane AUTH_FAILED -> REJECTED (my handoff's framing): near-zero value for the chatgpt case
  (never reaches AUTH_FAILED); discarded.
- Token `exp`: short and refreshable, would false-red a live sign-in between refreshes.
- A network probe of the id_token: forbidden on the badge path (#1921/#1959) and impossible
  for an id_token anyway.
