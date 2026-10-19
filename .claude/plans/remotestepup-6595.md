# remotestepup-6595: a remote session needs a fresh second-factor sign-in for keys, updates and new agents

Card: kosmos#6595 (security hardening R01a). Splinter's ruling 09:44 CDT 2026-10-19: remote sessions never Allow
another device (Renet's half, remotemark-6595, which this branch builds on); key entry, update and unsandboxed-agent
creation need a fresh authenticator code. This is the step-up half.

## What changes
- `server.js`: one gate, right after `remoteWriteGuard`, before any route reads its body.
  `remoteStepUpRefusal(req, pathname, now)` refuses 403 `{code: "remote_step_up", error}` when the route is gated,
  the request is remote (`isRemoteRequest`, Renet's) and the session is not fresh.
- Fresh = `x-kosmos-session-second` is exactly `1` AND `x-kosmos-session-iat` is a plain decimal within the last
  10 minutes (a minute of clock drift ahead allowed). The Kosmos+ gate writes both, over any client value, only for a
  sign-in session minted from a token after kosmos-relay sessioniat-6595; every other session sends neither.
  Missing or malformed is NOT fresh.
- Gated: updating and anything that downloads and runs software (`/api/update`, `/api/update/rollback`,
  `PUT /api/autoupdate`, `/api/connect/start`, `/api/antigravity/install`, `/api/muse/install`); a key, a token or a
  sign-in that leaves a credential here (`/api/accounts/openai`, `.../{claude,gemini,grok}/apikey`, `.../qwen`,
  `/api/cloudflare/token`, `/api/svc/<service>/token`, the OpenAI and Grok subscription starts, Antigravity and Muse
  sign-in, GitHub, GitHub device and Vercel starts); making an agent (`/api/agents`, `/api/team`,
  `/api/connect-agent`, `/api/worlds`, `/api/worlds/import`).

## Decided (reversible; each is one line in REMOTE_STEP_UP_EXACT)
- **"Unsandboxed agent" is every agent.** Every Kosmos agent runs with an unsandboxed shell; there is no sandboxed
  create option to exempt. So all three create routes are gated.
- **Installing counts as update.** `/api/connect/start`, Antigravity's and Muse's installs download and run a
  provider's software, the class the update route's own comment names (review iteration 1).
- **A sign-in counts as key entry.** It leaves a credential on this computer as surely as a pasted key does, so each
  sign-in START is gated; the steps after a start (a code, stop, agree) follow it and are not.
- **A whole new Kosmos counts as making agents.** `POST /api/worlds` can copy agents in and starts them at once, so
  the route is gated whole, not only when its body asks for imports (the gate runs before any body is read).
- **Taking things away is not gated:** forgetting a token, signing a provider out (DELETE), checking for an update.
- **A local request is never asked:** the person is at the computer.
- **The refusal says what to do** (sign out on the page, sign in again with the authenticator code, retry within
  10 minutes). The page shows the `error` it is given; no page change in this branch.

## The fresh sign-in must really be fresh (Renet, 12:54)
The gate's sign-in ends in a handoff that keeps the SOURCE sign-in site session's issue time. So signing out of
Kosmos+ on the page alone loops: the gate signs straight back in from the sign-in site's year-long session, with its
old time, and the board keeps refusing. The refusal therefore says to sign out on the page AND on the Kosmos+ sign-in
site, then sign in with the email code and authenticator code. Follow-up for kosmos-relay (owner PigeonPete, card by
2026-10-21): the gate asks the coordinator for a fresh handoff (refuse a source session older than the step-up),
so one sign-out is enough. Not tested end to end here: the gate and the coordinator are in kosmos-relay.

## Weakest premise
That the gate's two headers can only come from the gate. Per Renet, the tunnel drops client copies on every path and
writes them only after verifying a token session. If a remote path existed that did not go through the tunnel and
set none of the forwarding headers, it would read as local and never be asked (Renet's stated limit, same here).

## Not covered
- A sign-in session stored before sessioniat-6595 sends no headers, so those people are asked once and their next
  sign-in carries both (Renet's contract). Until the tunnel change is deployed, EVERY remote key, update and new
  agent is refused. Deploy order: tunnel first, then this board change.
- A remote session can still ask an agent here to do these things; an agent's own request arrives without
  forwarding headers. Renet's plan names the same residual.

## Tests
`server.remotestepup-6595.test.js` (32), including a guard that every POST/PUT route whose path looks like a key,
token, sign-in, install, update or create is gated or exempt with a written reason, and every gated route exists
(dropping one gated route turns it red, naming the route): every gated route refused remotely without headers, with second=0, with a
stale time and with a malformed time, reaching nothing (the gate runs before the body is read); CONTROL: a fresh
remote session and a local request pass on key routes (which then answer 400 for an unreadable body); update and
agent creation pass arms tested on the function only, never run; the window's edges and malformed values.
Mutations, run by hand: gate removed 13 red; freshness always true 15 red.
