# teamcreate-4935: Create a Team looks like Create an Agent, one model for the team, making-phase polish

Card: #4935 (Josh, 0.7.16 staging test, 2026-10-01 20:52 and 20:53). Split with April (#4936, branch
teamhello-4936): she owns the finish step (hello to every member, navigation to the agents view, item 6).
This branch owns items 1-5, 7, 8.

## Done means
On a served build the two team steps match Create an Agent side by side (spacing, label gaps, 18rem menus,
stepped Model block, one-row footer), the ready-made team menu is about half the column, a team made with a
chosen model has it on every member, the row being made shows the Kosmos spinner, names do not move as
statuses change, and Project/Model look locked while making.

## Decisions
- Reuse, not invent: step 2 takes the #cstep-name structure (.field > .flabel + .frow; .msteps/.mstep) and
  the same numbers, by extending those rules to #cstep-teammake in a new block, not by editing #cstep-name's.
- Model menu (tcPaintModel): the single create's list per provider. Claude = CREATE_MODELS on its default
  (fetchRoles if not read yet); OpenAI = the account's models with "Let OpenAI choose" first, or "OpenAI picks
  its own model for now" alone; vendorPicksModel providers hide the row and say who picks. Empty value sends
  no model (create's default), the same rule provider/account follow.
- Repaint only on a provider|account change (tcSyncModel), so the 2 s repaints keep the person's pick.
  NOT called inside tcProviderSettle / fillCreateAccounts: both are lifted by unit tests in isolation, so a
  call there would throw in the lift. Called from tcPaint, the two change listeners and the two Muse/AGY
  callers that already call tcProviderSettle.
- Spinner: one loop after the row rebuild inserts pjSpin() into .tc-state.creating, so April's row-builder
  lines are untouched. pjSpin carries no text, so 'Making…' still reads exactly (render-teamcreate pins it).
- Item 7: status column fixed at 11rem (wraps inside), measured by the check across making -> running.
- Item 8: the menus were already disabled; they did not LOOK it. select:disabled at .55 opacity on this step.
- Engine/route: teamseed.specs takes model (refused when not text), sent only when chosen; server forwards it.
- Footer order Back, Create (big): the single create has no Back; this step needs one, put on the left of
  the primary, like the other two-button rows.

## Review 1 changes
- tcSyncModel returns early without an open team step (TC set, #cstep-teammake shown), as tcProviderSettle does:
  the subscription/Muse answers call it from every screen. The model list's own roles read is the plain
  /api/roles, never ?catalogue=1 (only the role picker downloads the catalogue, #4632).
- openTeamCreate resets TC_MODEL_FOR, so a new team opens on the default model, not the last team's pick.
- Step-1 spacing rules are scoped to #team-seeded-pick, so the org-chart block (#4559) is untouched.
- The click lock and the fill lock disable #tc-model with provider and account.
- .tc-h: the misspelled token meant the title showed at the 1.1rem fallback (~17.6px); the real token is
  15px/20px, the same title size as the other panels. Visible change, deliberate.

## Review 2 changes
- While a model list loads (OpenAI account models, or the roles not read yet) the menu says so and Create is
  held (dataset.loading, read in tcPaint), so a team is never made on a silent default; tcPaint runs again when
  the list lands.
- openTeamCreate bumps TC_MODEL_GEN and empties #tc-model as well as resetting TC_MODEL_FOR: the browser check
  showed the repaint kept the last team's pick (it keeps a pick across a provider round trip, by design), so a
  new team must start from an empty menu to land on the default.
- tcPaintModel's branches are unit-tested against a fake document (Claude, vendor picks, OpenAI listable with
  escaping, OpenAI not listable, roles not yet read).

## Weakest premise
That 18rem reads as "about half as wide" at Josh's window size; the column is 34-36rem, so it is ~half there.

## Checks
- engine/teamseed.test.js (model on every spec; non-text refused), server.teamseed-4557.test.js (route
  forwards model; control: reverting server.js fails it), web.teammodel-4935.test.js (tcModel carries model,
  control removing it fails 3; tcSyncModel repaints only on change, locks when fixed).
- docs/browser-checks/render-teamcreate-4557.js #4935 arm, both engines.
