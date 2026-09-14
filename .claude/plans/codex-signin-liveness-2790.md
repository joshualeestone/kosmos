# Plan: real liveness detection for a codex ChatGPT sign-in (kosmos#2790, the DETECTION half)

## Problem

`openaiaccounts.checkLive` returns UNKNOWN for every chatgpt-mode account, because a sign-in
hands an id_token (an identity claim), not a bearer key testable with GET /v1/models. So a DEAD
sign-in is indistinguishable from a healthy one: the agent sits Idle / "Not yet read" with no red
(the prod-user report - Dave's 5 codex agents). #2795 shipped only the warning COPY; a real red
needs real detection.

## Direction (Josh, via Splinter + Mona + Angel)

Make a dead/unusable Codex sign-in DETECTABLE via a real liveness signal so the driver + UI can
redden it. Splinter routed the DETECTION half to me; Ice Cream Kitty owns the consumers (re-login
driver, green badge #2413, tier surface) under #2338. Coordinate on the interface.

## Signal (measured on codex-cli 0.149.1, both arms)

`CODEX_HOME=<dir> codex doctor --json` runs codex's own health report, which includes a LIVE
WebSocket handshake to chatgpt.com/backend-api with the sign-in's credentials. Parse
`checks["network.websocket_reachability"].status`:
- "ok" (handshake "HTTP 101 Switching Protocols") -> LIVE. Measured on this box's working sign-in.
- not ok WHILE `checks["network.provider_reachability"].status` is "ok" -> DEAD (endpoint reachable,
  so the handshake was refused for the credential, not the network). Measured with a synthetic dead
  token: status "warning" + "handshake transport error".
- anything else (provider unreachable, doctor failed, no codex bin, unparseable) -> UNKNOWN.

Rejected `codex login status` / the doctor's `auth.credentials` check: both only file-read that
tokens EXIST ("Logged in using ChatGPT", exit 0) - the same false-green class `claude auth status`
produced in #1560/#874, warned about in the #1562 QA matrix.

## Change

- New `engine/codexsigninlive.js`: `classify(stdout)` (pure) + `liveness(dir)` (async, per-home TTL
  cache 30s + in-flight guard, injectable runner). NEVER returns 'dead' on a network fault (the
  #1930 never-false-red rule): 'dead' requires the endpoint reachable. Off-tick + cached (#1921).
- `openaiaccounts.checkLive` chatgpt branch: was blanket UNKNOWN; now awaits `liveness(dir)` and maps
  to the 3-outcome contract Ice Cream Kitty's #2338 consumers read verbatim:
    live    -> { state: CONNECTED, reauthRequired: false }
    dead    -> { state: NONE,      reauthRequired: true  }   ("sign in again")
    unknown -> { state: UNKNOWN,   reauthRequired: false }
  The never-signed-in case (no auth.json) is the existing absent return, now
  { state: NONE, reauthRequired: false } ("sign in") - distinct from dead by reauthRequired.
  A dead verdict (NONE) flows through codexauthprobe (NONE -> EXPIRED) and reddens the agent as
  auth_failed on the board - Josh's "clearly flag a truly dead one", Mona's "the agent must SAY it
  cannot run" instead of sitting Idle.

## Tests (`engine.codex-signin-live-2790.test.js`)

classify: live / dead / network-unknown / unparseable / provider-missing arms (real captured
doctor shapes). liveness: TTL cache, TTL expiry re-run, failed/throwing runner -> unknown,
concurrent callers share one run. checkLive integration: the 3 chatgpt outcomes + the absent
control, via an injected runner (no real spawn). Mutation-verified: removing the provider-reachable
gate reds the 3 never-false-red arms.

## Blast radius

Existing tests with chatgpt accounts either set a fake codex bin (empty output -> unknown, no
network) or stub the API; all affected files run fast and green. No behaviour change for apikey or
Claude accounts.

## Coordination

ICK builds the driver/badge/tier consumers against the contract above (sent verbatim). The tier
surface reads `chatgpt_plan_type` / `chatgpt_subscription_active_until` offline from the token's
`https://api.openai.com/auth` claim - her read, documented on #2790.
