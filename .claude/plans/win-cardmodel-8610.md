# win-cardmodel-8610: a board in a named world gets the #8601 card-model rule (kosmos#8610)

**Posture:** production

Stacked on win-cardmodel-8605 (PR #8611), which touches the same lines; rebased onto main once that merges.

## Finished means
- readModel's own-session test (#8601 review 7) counts the agent's LAUNCH KEY in this process's world as its own
  session: the bare name in the default world (as before), `name+world` on a named-world board (#1704). So a
  named-world board's cards get the rule (show the model an agent was just changed to), as the default board's do.
- A session from another world (a bare `ava` read by a named-world board, `ava+qa` by the default board) never gets
  it: its job is not the one jobMtime reads.
- A test proves both, with a default-world control, and fails against the base.

## Change (engine/status.js, one test)
- `ownSession`: `exactSession` absent, or equal (case-blind) to `launchidentity.launchKey(agentName,
  launchidentity.currentWorldId())`. In the default world launchKey is the bare name, so nothing changes there.
- The jobMtime comment no longer lists the gap; it says the session and the job use the same world.

## Decisions
- launchKey, not "bare name OR name+world": on a named-world board a bare-name session is the default board's agent,
  whose job is another world's; letting it match would judge it against the wrong job.
- The world is this process's (currentWorldId), the same one every job lookup without a worldId resolves to, so the
  two cannot disagree.

## Weakest premise
That a named-world board's panes always report `pane.session` as the launch key. status.js parsePanes and the
supervisor stamp say so (#1704); a pane started some other way would simply not get the rule (today's behaviour).

## Tests
- engine/status.cardmodel-8601.test.js "kosmos#8610": KOSMOS_WORLD=qa, the session `wshared+qa` (any case) gets the
  rule and `wshared` does not; control in the default world, the reverse. Fails against the base status.js.
- The 8601 files, status.test.js, earlier-model-6716, modelname-4416, codex-model-switch-4416 and the policy tests:
  361 tests, 0 fail. The named-world (*world*1704*) files: 149 tests, 1 failure (worlds.registry-1704
  "applyActiveWorldEnv sets the named world env after a switch"), which fails the same way on the base.
