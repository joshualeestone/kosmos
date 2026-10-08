# teamping-5590: a team create tells installkosmos.com the agent count moved (kosmos#5590)

## Josh's question (06:50) and what was true
"When someone creates a team of agents do we get one single ping that an agent was created or like the actual number"
- POST /api/agents (the single create) sends the created ping with the install's total ever created (#3038).
- POST /api/team (the org-chart import, and agents building a team) sent NOTHING, so its members never reached the
  homepage count unless that install later made one agent the single way.
- Corrected premise: the page's seeded team sheet (Create a team) builds each member through POST /api/agents, so
  those members already pinged one at a time. The gap was POST /api/team only.

## Change
- server.js, POST /api/team: after the create (both the agent-caller branch under the creator lock and the operator
  branch, and after the liveness merge), ONE createdbeacon.pingAgentCreated(create.createdCount()) when at least one
  member was created and the request did not say notifyCreated:false. The count is the total ever created, which
  already includes every member just born; the site keeps the max, so a re-sent count never inflates it.
- Early refusals (all members dead, the per-creator cap, shape errors) return before this point or create nobody.

## Tests (server.teamping-5590.test.js), each planted red
- a team of three: exactly one ping, count = the total before + 3 = createdCount().
- a partial team (one dead member): one ping.
- CONTROL: a refused team (all dead; missing purpose): no ping.
- notifyCreated:false: the team is made, no ping.
Plants: the ping removed (tests 1 and 2 red); the box ignored (test 4 red).
Neighbours green: createdbeacon-3038 (unit and route), no-phone-home-4253, browser-checks-quiet-4253, team routes
(1279), guidestate-4350: 78/78.

## Decided
- One ping per team, not per member (the card; the total is what the site records).
- The org-chart import sends no notifyCreated, so it pings (#3038's default ON); its sheet has no box today.

## Review 1 (opus)
- Fixed (WARNING): the org-chart import ignored the create-agent box, which the create sheet shares across every
  create (the defect "Review 25" fixed for the seeded team). The import now sends notifyCreated from #create-tell
  (default true). Browser check render-orgchart-import-1280 asserts both arms (ticked: true; unticked: false) and
  declares create-tell in its surface. Retracted from the plan: "its sheet has no box today" was wrong.
- Fixed (WARNING): a test for an AGENT building a team (the creator-lock branch: one ping) and the per-creator cap
  refusal (no ping). Planted red: the ping limited to operator callers.
- Fixed (NIT): the capture keeps count > 0 only (an install ping carries 0), true by construction; the server comment
  says the #3038 block is IN POST /api/agents.
- Stated: the CLI's `kosmos agent create` already pings by #3038's default, unchanged here.

## Review 2 (sonnet): no blockers
- Stated, deliberate (WARNING): the CLI's `kosmos agent create` posts a one-member team, so it now pings, as the single
  create already does for CLI and agent callers (#3038's default ON). A CLI create is a real agent created, which is
  what the homepage counts. No CLI opt-out is added here; weakest premise: that nobody wants the CLI uncounted. Would
  change my mind: a request for one, then a --no-tell flag sending notifyCreated:false.
- Taken (NITs): a local tellBox in the import, like the page's other two sends; the route comment says a guide's team
  pings an unchanged count (createdCount leaves the guide out).
