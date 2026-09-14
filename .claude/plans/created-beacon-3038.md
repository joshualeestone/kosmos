# created-beacon-3038 - restore the install/agent-created beacon (#3038)

## Why
Homepage install + agent counts on installkosmos.com are FROZEN (32/79). Root: the Kosmos
app never POSTs `/api/created`, so no `installs/` blob is ever written. #2623 removed the
create-agent beacon; Josh RULED (#3038, via Splinter 2026-09-14) that removal was an agent's,
not his - he "always wanted" the beacon. This restores it. "I don't care about privacy";
default-on, hardcoded checkbox, no new Settings toggle.

## Model (3 signals leave the machine)
1. **Install ping** - UNCONDITIONAL, on board start, `count: 0`. Moves the INSTALL count.
   Carries no agent info (respects the checkbox's meaning: agent count is the gated thing).
2. **Agent-created ping** - on agent create, gated on the create-agent checkbox (default
   CHECKED, hardcoded). `count: <live agent count>`. Moves the AGENT count.
3. **Daily report** - already built (feedbacksend.js); ensure the install-time consent left on
   at Continue activates the send (no wording change). #2295 transmit leg. (Verify only.)

## Server contract change (chaoskosmos-site/api/created.js) - REQUIRED
Change `const next = had + 1;` to `const next = Math.max(had, cleanCount(body.count));`
(cleanCount = non-negative int, default 0, capped). WHY: `had+1` increments on EVERY POST, so an
idempotent install ping firing on every board start would inflate the agent count per launch, and
a created ping's live count would be ignored. Math.max makes it idempotent (repeated pings never
inflate) and lets ONE created ping after an upgrade sync an install's full pre-existing count.

## App wiring (agent-workforce)
- `engine/createdbeacon.js` (NEW): the transmit seam, mirrors feedbacksend.js discipline
  (fire-and-forget, 5s AbortController, underTest guard, setSender test seam). `pingInstall()`
  (count 0), `pingAgentCreated(count?)` (live roster count via status.paneRoster). payload =
  `{ installId, count, version, os }`.
- Install ping: fire `createdbeacon.pingInstall()` once on board start (server.js, near the
  feedback sweep setup) - unconditional, best-effort.
- Created ping: fire `createdbeacon.pingAgentCreated(count)` in the create ROUTE (server.js
  ~4386, on `result.outcome === create.OUTCOME.CREATED`) when the request's checkbox field is on
  (default on: fire unless explicitly `notifyCreated === false`).
- Web (create-agent page): RESTORE the "Let Kosmos know an agent was created" checkbox - checkbox
  LEFT, Create Agent button RIGHT, default CHECKED, hardcoded (Josh: "hardcode it so everybody
  knows. Don't take this out."). Submit the value in the create request.

## privacy.html (chaoskosmos-site)
The shipped privacy.html "What Kosmos sends us" section ALREADY discloses the install signal
(install-exists, version, OS, agent count, random installId). Confirm it reads plainly; minor
tweak only if needed. Not a blocker.

## Sequencing (cross-repo)
The server Math.max change must be LIVE (Baron publishes chaoskosmos-site) before the app pings
are safe - under old `had+1` the install ping inflates per launch. So: ship the site PR first,
verify /api/created is idempotent, THEN merge the app PR. Flag the ordering to Splinter/Baron.

## Tests
- Node test for createdbeacon: setSender captures the POST; assert payload keys `{installId,
  count, version, os}` (pin the contract); pingInstall sends count 0; pingAgentCreated sends the
  roster count; underTest guard blocks a real send but not an injected sender.
- Route-wiring assertion (source-level): the create route fires pingAgentCreated on OUTCOME.CREATED
  gated on the checkbox; board start fires pingInstall.
- Web test: the checkbox exists, default checked, and its value flows into the create request.

## Targets build: 0.6.64+ (post-cut). This is Josh's #1-frustration regression.
