# teamcreate-4557: create a whole team of agents from a seeded team definition (kosmos#4557, umbrella #4554)

## Why
Josh, #admin 2026-09-29 09:06 (verbatim on #4554): pick a prebuilt team (for example Marketing) and get a lead
(a CMO) plus 4 to 5 reports with standard roles, good instructions and real-looking avatars, all at once.
#4557 is part 4: the creation step. April builds the seed (#4555), Angel the Team screen (#4556), and Kano the
org chart import (#1280), which should end in the same step.

## What already exists (measured on origin/main 20d9d8bf5)
- `engine/team.js` `createTeam({creator, purpose, members}, deps)` creates each member through
  `create.createAgent`, returns created[] / refused[] with a named reason each, and is capped.
- `POST /api/team` (server.js ~6447) is the operator/agent route for it, with the board-token gate.
- The New Agent org-chart import in web/index.html (~45863) already posts members to `/api/team`.
- Create takes `name, role, label, instructions, reportsTo, projects`. Explicit `instructions` are written
  VERBATIM (create.js:4903) IN PLACE of the role template, and the template-only blocks are then skipped. So
  team members do NOT use it (Josh, 2026-09-29 20:22): they send `teamInstructions`, which create neutralises
  and layers INTO the role's standard instructions as a `kosmos:team` block, before the usual blocks.
- Avatars are an image PUT to `/api/agent/<name>/avatar` after the agent exists.

## The seed (agreed with April on #4557, 09:10)
`engine/catalogue/teams.json` plus `engine/catalogue.js` exporting `teams()`, `team(key)` and
`memberInstructions(teamKey, slot, names)`. The last one returns full text with `{{NAME}}` already filled.
Members carry slot, role, title, suggested name, reportsTo (a slot), focus, and avatar {..., image: null until
the portraits exist}. April tests: unique names and slots, exactly one lead, and every result within create's
MIN_CHARS and MAX_BYTES.

## Slice 1 (on this branch): engine + server, no UI
**Changed at 09:25, before any code:** the first version of this plan added a `POST /api/team/seeded` that
CREATED members. That is withdrawn. `POST /api/agents` (server.js ~6141), the single-agent route New Agent
already uses, takes `name, role, label, instructions, reportsTo, projects`. It runs the whole birth:
- the account liveness check
- the project attach (which `/api/team` deliberately skips, see its comment at ~6434)
- the created-count beacon
- name checks
A new create route would re-implement all of that or silently miss some of it. So the server BUILDS and the page
creates through the existing route.

- `engine/teamseed.js`:
  - `specs({team, names, project}, catalogue)` returns every member's create spec IN CREATION ORDER, lead
    first: `{ slot, title, spec: { name, role, label, teamInstructions, reportsTo, projects }, avatar: { image } }`.
    `teamInstructions` comes from `memberTeamSection` (iteration 14): only the member's `## On this team`
    section, because create layers it INTO the role's own instructions, which already hold the role text
    and the live messaging block. `memberInstructions` (the whole file: role text + section + messaging
    block) is for a caller that REPLACES the role text, and sent here it doubled both. `role` is the catalogue's when
    the catalogue names; a role this version lacks is REFUSED by the catalogue's memberProblem (iteration 8: the
    brief is written for that role, and the real seed ships every role it uses). A report's `reportsTo` is the lead's machine
    name, stored in its RECORD, so the board's reports sweep writes the tree (Josh, 20:24).
  - It refuses with a named reason: an unknown team, a missing or blank name for any slot, or two slots with
    the same name (case-insensitive).
  - `list(catalogue)` feeds the Team dropdown; `detail(key, catalogue)` feeds the confirm screen.
  - The catalogue is injected. The default is `require('./catalogue')`, loaded lazily; while April's seed is not
    merged it answers "not installed" instead of crashing.
- server.js, reads only, nothing created:
  - `GET /api/teams/seeded`: the dropdown list (key, label, blurb, kind, rank, member count).
  - `GET /api/teams/seeded/<key>`: the members for the confirm screen (slot, title, suggested name, reports to,
    whether a portrait ships).
  - `POST /api/teams/seeded/<key>/specs` `{names, project}`: the ordered specs. It is a POST only because it
    carries a body; it writes nothing.
- Avatars: when `avatar.image` names a shipped file, the page PUTs it to the existing
  `/api/agent/<name>/avatar` after that agent is made. A failed avatar never costs the agent.

## Slice 2 (also on this branch): the create step in web/index.html
- `openTeamCreate(key)`, called by Angel's Team dropdown (#4556).
- Names are editable and prefilled with the suggestions. The project defaults to a new one named from the seed,
  or the person can pick an existing one or choose none.
- ONE confirm: "Create 6 agents", saying they run on the person's AI plan.
- Then a progress list, one row per agent, each row one `POST /api/agents`: waiting, creating, made, or failed with the reason, with Retry on a
  failed row.
- The lead goes first. The reports wait until the lead exists, because they report to it by name. A failed lead
  holds the reports with that reason, and retrying the lead releases them.
- The org chart import already works (#4217, 0.7.05; Josh 09:09: "it does function with a simple list"). Moving
  it onto this progress step is a later improvement, not part of #4554, so this step takes seeded teams only.

### Slice 2, as built (measured)
- The step is a fourth create step, `cstep-team`, beside role / name / made. `openTeamCreate(key)` opens the
  create panel and switches to it, so the New Agent mode list (Angel's #4556 region) is not touched.
- Order on the button:
  1. the names are checked through the specs route with no project and `check: true`, which also refuses a name
     already taken on this computer (its folder or launch job exists, create's own test), so a taken seed name
     like an existing Maya is caught before anything is made (April's point on #4557, 10:36);
  2. the project is made;
  3. the members are made one by one.
- **A new project takes the first free name.** A second Marketing team collided with the first one's project
  (measured: `that folder is already the project "Marketing"`), so the menu offers "Marketing 2" and says so.
- **A failed row keeps its name editable.** Try again re-reads the specs with the current names (made members
  keep their made names), so a renamed lead's reports get the new machine name.
- render-teamcreate-4557.js, chromium + webkit (the count of checks is whatever the file holds; a number written here went stale twice). The service worker is blocked there, because in
  webkit it answered /api/agents before the intercept and those creates reached the real route (the sandboxed
  one; no launchd job leaked, checked). The check asserts the server's created count stays 0.

## Slice 3: portraits
Once #4555's images exist, `avatar.image` is filled and slice 1's server path starts setting them.
NO LONGER TRUE AS WRITTEN (review 19, 2026-09-30): this said "no code change is expected", which held
while the catalogue shipped inside Kosmos. It is downloaded now (#4632), so no image file ships and
`tcPortrait` has nowhere to fetch one from. Follow-up kosmos#4720; nothing is wrong today because every
catalogue member's `avatar.image` is unset.

## Rejected
- **One POST for the whole team (today's `/api/team` shape):** no per-agent progress, a retry would resend
  everyone, and `/api/team` does not attach projects.
- **A new seeded create route (this plan's first version):** it duplicates `/api/agents`' birth machinery.
- **The client building instructions and posting to `/api/team`:** the catalogue lives in the engine, and
  duplicating memberInstructions in the page is the double-parse April's shape avoids.
- **A server job with polling:** more machinery than six sequential requests need.
- **Rolling back made agents when one fails:** Josh asked for "say which, and let them retry it without redoing
  the rest". Every made agent is independently removable.

## Weakest premise
That a person's chosen names stay valid between the confirm and the create. If an agent named "Maya" appears in
between, that one row fails with create's own reason and Retry lets them rename it. Slice 2 must let a failed
row's name be edited before retry.

## Checks
- engine/teamseed.test.js, with a fixture catalogue in the agreed shape: every refusal, the lead's reportsTo is
  null, the reports' reportsTo is the lead's machine name (renamed lead), and the brief rides as
  `teamInstructions` (never `instructions`).
- teamcreate-structure-4557.test.js, through the real path: a member's file is the single-agent file of its
  role apart from the team and reports blocks; the structure is in the record; the reports sweep writes it
  and a second sweep changes nothing; the org chart draws the same tree; every teamInstructions refusal
  (both fields, non-string or empty, over the COMPOSED cap); markers in a brief are neutralised.
- server tests: the three read routes; a catalogue that is not installed answers 503 with a plain reason, never
  a crash; the specs, POSTed to the real `/api/agents` in order on a sandboxed server, make a lead and reports
  whose profiles carry reportsTo = the lead and the project membership.

## Merge of main's downloaded catalogue (#4632), 2026-09-30
Main stopped shipping the catalogue (#4705): it is downloaded, signed, when it is asked for, and until then a
board has no teams. This branch was written against a shipped catalogue, so after the merge five tests failed
(the real roles and teams were simply not there).
- DECIDED: the two reads the Team screen opens with (`GET /api/teams/seeded` and `/api/teams/seeded/<key>`)
  ask the catalogue to download first (`teamseed.refresh`, which never rejects), then answer. `specs` does
  not ask: it builds from what is held.
- A board that holds no catalogue answers 503 with a sentence (`NOT_DOWNLOADED`), at all three routes. Before,
  it would have answered 404 "there is no prebuilt team called ...", which blames the person's choice.
- REJECTED: downloading at board start (#4632's rule is that it is fetched only when asked for).
- Tests read the real catalogue through `test-support/catalogue-fixture` (the published file, re-signed
  with a test key, in a sandboxed data root). Perturbed: the list answering without the download reds its
  test; an empty catalogue read as held reds two.
- WEAKEST PREMISE: the catalogue waits ten minutes between tries, failed ones included, so "try again a
  little later" can mean up to ten minutes and the sentence does not say how long.
- NOT RE-RUN here: the browser check render-teamcreate-4557.js. It injects its own fixture catalogue with no
  `status`, which these changes read as held, and no page code changed in this merge.

## Review 19 (opus, after the merge), what changed and what did not
FIXED:
- A board holding no catalogue now really tries on every open of the Team step (`refresh` forces when
  nothing is held). Before, a failed try blocked the next for ten minutes, so "try again" after
  reconnecting did nothing. A board that HOLDS a catalogue still leaves the pacing to the catalogue.
- The not-downloaded sentence carries the catalogue's own reason, and a copy that was downloaded and
  REFUSED (signature, format, serial) no longer says "check it is online".
- Rows from another version of the team (a newer catalogue arrived between the screen opening and the
  button) are refused as that, not as "give the X a name" for a seat that is not on screen.
- The previous team's progress line no longer stays under the next team while it loads or fails to.
- A portrait path from the catalogue is fetched only when it is a plain relative path.
- A test through the REAL catalogue module: nothing held, the list read downloads the published files
  (verified with the shipped key), and the three routes answer from them.
- The comment that promised a general-purpose fallback role the code does not have is gone.
DECIDED, NOT FIXED:
- A team is made on the default account (no provider or account on a spec), as a single agent made with
  nothing chosen is. A person with only a non-Anthropic plan sees each row say why. Follow-up kosmos#4719.
- `defaultAgentFor` puts the org chart before the role text for EVERY project, so one reporting edge
  outranks a "Project Manager" who reports to nobody and has no reports. Kept: the chart is a recorded
  fact and the role text a guess (April's review, iteration 13), and the cost is one preselected entry the
  person changes in a click. Weakest premise: that a partial chart says more than an explicit PM title.
- Same seats, new title or role, after a catalogue swap: the member is made with the new one under a row
  showing the old title. Not detected (only the seat set is compared).
- After a run has STARTED, a swapped catalogue makes Try again refuse until the page is reloaded (the same
  team always resumes). Rare: a publish, and a download trigger, inside one run.
- The browser check still injects its own fixture (no `status`), so no check RENDERS the not-downloaded
  503. The sentence is pinned at the routes, and the page shows any refusal's words as they come.
- `openTeamCreate` has no caller in the product yet (the dropdown is #4556's). Unchanged.

## Review 20 (sonnet)
FIXED: with two or more tops on one project, the room opens on one of THEM (most direct reports, a tie in
project order), never on a middle manager under one of them who has more direct reports. Tested; the old
fallback picked the middle manager.
NOT AN ISSUE AS DESCRIBED: "the brief-fits check ignores the blocks added at birth, so the file can go over
the limit". It cannot: every later block is spliced only if the result still fits (create.js, each
`<= MAX_BYTES` guard), and a block that does not fit is reported as a step not done, which the team step
shows on the member's row. A brief near the 32 KiB cap would cost the member its later blocks, not make an
unreadable file. Real briefs are one or two kilobytes.
DUPLICATE: the org chart before the role text for every project (decided under review 19).

## Review 21 (fable)
FIXED:
- The team list kept rank order only, which interleaved personal and business teams (ranks restart per
  kind). It now follows the catalogue's order: business, then personal, each by rank. The old test pinned
  the interleaving.
- A member's file carried an empty "## Your team" heading directly above the brief's own "## On this
  team". The fixed heading is now only for a brief that has none.
- Whether a downloaded copy was REFUSED is a flag on the catalogue's status, set where the refusal is
  thrown, not a match on the sentence. A refused copy is also not asked for again on every open.
- A name already taken says the agent may be this team's own ("If you were making this team a moment ago,
  those agents are already on your board").
DECIDED, NOT FIXED:
- Kosmos keeps no record of a half-made team. After a page reload in the middle of a run, reopening the
  team cannot resume it: the made agents are simply agents, their names are taken, and the person names
  the remaining seats or makes those agents singly. The sentence above is the whole mitigation. A record
  of a team in the making (so a reload resumes) is a feature of its own. Weakest premise: that a reload
  mid-run is rare, in a run that takes well under a minute.

## Review 22 (opus)
FIXED:
- A failed row LATER in the list, renamed and retried while an earlier retry was still being made, was
  posted under its old name: the running pass had read its spec before the rename. The pass now leaves a
  row whose spec name is not the name on screen, and goes round again. Browser arm added (both engines).
- One failed read of the specs during a run failed every row, and each then needed its own Try again.
  Rows that fail as one are now taken together by one Try again. Browser arm added.
- The Team step's "not downloaded" and "could not use them" sentences carried the catalogue's raw reason
  in brackets: an address and a status code, or a serial. It is logged; the screen gets the plain sentence.
- Stale prose: teamseed.js's header and list() doc, the specs() return shape (it omitted `session`), a
  comment in catalogue.js that placed the team section outside any managed block. CLAUDE.md gains a
  Where to Find Things row for making a team.
DUPLICATE (decided earlier, unchanged):
- The project is made before the lead's account is known to work, so a failed lead leaves an empty
  project (deferred under review 18). Correction to review 19's sentence: only the lead's row says why;
  the reports say they are waiting for the lead.
- The org chart decides who every project's room opens on, not only a seeded team's (review 19).
NOT TAKEN:
- Commit subjects say `teamcreate-4557`, the branch is `teamcreate-ui-4557`. The PR squash-merges under
  its title; rewriting pushed history to fix a prefix would cost every recorded run its sha.

## Review 23 (sonnet)
FIXED:
- The menu's "first free name" for a new project is judged by project NAMES; the server refuses on the
  FOLDER (a renamed project keeps its folder). The refusal now carries a code (`folder_taken`, from
  `projects.create` through `POST /api/projects`), and the Team step takes the next name, up to five
  times, and shows the name it made. Engine test, route test, browser arm.
- The go-round added in review 22 had no bound. A row whose spec does not match after three reads fails
  with a sentence. Browser arm (a spec that comes back under another name).
- "This makes 1 agents"; and a fetch that never reached the board showed the browser's own words.
DUPLICATE (decided earlier): a board with no catalogue asks the network on every open of the step; the
browser check's fixture has no `status` and no `memberTeamSection` (the server tests pin both).

## Review 24 (fable)
FIXED:
- A REMOVED agent keeps its folder, so the names pre-check caught its name and said "there is already an
  agent called Maya ... already on your board" while the Agents tab showed no Maya. It is the likeliest
  repeat path (remove a team, make it again). The pre-check now asks the removed list first and says what
  create says for that name: the removed list, and how to free the name. Test with a live-agent control.
- The dropped-connection row still showed the browser's words in brackets; they go to the console.
- `tcSay` took every TypeError for an unreachable board, which would have hidden a page bug as a network
  problem. It now matches only the three browsers' fetch-failure wordings.
NITs NOT TAKEN: a blank name left in another failed row fails the retried row with that seat's
complaint (one Try again recovers); a member adopted after a dropped connection gets no project tell;
the unknown-team sentence shows the team's key; `body.team` is read outside the load's try.

## Review 25 (opus)
FIXED:
- The team step posted each member without `notifyCreated`, so the sheet's "Let Kosmos know an agent was
  created" box was ignored once per member. It now sends the box's state, as the single create does.
  Browser arm (box unticked: every post carries false).
- A create that dropped could adopt an agent this run never made: a failed row renamed to an EXISTING
  agent's name is not checked free on retry, and the adoption looked that name up on the board. If the row
  was the lead, every report was then made under that agent. Adoption is now only for the name checked
  free before the run. Browser arm (rename to Ada, drop, the row stays Not made).
- Two race arms in the browser check could pass with no race on a loaded machine (a 2.5 s hold, then
  several round trips). The held create now waits on a gate the arm releases, and each arm asserts the
  earlier create was still being made when Try again was pressed.
- One derivation with create.js for "is this name held on this computer" (`create.nameHeld`) and for the
  removed-list words (`create.removedNameWords`); teamseed no longer restates either.
- Named constants for the step's four bounds; README row brought up to date; the TC shape comment;
  an unused require.
NITs NOT TAKEN: the unreachable not-installed branch and `memberInstructions`' last caller; `tcPortrait`
ships untested until #4720 gives it something to fetch; the idle-replaced arm is witnessed by a 404;
webkit's expected project name depends on chromium's arms (it fails closed); an unfinished same team can
only be abandoned by a reload; three different figures for a brief's size; lowercase server sentences.

## Review 26 (sonnet): converged
No new BLOCKER, WARNING or CONVENTION. Its one WARNING (a board holding no catalogue asks the network on
every open of the step) is the decision recorded under review 23 and earlier. NITs: the idle-replaced arm
is witnessed by a 404 (listed under review 25); a CSS comment says "the three steps"; the brief's size cap
is measured before trimming.
Owed before the proof file: the queued browser check with its control tree, and one full suite on this head.

## First run of the new code (10:39 to 10:44 CDT, head 0d578ec96, one heavy-queue turn on Agent1s)
- Browser check, both engines: 131 pass, 0 fail.
- CONTROL (the same check on the branch with web/index.html from before reviews 22 to 25): exit 1, 115 pass,
  16 fail, which are exactly the eight arms added in those reviews, in both engines, each for its own
  reason (the old name posted; one row made after a failed read; no retry on a taken folder; a mismatched
  spec made anyway; an existing agent adopted; no notifyCreated).
- Web and team tests: 2760 pass, 1 FAIL, and it is mine: `web.inline-errors-2606.test.js` reads create.js
  for the removed-list sentence followed by its refusal's `field: 'name'`. Review 25's "one derivation" moved
  that sentence into a helper at the bottom of the file, so the test found it there. FIXED: the sentence is
  a literal at create's refusal again; teamseed carries its own copy of the words, and a test reads
  create.js and fails when the two differ. `create.nameHeld` stays.
- Review 26's convergence was on 0d578ec96. This fix is a code change after it, so one more blind round
  and the full suite are owed on the new head.

## Review 27 (opus), on 90332aac7: no BLOCKER, 3 WARNINGs, 2 NITs. Round 26's "converged" did not hold.
All three warnings are about what the step does NOT do that the single create does. Twenty-six rounds
compared the step with itself; this one compared it with its sibling.
- W FIXED: the page could reload itself in the middle of a run. The automatic stale-page reload (#3955) and
  the Mac window's restart after an update (#4347) both ask `updateNothingToLose()`, which knew the single
  create's flags and nothing of the team. It now holds while a team has anything in flight (the click being
  worked on, members being made, the board being watched, a picture going up), and ONLY then: a finished
  team, or one stopped on a failed row, does not hold the reload for the rest of the tab.
  REJECTED: holding while a row waits for Try again. That is the person's to press, possibly never.
  WEAKEST PREMISE: that losing a stopped team's Try again to a reload is acceptable. Review 21 accepted
  "no resume after a reload" because a reload mid-run was rare; with this fix it is no longer the
  product's own doing while anything is in flight.
  Test: web.reload-toast.test.js, five states with a control each way, and that the four flags are the
  ones the step sets.
- W FIXED: the step ended on "Your team is ready" and a Back button. The single create ends on the
  invitation to say hello and one button straight to the agent (Josh, 2026-08-22: "Unless I go say hello
  to them, they don't start", and his ruling against sending people to find the agent). The team step now
  ends the same way: the sentence, and "Say Hello to <the lead>", which opens the lead.
  DECIDED: the sentence says "each of them ... starting with <lead>". REJECTED: "say hello to <lead> to
  start your team", because nothing here shows that greeting the lead wakes the others.
  WEAKEST PREMISE: that one button to the lead is the right single step for five agents. NOT MEASURED:
  whether a team member really stays idle until greeted; that is Josh's observation of single agents.
- W FIXED: team members got no picture at all. The single create always uploads one (the person's file, or
  the generated mark); the team path uploaded only a catalogue portrait, and all 112 members of the 21
  published teams carry none. Each member now gets the generated mark for its name when the team ships no
  portrait. The line above that says "nothing is wrong today" (the #4720 paragraph) was wrong about this.
  The row's "(portrait not set)" is "(picture not set)", since it now covers both.
- NIT taken: a name typed between the click and the start of the run was made without being checked free,
  and trusted as checked (review 25's adoption rule rests on that). The name boxes lock from the click.
- Browser check: four new arms (names locked while the pre-check is out; no Say Hello before ready; the
  ending's sentence, button and width; a PNG picture per member, once each; Say Hello opens the lead and
  leaves no team behind). NOT RUN YET. Every arm now answers the picture PUT itself (the members are not
  real agents), so the earlier arms need this run as much as the new ones do.
- The full suite queued on Mortals for 90332aac7 was stopped before it started (it would have measured a
  head that no longer exists). A new one is owed on this head, and another blind round after it.
- NIT taken (the rest of review 27 arrived later): the team step obeyed the single create's "Let Kosmos
  know an agent was created" box, which sits on another step and cannot be seen from the team step. A
  person who goes straight to a team sent one created notice per member with no way to say no on that
  screen. The same choice is now shown on the team step, kept equal to the sheet's one box, and fixed once
  the run starts. The existing browser arm unticks it HERE now, not by reaching into the hidden box.
- Stated by the reviewer and true: `openTeamCreate` has no caller in the page yet (it waits on #4556), so
  nothing on this branch can be reached by a person until that lands.

## Review 28 (sonnet), on 9aaea3ce7: no BLOCKER, 1 low WARNING, 2 NITs. All three are in review 27's additions.
- W FIXED: opening a team after a finished one showed the finished team's "Say Hello" (a dead button, since
  the team is gone), its project menu and its choice while the new team loaded, or for good if the load
  failed. The load path now clears them; tcPaint sets them again once a team is there. Browser arm: the
  load is left unanswered and the screen is read as it stands.
- NIT taken: "1 of them has something to look at" for a team of one is "It has something to look at".
- NIT taken: Say Hello lets the team go while its last pictures may still be going up, and the reload hold
  counted uploads on the team. The count is its own variable now, so it holds after the team is gone.
- The reviewer's comparison with the single create found the team step level with it on the created
  notice, the project tell, the picture, Say Hello and a dropped create. Two differences it judged fine
  and nobody had written down: a team has no custom-picture path, and the board is refreshed when a
  picture lands, not after each create.
- NOT CHECKED by this round: the browser check file, the engine and the server. Round 27 read those.

