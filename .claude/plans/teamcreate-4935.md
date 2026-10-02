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

## Weakest premise
That 18rem reads as "about half as wide" at Josh's window size; the column is 34-36rem, so it is ~half there.

## Checks
- engine/teamseed.test.js (model on every spec; non-text refused), server.teamseed-4557.test.js (route
  forwards model; control: reverting server.js fails it), web.teammodel-4935.test.js (tcModel carries model,
  control removing it fails 3; tcSyncModel repaints only on change, locks when fixed).
- docs/browser-checks/render-teamcreate-4557.js #4935 arm, both engines.
