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
- `engine/teamseed.js`:
  - `memberSpec({team, slot, names, project}, catalogue)` returns ONE create spec:
    `{ name: names[slot], role, label: title, instructions: memberInstructions(...), reportsTo: lead's name or
    null, projects }`.
  - It refuses with a named reason: an unknown team or slot, a missing or blank name for any slot, or two slots
    with the same name.
  - `summary(catalogue)` and `detail(key, catalogue)` feed the Team dropdown and the confirm screen.
  - The catalogue is injected. The default is `require('./catalogue')`, loaded lazily, so this branch lands
    before April's seed does and says so (not installed) instead of crashing.
- server.js:
  - `GET /api/teams/seeded`: the dropdown list (key, label, blurb, kind, rank, member count).
  - `GET /api/teams/seeded/<key>`: the members as the person will confirm them (slot, title, suggested name,
    reports to, and whether a portrait ships).
  - `POST /api/team/seeded` `{team, slot, names, project}` creates ONE member through `createTeam` (creator
    'operator', purpose = the team's purpose). It uses the SAME auth as `/api/team`. That is the operator path
    only: a seeded team is a person's click. An agent uses `/api/team` as today.
  - When the member's `avatar.image` names a shipped file, the server sets it as the agent's avatar after a
    successful create. A failed avatar never costs the agent; the answer says avatar: set / none / failed.
- One member per request is deliberate. It is what makes per-agent progress and per-agent retry possible
  without a job queue, and a retry cannot redo the others.

## Slice 2 (next branch): the create step in web/index.html
- `openTeamCreate(key)`, called by Angel's Team dropdown (#4556).
- Names are editable and prefilled with the suggestions. The project defaults to a new one named from the seed,
  or the person can pick an existing one or choose none.
- ONE confirm: "Create 6 agents", saying they run on the person's AI plan.
- Then a progress list, one row per agent: waiting, creating, made, or failed with the reason, with Retry on a
  failed row.
- The lead goes first. The reports wait until the lead exists, because they report to it by name. A failed lead
  holds the reports with that reason, and retrying the lead releases them.
- The org chart import (#1280) moves onto the same progress step later. Kano owns that path; the step will
  accept plain members for it.

## Slice 3: portraits
Once #4555's images exist, `avatar.image` is filled and slice 1's server path starts setting them. No code
change is expected.

## Rejected
- **One POST for the whole team (today's `/api/team` shape):** no per-agent progress, and a retry would resend
  everyone. createTeam's partial outcome is right for an agent's request, but not for a person watching six rows.
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
- server tests: the three routes; auth parity with /api/team (no board token on an enforcing board gives 403);
  one member per POST; a catalogue that is not installed answers 503 with a plain reason, never a crash.
- Real server smoke on a scratch board (no real agents on my board): create a fixture team, and prove the
  reportsTo and project on the profiles.
