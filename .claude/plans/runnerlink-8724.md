# runnerlink-8724: link a Codex, Antigravity or Grok window (kosmos#8724 item 3)

Card: kosmos#8724 item 3 ("Other runners"). Stacked on adoptlink-8724 (item 2, `kosmos adopt --link`), itself on
reclaim-8719 (#8719 part 2, PR #8732: engine/linkwindow.js). Design posted on the card before building.

## Finished means
`kosmos adopt --link <name>` links a hand-started Codex, Antigravity or Grok window when, and only when, its program
names that runner exactly and Kosmos's own record of the agent says it runs on it. The runner is recorded
(`@kosmos_runner`, the value the supervisor records) before the agent mark, both are read back, and on a mismatch both
come off. A Claude window links as before, except when Kosmos's record of the agent names another runner (refused:
a later launch job would record that runner on the window) or the record cannot be read at all (refused, as for any
runner). Proven by engine tests with a stand-in tmux, the real CLI with the
real store, and the real supervisor adopting such a window.

## How
- engine/linkwindow.js:
  - `runnerOfCommand(command)`: claude / codex / antigravity / grok by status.js's literal lists (the same ones the
    supervisor's adopt allowlist mirrors), or null.
  - `expectedRunner(name)`: `create.providerRunner(profile.provider)` from store.readProfile, null when there is no
    profile. A test seam (`setExpectedSource`).
  - plan(): a program that names no runner is refused (the old "not Claude" sentence is now "which Kosmos cannot tell
    is an agent"); a Claude window keeps its isAgentSession check (so a bare `node` is still refused) and is refused
    when the record names another runner or its look carries another runner mark; a Codex, Antigravity or Grok window
    needs `expectedRunner(name) === runner`, else it is refused naming what Kosmos knows.
    Returns `runner`.
  - link(): the program at the look must name the same runner as the plan. For a non-Claude runner: an existing runner
    mark naming another runner refuses; one naming this runner is kept; otherwise it is set first, before the agent
    mark. Both are read back; on a mismatch the agent mark and any runner mark this call set come off; a mark that
    cannot come off is the existing `markLeft` refusal. A Claude link never touches `@kosmos_runner`.
- No board change: an unmarked Codex window has no card (status.isFleetSession), so the board's button cannot reach it;
  the CLI is the way in. After a link the window is marked ours with its runner, so the board then shows it.

## Decided (and changed in review round 1)
- The record decides for a Claude window too: a Claude window under an agent Kosmos knows runs Codex (or another
  runner) is refused, because a launch job written later records THAT runner on the window (the supervisor stamps
  @kosmos_runner on adopt too) and the board would read a live Claude window with the wrong classifier. A Claude
  window with no record, or a Claude record (vendors such as DeepSeek map to claude), links as before.
- A Claude window carrying a runner mark for another program is refused, read from the board's own look (pane.runner),
  so no extra tmux call is made.
- Only the agent mark failing to come off is `markLeft` (the window would be Kosmos's). A runner note left behind alone
  is said in the sentence, and the agent-mark-write failure says so when its runner note could not come back.
- The no-record refusal names the next step: add the agent to Kosmos first (Import an agent you already have). A
  record that cannot be read at all (a throw) is refused as unreadable, never as "no record" (store.readProfile answers
  {} for a missing and an unparseable record alike, so those two read as none).
- Round 3: the runner mark is read in the link's own look (one display-message, the runner field just before the
  agent mark, which stays last), so a mark set after the board's look, or a word the board does not know (parsePanes
  maps those to ''), is still seen and left alone. A set of the agent mark that reports failure is checked with
  `show-options -q` before the runner note comes off (it may have applied); a runner note read back as another value
  is another writer's and is left alone.
- Rejected: inferring the runner from the window alone. The record decides; the program must agree with it.
- Rejected: a bare `node` (npm codex and every dev server front as node), Gemini and Muse (one turn at a time, no
  standing window).
- Runner first, then the agent mark, so the board never sees the window ours with an empty runner (read as Claude).

## Weakest premise
That nothing else on the board treats a newly marked non-Claude window differently from one the supervisor started.
The supervisor's own adoption is measured (supervisor.adopt-runner-linked-8724.test.js); the board's classifiers read
the same two marks the supervisor writes.

## Tests
- engine/linkwindow-runner-8724.test.js (17): codex / agy / grok-native linked with the runner first; refused for a
  Claude record, a Grok record, no record (tmux untouched); bare node refused; a foreign runner mark kept, a matching
  one not rewritten; a runner that reads back wrong takes both off; one that cannot come off is markLeft; a Claude
  window links as before without touching the runner mark.
- engine/linkwindow-8719.test.js and server.link-8719.test.js: the refusal sentences updated for the new rule.
- cli.adopt-link-real-8724.test.js: the real CLI, real store and create.providerRunner: no record refused, a Claude
  record refused, an OpenAI record accepted.
- supervisor.adopt-runner-linked-8724.test.js (2): the real supervisor adopts a linked codex, codex.exe, agy and
  grok-native window and records the job's runner on it; control: a shell is closed.
