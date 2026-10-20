# remotemark-6595: the board knows a request came through Kosmos+ remote access

Card: kosmos#6595 (call 1: a session reached through Kosmos+ remote access can never allow another device).

## What changes
1. `server.js`: `cameThroughForwarder(headers)`, the ONE reading of "came through a forwarder": any of
   `x-forwarded-host`, `x-forwarded-for` or `Forwarded` PRESENT, even empty (an empty one must not read as
   local for `madeOnThisComputer`, which guards `/api/remote/open-ticket`). Node joins repeated copies into one
   string. The tunnel sets `x-forwarded-for` on every forwarded request and `x-forwarded-host` on all but a
   webhook, over any client value (per kosmos-relay crates/tunnel/src/proxy.rs (forward, forward_hook); not
   checked from this repo). `isRemoteRequest(req)` and `madeOnThisComputer` both use it; the latter's empty-header
   behaviour is UNCHANGED (main already used `!== undefined`), this branch only shares it.
2. 403, code `remote_not_allowed`, a sentence per route (exported `REMOTE_NOT_ALLOWED`), before anything else:
   `POST /api/remote/devices/allow` (Deny and Remove stay open remotely), `POST /api/remote/join/confirm`,
   `POST /api/agent-token`. The page already shows the `error` for Allow and join/confirm; agent-token has no
   page caller, so its sentence reaches only a direct API caller.

## Beyond call 1, on purpose (Renet's call; Splinter told; reversible)
- `agent-token` and `join/confirm` are refused remotely too. Call 1 names "allow another device"; these two let
  something in by other means: agent-token mints a credential another computer uses to post here, and confirm
  finishes letting this computer into the account (retry and recheck never do). Undo either by dropping its guard.

## Not covered
- The premise: the tunnel behaviour above, taken from kosmos-relay, not checked from this repo.
- A remote path that does not go through the tunnel and sets none of the headers reads as local; a local
  reverse proxy that sets one reads as remote, which errs toward restricting.
- A remote session can ask an agent here to make a request, which arrives without forwarding headers. The
  step-up for agent creation and key entry (same card) narrows that; the tunnel stays the allow list's only writer.
- Follow-up for kosmos-relay, not this branch: its docs/relay-request-auth.md still says the board ignores x-forwarded-*.

## Deliberately excluded (THIS computer's own state; signin-register read in engine/remote.js, rest from routes)
- `federation/invite`, `federation/own-code`: admit another Kosmos to a project room, not a device here.
- `remote/signin-register`: what it allows is this computer's own sign-in and the browser it opens itself, with a
  secret the remote side never sees.
- `remote/signin-start|verify|second`, `signin-enrol`, `signin-confirm-enrol`: this computer's own sign-in steps.
- `remote/setup-start`, `setup-complete`: this computer's own Kosmos+ enrolment.
- `remote/company/start|status|second-text|open|complete`: this computer's own company enrolment.
- `PUT /api/remote` (on/off), `remote/forget`, `second-reset`: its own switch, removal or second step.
- `remote/join/retry`, `join/recheck`: this computer's own join attempt, no allow; also screen-only (isViaScreen).

## Tests
`server.remotemark-6595.test.js`, real board, engine calls and token mint replaced: each route with each
forwarding header alone is refused with its own sentence and reaches nothing; CONTROL: without them it goes
through; Deny and Remove work remotely; helper and `madeOnThisComputer` agree, an empty header counting.
Mutation results (each guard and the presence rule removed, red, restored): the author's local run, not the tests.
