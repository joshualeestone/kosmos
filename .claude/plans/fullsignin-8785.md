# kosmos#8785: a full sign-in counts for as long as it lasts

## Ruling
Josh, 2026-11-19 20:49 CST (#admin): "A full sign in should basically hold forever." 20:50: "It's going to piss
people off if they have to sign in every day over and over." Step-up stays only for a session that was never a full
sign-in, or a new device.

## Change
- server.js `remoteSessionFresh`: a sign-in with the second factor and a well-formed time counts at any age. The
  one-minute bound ahead of this clock stays, so REMOTE_STEP_UP_CLOCK still tells a clock problem apart.
- REMOTE_STEP_UP_SECS removed (its only readers were remoteSessionFresh and one test).
- The three step-up sentences drop "fresh" and "within 10 minutes".

## Not changed, and why (numbers on the card, issuecomment-7028854188)
- Session lifetimes: the Kosmos+ session and the gate session are already 365 days with no idle timeout.
- The cloud box's hosted step keeps its 10-minute sign-in rule for a NEW browser (kosmos#8780): the ruling keeps
  step-up for a new device.

## Tests
server.remotestepup-6595.test.js: a 12-minute-and-one-second, a day-old and a 364-day-old full sign-in pass; red with
the old bound restored. server.stepupbutton-6616.test.js: the stale case is now a full sign-in whose time did not
arrive (an hour-old full sign-in no longer is one).

## Review round 2 decision: one route keeps a time bound
`POST /api/remote/second-reset` still needs a full sign-in from the last 12 minutes (REMOTE_RECENT_ONLY,
REMOTE_RECENT_SECS). From a stolen full session it would put the thief's own second factor on the account, which
outlives every other bound (a new sign-in with that factor passes Sign out everywhere): the identity change the
ruling's new-device exception keeps. Every other gated route takes a full sign-in of any age. Verified in the relay:
the gate requires the second factor by default (gate.rs require_second_from_env), and the iat header is the verified
token's own sign-in time (proxy.rs SESSION_IAT_HEADER), never refreshed.
