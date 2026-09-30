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
- render-teamcreate-4557.js, 87 checks (43 per engine plus the created-count check), chromium + webkit. The service worker is blocked there, because in
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
