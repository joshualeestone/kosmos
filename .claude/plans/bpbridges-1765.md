# bpbridges-1765: the report bridges send a token only to a board that proves it holds it

Card: kosmos#1765. Stacked on boardproof-1765 (the board's proof route, the CLI's check, and the node gate
`mayCarryTokensTo`); merges after it. The first commit is Renet Tilley's; the rest are Ice Cream Kitty's, by agreement.

## What changes
- `bin/{agy,codex,gemini,grok}-report-bridge.js`: before every send that carries a token (the turn report, and the
  keep before a file edit), the bridge asks the listener to prove it holds that token, through the same fetch the
  send uses. Not proven: nothing is sent and the hook exits as normal (it must never fail the agent). An engine
  without `engine/boardproof.js` (older than the bridge) cannot check and sends as before.
- One deadline covers the proof and the send. The proof gets at most half the send's bound and the send gets what
  is left; nothing is sent when nothing is left. So the proof never lengthens a hook: the keep bounds (3 s) sit
  inside the CLIs' own hook cutoffs, and a CLI that times a hook out lets the edit run without its undo copy.
- `test-support/boardproof-stub.js`: a stub that stands in for the board answers the proof the way a real board
  does, for what that board would hold (the board token in the child's data root, the agent token the child
  carries, or the tokens a supervisor minted there). A token it does not hold gets the board's 404. The proof is
  answered before a stub records a request, so existing counts and `seen[0]` reads keep their meaning.

## Decided
- **Fail closed.** A refused proof sends nothing (Renet's call when he handed this over; the CLI refuses the same way).
- **Half the bound for the proof,** as the CLI gives its proof half of `-m`. Rejected: the proof's own 3 s default
  ahead of the send (measured: a hook held 5.8 s against a 3 s keep bound).
- **Stubs hold what the child inherits,** including an agent token from the environment running the tests. That
  token only keys an HMAC inside the test process and is sent nowhere new. Rejected: clearing the variable in every
  test, which changes what the existing tests exercise.

## Not covered (stated, not missed)
- A silent board costs a token-bearing report the proof's half of its budget instead of the whole budget, and
  nothing is sent. A report with no token asks for no proof and waits as before.
- The gap between the proof and the send (two requests), as on the CLI.
- Windows senders and the native app: tracked on the card.

## Tests
- `bridges.board-proof-1765.test.js`: all six send paths against a squatter (no token arrives) and a proven board
  (CONTROL: it arrives); per bridge, a proof answered just under half the bound and a keep that never answers end
  within the bound (CONTROL: the keep was attempted); and the same for both report paths (Codex notify, Antigravity
  report) as child processes, timed from the proof request so start-up is not counted.
- `engine.reachable.test.js`: the excuse for `mayCarryTokensTo` is removed, since the bridges call it. CONTROL: with
  every bridge's call hidden behind a computed name, the test goes red naming it.
- Mutants, each red: the gate removed from Codex's notify report; removed from Antigravity's report; the old timing
  restored in the Gemini bridge; and in both report paths (7260 ms and 2181 ms against 5750 and 1725).
- agyhooks #4043 runs with no agent token, as tools/run-tests.sh does, so its silent-board wait is the send's whoever
  runs it.
- The 26 test files that touch the bridges: 613 pass, 1 skip.
