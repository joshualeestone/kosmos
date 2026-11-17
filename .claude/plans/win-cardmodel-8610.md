# win-cardmodel-8610: a board in a named world gets the #8601 card-model rule (kosmos#8610)

**Posture:** production

Was stacked on win-cardmodel-8605 (PR #8611, same lines); rebased onto main after it merged (f96b469e6f).

## Finished means
- readModel's own-session test (#8601 review 7) counts as the agent's own session: no session given, the bare name, or
  its LAUNCH KEY in this process's world (`name+world` on a board running in a named world, #1704). So a named-world
  board's cards get the rule (show the model an agent was just changed to), on macOS, Linux AND Windows.
- The default world is unchanged (its launch key is the bare name); a name-sharing session (`foo-discord`) still does
  not get the rule; another world's launch key (`name+qa` on the default board) does not either.
- A test proves it, including the Windows shape, and fails against both the base and a launch-key-only version.

## Change (engine/status.js, one test)
- `ownSession`: `exactSession` absent, or equal (case-blind) to the bare name or to
  `launchidentity.launchKey(agentName, launchidentity.currentWorldId())`.
- jobMtime's comment no longer lists the gap; it says which two shapes are own and why another world's never arrives.

## Decisions
- Review 1 (a BLOCKER on the first version, launch key only): a Windows row's session is the agent's PLAIN name in
  every world (win32roster win32RowValue `session: name`; parsePanes keys Windows rows in the default world because the
  roster lists only this world's store). Launch key only turned the rule OFF for a Windows named-world board, which had
  it before by the bare-name test. Both shapes are own.
- Counting the bare name on a named-world board is safe because another world's macOS or Linux session never reaches
  readModel (parsePanes drops it via agentNameFromSession), and the Windows roster holds this world's agents only. So
  whichever shape arrives, the job jobMtime reads (this world's) is the one it runs.

## Weakest premise
That nothing hands readModel another world's bare-name session on a named-world board. True for the snapshot (the
only caller that passes a session; whoami passes its card's session, which comes from the same snapshot). A future
caller that reads arbitrary sessions would have to filter by world first.

## Tests
- engine/status.cardmodel-8601.test.js "kosmos#8610": KOSMOS_WORLD=qa: `wshared+qa` (any case) and the bare `wshared`
  (the Windows shape) get the rule; `wshared-discord` does not. Default-world control: the bare name gets it,
  `wshared+qa` does not. Fails against the base and against the launch-key-only first version.
- The 8601 files, status.test.js, earlier-model-6716, modelname-4416, codex-model-switch-4416 and the policy tests:
  361 tests, 0 fail. The named-world (*world*1704*) files: 149 tests, 1 failure (worlds.registry-1704
  "applyActiveWorldEnv sets the named world env after a switch"), which fails the same way on the base.
