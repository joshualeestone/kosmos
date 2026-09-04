# Plan: runner-aware AUTH_FAILED waiting note (#2107, chat.js half)

## Goal
Stop a provider-name leak in running-agent state copy. `engine/chat.js`'s
`waitingNote` AUTH_FAILED note said "its Claude sign-in was not working" for any
runner. A running codex agent fronts as a `node` process, passes the messageable
gate, and stays reachable (#571 send path), so a codex pane classifying
AUTH_FAILED showed its OpenAI owner a Claude-named message.

## Scope: chat.js half only (deliberate phasing)
Card #2107 is a class of 5 sites (spun out of #2100). This branch does the ONE
chat.js site + the plumbing. The four status.js siblings (2363, 2414, 4125,
4231) are phased to a later PR: Renet's active #2093 (codexauthprobe.js +
status.js) is the live editor of status.js, and 2414 (the AUTH_FAILED
classifier) is her territory. Serialized per Splinter: Renet commits #2093, then
the status.js half lands on top. This is confirm-before-editing, not a partial
fix by omission.

## Approach (the pattern already in the tree)
- `waitingNote(state, outcome)` -> `waitingNote(state, outcome, runner)` with
  `const runnerName = runner === 'codex' ? 'Codex' : 'Claude';` -- the exact
  pattern the #2100 addressability reason uses at chat.js:520.
- The AUTH_FAILED case names the runner.
- `deliver` passes `allowed.card.runner` (the card the send was authorised
  against) into the note. `card.runner` is normalized upstream to `'codex'` or
  `''` (status.js:888), so every non-codex value degrades to Claude -- the safe
  pre-#2107 behavior.

## Verification
- Unit test `chat.waitingnote-provider-2107.test.js`: the codex note names Codex
  and never leaks Claude; a claude/unknown runner degrades to Claude; the runner
  only renames the AUTH_FAILED copy; a source-pin proves `deliver` passes the
  runner (else the note is an unarmed guard).
- Non-vacuous: reds on origin/main (2-arg waitingNote returns Claude; the
  source-pin is absent). `engine/chat.test.js` 116/116 (no regression).
- Live-codex e2e (a real codex agent showing Codex-named copy) is the #2099 /
  morning-with-Josh dependency; do not block the copy fix on it.

## Validation
`tools/run-tests.sh` (full gate) + the unit test. Challenge-loop is the pre-PR
gate (see the `-pre-challenge.md` proof).
