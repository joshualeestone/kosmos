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
  VERBATIM (create.js:4903): no `{{NAME}}` substitution.
- Avatars are an image PUT to `/api/agent/<name>/avatar` after the agent exists.

## The seed (agreed with April on #4557, 09:10)
`engine/catalogue/teams.json` plus `engine/catalogue.js` exporting `teams()`, `team(key)` and
`memberInstructions(teamKey, slot, names)`. The last one returns full text with `{{NAME}}` already filled.
Members carry slot, role, title, suggested name, reportsTo (a slot), focus, and avatar {..., image: null until
the portraits exist}. April tests: unique names and slots, exactly one lead, and every result within create's
MIN_CHARS and MAX_BYTES.

## Slice 1 (this branch): engine + server, no UI
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
    first: `{ slot, title, spec: { name, role, label, instructions, reportsTo, projects }, avatar: { image } }`.
    `instructions` comes from `memberInstructions` (`{{NAME}}` filled). A report's `reportsTo` is the lead's
    ACTUAL chosen name.
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

## Slice 2 (next branch): the create step in web/index.html
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
  1. the names are checked through the specs route with no project (a refused name makes nothing);
  2. the project is made;
  3. the members are made one by one.
- **A new project takes the first free name.** A second Marketing team collided with the first one's project
  (measured: `that folder is already the project "Marketing"`), so the menu offers "Marketing 2" and says so.
- **A failed row keeps its name editable.** Try again re-reads the specs with the current names (made members
  keep their made names), so a renamed lead's reports get the new machine name.
- render-teamcreate-4557.js, 51 checks, chromium + webkit. The service worker is blocked there, because in
  webkit it answered /api/agents before the intercept and those creates reached the real route (the sandboxed
  one; no launchd job leaked, checked). The check asserts the server's created count stays 0.

## Slice 3: portraits
Once #4555's images exist, `avatar.image` is filled and slice 1's server path starts setting them. No code
change is expected.

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
  null, the reports' reportsTo is the lead's ACTUAL name (renamed lead), and instructions are passed through
  verbatim.
- server tests: the three read routes; a catalogue that is not installed answers 503 with a plain reason, never
  a crash; the specs, POSTed to the real `/api/agents` in order on a sandboxed server, make a lead and reports
  whose profiles carry reportsTo = the lead and the project membership.
