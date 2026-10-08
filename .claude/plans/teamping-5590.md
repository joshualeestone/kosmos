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
- (Struck in review 3: the CLI line here was wrong. Before this change POST /api/team never pinged; see Review 2.)

## Review 2 (sonnet): no blockers
- Stated, deliberate (WARNING): the CLI's `kosmos agent create` posts a one-member team, so it now pings, as the single
  create already does for CLI and agent callers (#3038's default ON). A CLI create is a real agent created, which is
  what the homepage counts. No CLI opt-out is added here; weakest premise: that nobody wants the CLI uncounted. Would
  change my mind: a request for one, then a --no-tell flag sending notifyCreated:false.
- Taken (NITs): a local tellBox in the import, like the page's other two sends; the route comment on the guide (corrected in
  review 3: only the guide's own birth is left out; members it creates are counted).

## Review 3 (opus)
- Fixed (WARNING): the import followed #create-tell, which sits on the single-create step and cannot be seen from the
  import, so the import sent a count with no visible choice. Now the import shows its own "Let Kosmos know these agents
  were created" box (#orgchart-tell), set from #create-tell when the panel opens and written back to it on change,
  exactly as Review 27's #tc-tell does for the seeded team; the creates still read #create-tell. The browser check
  asserts the box is visible and ticked, clicks it, asserts #create-tell follows and the import sends false.
- Fixed (CONVENTION): the guide comment (above) and the struck Review 1 CLI line.
- Left (NIT): the Claude config path in os.tmpdir(), as the #3038 harness has it.
