# allowpoll-4640: a second computer moves on by itself once the other computer allows it

Card: #4640 (follow-up to #4638). Owner: renettilley. Stacked on secondmac-4638 (PigeonPete) until it merges.
Needs kosmos-relay signinstatus-4640 (`signin status` tunnel verb) for the live path; without it the page keeps
today's behaviour (the code and a Done button).

## Change
- engine/remote.js: absorbSession marks a second computer (`second` = the answer named another computer's
  address). signinRegister keeps the session token after a successful register ONLY then, as
  allowWatch = { token, until: now + 15 min }. signinAllowStatus() runs `signin status` with the token on stdin,
  returns { device_status } in pending/acked/denied, clears the watch on acked/denied, and returns
  { stop: true } when there is nothing to wait for or the tunnel predates the verb (clap's "unrecognized
  subcommand"). A down coordinator is { stop: false }: ask again. Dropped by signinCancel, signinStart, forget,
  resetForTests.
- server.js: GET /api/remote/signin-allowed -> { ok, device_status } or { ok: false, stop }.
- web/index.html: plusSiSecondDone starts a 4 s poll (plusSiWatchAllow). acked: "Allowed. <computer> is in.",
  then after 1.5 s the Done button's own handler. denied: "Your other computer said no to letting this one in.",
  stop asking. plusSiClear and Done stop the poll.

## Decisions
- Reuse the register session (the coordinator answers it after register; pinned in kosmos-relay
  coordinator/tests/api.rs kosmos4640_register_keeps_the_session_and_it_sees_the_allow). Rejected: a new poll
  token (coordinator change); polling from the page (the token must never reach it).
- Keep the token only on a second computer and only 15 minutes: a first computer has nobody to wait for, and the
  default rule is that a spent token does not linger.
- Extend Pete's browser check rather than a new file (a new file needs four hand-maintained wiring guards, and his
  branch lands first).

## Weakest premise
The old-tunnel stop matches clap's wording. If it differs, an old connector is asked every 4 s for 15 minutes and
fails harmlessly; Done still works.

## Validation
- node --test engine/remote.test.js (118/118); #4640 tests x4; server.test.js in-app sign-in route test.
- docs/browser-checks/render-plus-second-computer-4638.js: 20/20.
- Controls: keeping the token on a first computer reds the engine control; removing the page poll reds all five
  #4640 browser arms.
- Not measured: a real two-computer run.
