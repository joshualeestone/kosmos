# #1704 slice 2b-ii (partial): POST /api/worlds/active -- the registry switch

## What "done" looks like
The board exposes `POST /api/worlds/active` that switches the active world in the registry
(`worlds.setActiveWorld`) and returns the now-active world plus `restartRequired: true`. The GET
route already existed; POST /api/worlds created worlds without switching. This adds the switch the
server comment (server.js) named as the missing piece.

## Scope decision (recommendation, implemented)
Slice 2b-ii as originally framed bundled three things: the switch endpoint, the board stop-and-relaunch
lifecycle, and per-world launchd agent isolation. This PR ships **only the registry switch endpoint**
and **explicitly defers the board-restart lifecycle + launchd isolation to a follow-up slice.**

**Why the split:**
- A world's env overrides (data / projects / workers roots) are applied ONCE at board startup
  (`worlds.applyActiveWorldEnv`), so a switch only takes full effect after a board restart. The
  endpoint reports this honestly with `restartRequired: true` rather than silently doing nothing.
- A board self-restart merged into the shared Kosmos is a **fleet-affecting action** (it would
  stop-and-relaunch the board other agents on this box rely on). Building and verifying that safely
  needs a non-shared environment, not a solo night-shift build on the shared box. This slice adds no
  self-restart code, so it carries no fleet risk and is fully unit-testable in the sandboxed harness.
- The endpoint is the API foundation the future switcher UI consumes; it is a real, mergeable
  increment on its own.

**Rejected:** (a) building the auto-restart now (fleet-risk on the shared box, and not safely
verifiable at night); (b) an endpoint that switches silently with no `restartRequired` signal
(misleading -- the running board keeps serving the old world). **Weakest premise:** that a switch
without an immediate restart is useful on its own. It is: it records the choice for the next board
start and gives the UI an honest signal; the auto-restart is a clean follow-up, not a correctness gap
in this endpoint.

## The change
- `server.js`: add `POST /api/worlds/active` -- parse `{ id }`; 400 for a missing id (malformed
  request); resolve the pre-override registry base via `worldBase()` (500 on a broken login env);
  `worlds.setActiveWorld(base, id)` (already existed); 404 when the id names no world (not-found,
  distinct from a malformed request); 500 on any other write failure; 200 `{ ok, world,
  restartRequired: true }` on success. Also updated the stale GET/POST comment that pointed forward to
  this route as "slice 2b's".
- `server.test.js`: switch to a created world returns 200 + `restartRequired` and GET reflects it (then
  restores default so later tests are unaffected); unknown id -> 404; missing id -> 400; a failed
  switch leaves the active world untouched.

## Verification
- `node --test --test-name-pattern='#1704' server.test.js`: 4/4 pass (sandboxed via
  AGENT_WORKFORCE_DATA -- no shared-board effect).
- Full suite + challenge-loop before PR.
- Deferred (follow-up slice, flagged): the board stop-and-relaunch lifecycle on switch and per-world
  launchd agent isolation. Live "the switch takes effect after a restart" verification rides that slice.
- No em dashes (house style).
