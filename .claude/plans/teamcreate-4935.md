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
- .tc-h left as it was (review 3): `.panel h2` already sets the title at --text-title-3 with higher
  specificity, so the misspelled token in .tc-h never showed; editing it would change nothing on screen.

## Review 2 changes
- While a model list loads (OpenAI account models, or the roles not read yet) the menu says so and Create is
  held (dataset.loading, read in tcPaint), so a team is never made on a silent default; tcPaint runs again when
  the list lands.
- openTeamCreate bumps TC_MODEL_GEN and empties #tc-model as well as resetting TC_MODEL_FOR: the browser check
  showed the repaint kept the last team's pick (it keeps a pick the new list still offers, e.g. across an account change), so a
  new team must start from an empty menu to land on the default.
- tcPaintModel's branches are unit-tested against a fake document (Claude, vendor picks, OpenAI listable with
  escaping, OpenAI not listable, roles not yet read).

## Review 3 changes
- Try again is held while the model list loads (tcRetry returns; tcPaint disables .tc-retry), the same reason
  Create is: a failed lead reopens the menus and a retry then would make the team on no model.
- The footer wraps under 560px, checked at 390 (no overflow, the box's words keep >= 200px).
- Deferred: the single create's why-note under a Claude model (paintModelWhy) is not shown on the team step.
  It explains the model in a sentence; the team label already says each agent can change it later, and adding
  it means a second caller of paintModelWhy with its own ids. Would change my mind: Josh asking for it.

## Review 4 changes
- The hold is set where loading starts (tcPaintModel's show): Create and Try again are disabled at that moment,
  whatever started the load (first paint, a provider/account change, a late account list). The Create click
  handler also refuses while loading. tcPaint offers them again when the list lands. Unit test asserts the
  hold at load start; control: removing it fails 2.
- The late-account callback runs tcSyncModel, so the model list follows a provider/account it changed.
- A new team clears the model menu's loading/fixed flags too.

## Review 5 changes
- Accessibility: the Model heading is a span naming the group (as on the single create) and the provider menu is
  aria-label "Provider", so a screen reader no longer hears two menus both called "Model".
- #4709's Project-label margin rule removed (the .field spacing replaces it); a failed roles read lets the next
  paint try again (TC_MODEL_FOR cleared); on a phone the wrapped buttons stay right-aligned; the disabled-look
  comment names every state it covers.

## Review 6 changes
- Create and Try again are offered again the moment loading ends, whatever ended it: a switch mid-load to a provider
  with nothing to load (whose stale answer the generation then drops) no longer leaves them held. Tested, control.
- A failed roles read no longer retries by repainting (that looped against a failing read): it marks the menu, and
  tcSyncModel paints it again once another path holds the list. Tested: one read, not a loop.

## Review 7 changes
- The failed-roles comment says what happens (create's default until a provider/account change reads the list);
  the recovery branch has a unit test.
- A provider the menu has no list for (anything not Claude, OpenAI or a vendor that picks) sends no model, never a
  Claude key that create would refuse.

## Review 8 changes
- tcSyncModel paints nothing while the provider menus are filling (they hold the last team's values); the paint
  after the fill syncs. Tested with a control.
- A new team clears the model note too. The loading test is one helper, tcIsModelLoading (named so that a test
  searching for "function tcModel" still finds tcModel).
- Deferred, verified: "the spinner restarts on every 2 s repaint". The spinner is inserted inside tcPaint's
  signature gate (the list is rebuilt only when a row changes), so a repaint with no change leaves it running.
- Deferred: comment density. It matches this file's #NNNN comment style, which another review called consistent.

## Review 9 changes
- The OpenAI models read is bounded (TC_MODEL_WAIT_MS, 8 s, like this step's 5 s account read): a stuck answer reads
  as "OpenAI picks its own model for now" and Create is offered again. Tested with a read that never answers.
- A provider with no list hides the row (as the vendor branch does); a redundant .spin rule and an unused test
  helper removed; the plan's round-trip sentence corrected.

## Review 10 changes
- The TC_MODEL_GEN / TC_MODEL_WAIT_MS comments were merged onto one line by the review-9 insertion: split back.
  The OpenAI wait's timer is cleared when the race settles.
- Deferred, verified: "a resumed team after a page reload loses its model". TC is never persisted (no storage
  write for it), so a reload drops the team and there is nothing to resume; an in-page resume returns from
  openTeamCreate before the menu reset, so TC.model and the menu both stay as they were.

## Weakest premise
That 18rem reads as "about half as wide" at Josh's window size; the column is 34-36rem, so it is ~half there.

## Checks
- engine/teamseed.test.js (model on every spec; non-text refused), server.teamseed-4557.test.js (route
  forwards model; control: reverting server.js fails it), web.teammodel-4935.test.js (tcModel carries model,
  control removing it fails 3; tcSyncModel repaints only on change, locks when fixed).
- docs/browser-checks/render-teamcreate-4557.js #4935 arm, both engines.
