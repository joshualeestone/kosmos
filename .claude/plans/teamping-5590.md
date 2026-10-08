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
- The org-chart import shows its own "Let Kosmos know" box (#orgchart-tell), kept equal to the sheet's #create-tell,
  and sends notifyCreated from it (final design: reviews 1, 3, 5, 6, 7; orgchartTell open / locked / gone).

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

## Review 4 (sonnet): no blockers (its orgchartTellLock is superseded by review 5's orgchartTell)
- Fixed (WARNING): the import's box was live while a create ran and after it created agents, so unticking it then
  showed "off" for a ping already sent and flipped the sheet's choice. orgchartTellLock: fixed when the create starts,
  freed on the three exits that create nothing, kept fixed when agents were created (and on a kept result restored
  within the Undo window), freed for a new preview (orgchartPaint, resetOrgchartPreview); as #tc-tell is fixed once
  the team run starts. The browser check asserts it is fixed after a created import and free (and re-ticked, set
  explicitly rather than toggled) after a refused one.
- Taken (WARNING, advisory): the sync runs only on the panel's open click, the only way the panel is shown today;
  stated on the handler so a new way to show it sets it too.
- Taken (NIT): the handler comment names #tc-tell and #create-tell.

## Review 5 (opus): no blockers; the lock replaced by a simpler rule
- Fixed (WARNING): a kept result restored on reopen showed a locked box set from the sheet's CURRENT choice, which can
  differ from the one that was sent, so it could misstate whether those agents were reported. Rather than store and
  repaint the sent value, the box is now shown only where the choice is made: orgchartTell('open') with every preview
  (set from #create-tell), 'locked' while the create runs, 'gone' (hidden) once a result is on screen or a kept one is
  restored. A hidden box cannot misstate anything. Weakest premise: a person who wants to see what was chosen for a
  past import cannot; nothing on the screen ever said it before this change either.
- Fixed (WARNING): the browser check asserts the box is gone after a created import and on the restored result (the
  reopen-within-Undo arm), and open and ticked again after a refused import.
- Taken (NIT): the restore comment; the review-4 residual restated (the restore path, now closed by hiding).

## Review 6 (sonnet): no blockers
- Fixed (WARNING): a repaint during a create (a "reports to" change) reopened the box; orgchartPaint now keeps it
  'locked' while ORGCHART_CREATING. (The same repaint re-enabling Create mid-flight is older than this change; left.)
- Fixed (WARNING): a list past the limit showed an open box with nothing to create; it is 'gone' there.
- Fixed (WARNING): the browser check holds the stand-in create open (1.2 s) and asserts the box is shown and open
  before it, shown and fixed during it. Untested still: the open reset on the three error exits (fetch throw,
  unreadable body, no outcome); the over-cap refusal arm covers the same call.
- Plan: review 4's lock marked superseded.

## Review 7 (opus): no blockers
- Fixed (WARNING): a refused import reopened the box beside "No agents were created". Any result on screen now hides it
  (orgchartTell('gone') at the end of every create); Back to the list then Preview offers the choice again. The browser
  check asserts it is gone after the refused arm.
- Taken (NITs): the three error exits reopen the box only while the person is still on that preview, otherwise it is
  gone; the label says "an agent" for one row, as #tc-tell does; the comment states the three states; the check
  waits for the created count rather than a fixed sleep.
- Left (NIT): the restored-result assertion cannot single out orgchartRestoreCreated's own 'gone' (the reset hides it
  first); kept as a guard on the outcome, not the line.

## Review 8 (sonnet): no blockers
- Fixed (WARNING): the Decided section now states the final design (it still said the import had no box).
- DECIDED (WARNING): the two error exits that may follow a create the server did make (an unreadable answer, a lost
  response) reopen the box beside "Try again". Kept: Try again IS a create about to be made, and the box's choice is
  for that retry, which sends its own count. Weakest premise: that the first attempt's agents and ping are a separate,
  older matter (a retry after a lost answer may duplicate agents today, with or without this change). Would change my
  mind: a design where the page re-reads what was made before offering Try again.
