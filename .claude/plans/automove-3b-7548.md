# automove-3b-7548: usage auto-balance slice 3b, the live mover (kosmos#7548, from #7152)

## The call (on the card, comment 6521685101)
Ship the mover with moves behind their own switch, `AGENT_WORKFORCE_AUTOMOVE=1`, OFF unless set. The day of recorded
decisions (10-29 12:08 to 10-30 06:3x CDT, 6 decisions on this Mac's board) raised sane at-risk flags (90 to 100%
weekly) and never proposed a move, because no agent on an at-risk account was movable (the fleet's agents always hold
open work). It never exercised a move, so moves stay an operator's switch.
- Rejected: moves on by default (the background-shell premise below is open); switching moves on for the fleet's
  board (it would never fire); waiting for more records (more of the same zero).
- Weakest premise: a mover tested only by tests and a page check is safe to ship OFF, because OFF never runs it.

## Shape: port the moving half onto main's sweep, do not merge the old branch
Main shipped slice 3 as `engine/autobalance-sweep.js` (record only, reviews 9 to 22). Branch `automove-live-7152`
(f33e2432c8) holds an older `engine/automove.js` that does sweep AND moves, with its own copy of the record reader,
writer and decision key. Merging it would leave two sweeps writing one record: two copies of one fact. So:
- `engine/automove.js` (new on this branch) is the MOVING half only. It reuses `autobalance-sweep.js`'s FILE,
  readLines and append, and writes its own line kinds into the same record: `move` (started, changed, partial,
  stopped, refused, unknown), `works` (yes, no, not-seen), `skipped`, `released`, `person`.
- It runs after the sweep's tick each period, only when `movesOn()` (AUTOMOVE=1 and not AUTOMOVE_OFF=1). It makes its
  own fresh `decide()` with `skipTarget` (held and unproven targets), so the RECORD's decisions stay the same rule
  Settings shows, and the mover never chooses a held target.
- The sweep's own decision lines are unchanged.

## What 3b must satisfy (main's plan, from rounds 1 to 8 of the live branch), and where each lands
1. One move per tick through the bulk move's own deps (accountmove.start with the route's deps, one function shared).
2. Two idle ticks, and a fresh roster AND projects re-check just before the move.
3. Usage only: never a move off a stopped login (its would-move lines stay in the record, never acted on).
4. No automatic move back.
5. A refused first request holds the target a day and tells the person in their thread with the agent.
6. One unproven agent per target (no second agent goes there while the first one's watch is open).
7. A person's move or Stop wins for a day, INCLUDING moves made through the routes (round 8: today they leave no
   trace the sweep reads). New: the account-move routes write a `person` line per agent moved, and the mover holds
   that agent for a day.
8. A moved agent rests a day (partial and unknown included).
9. A partial or unknown move takes no sighting as proof until the agent's session has restarted on the target.
10. Holds and watches rebuilt from the record at start; a `started` line with no ending becomes `unknown`.
11. A throw before setAccount is a refusal, after it unknown (round 8: needs accountmove to say which step threw).
12. "No longer idle" said only when idle-ness is what changed (round 8: a re-check that fails for another reason,
    a roster that cannot be read, writes nothing).
- Settings: `recent()` and the page draw the new line kinds (move, works, skipped, released), as the old branch did.

## Weakest premise for any move, unchanged
An agent at its prompt with a background SHELL job (a long validation, a monitor) reads idle, and a restart kills
the job. Two idle ticks narrow it; they do not close it. Moves go on by default only after the move can see the
agent's own child processes (slice 3c).

## Tests
Port `engine/automove-7152.test.js` from the old branch onto the new module (its 600 lines cover rules 1 to 10), add
tests for 7, 11 and 12, and a page check for the new lines (docs/browser-checks/render-autobalance-7152.js).

## Status (written as built)
- Built: engine/automove.js (moving half), decide() skipTarget, sweep appendAll + recent() drawing the mover's lines,
  accountmove.start's err.wroteAccount (rule 11), movableFor({ strict }) for the re-check (rule 12), server.js
  accountMoveDeps() shared by the bulk route and the mover (rule 1), person lines from both routes (rule 7),
  automoveDeps() and the mover run after the sweep's tick, Settings' `moving` flag and the page's new lines.
- Rule 9 goes further than the old branch: an uncertain watch takes sightings once the agent's session start reads at or
  after the move (deps.sessionStart), instead of never.
- Tests: engine/automove-7548.test.js (29), the 6173/6214 source pins re-aimed at accountMoveDeps() (perturbed: red
  without `hold:`), page check render-autobalance-7152.js gains `moving` and `movingOff`.
- Found while testing: a commitment unreadable at the re-check folded to "not free" inside movableFor, so the mover wrote
  "no longer idle" for a read failure. That is why `strict` exists.

## Review rounds (blind, models alternating)
- Round 1 (Sonnet): routes wrote person lines with moves off (now gated); a changed move now also waits for the
  restart before a sighting counts; the target re-check after decide() dropped (untestable duplicate); replay tests.
- Round 2 (Opus): no move the record cannot keep (writable pre-check); person lines read again just before the move;
  a person's move the record could not keep stops moves for a day; tmux whole-second starts; rule 12's other branches,
  route-order and inert-wiring pins. Settings' lines no longer add an inline capitalizer (web.open-sentence-1199).
- Round 3 (Sonnet): tests for an incomplete walk, the default account's walk and the released rest; refusals counted
  over the last day only. Left as they are, on purpose: personMissedAt is in memory (a restart forgets it; narrow,
  since an unwritable record already moves nobody); the first readPeople stays, so check() writes nothing on a record
  it cannot read; Settings says "moves them itself" while a tick is blocked.
- Full suite on the round 2 head under load ~200: 14 timeouts in untouched areas, all green alone; one real red
  (engine.reachable: the test-only reset export), fixed by naming it a ForTests seam and excusing it.
- Round 4 (Opus): a re-check that saw the agent working no longer counts toward the two idle ticks; the previous tick
  must be within PREVIOUS_TICK_MS (25 min, 2.5 sweep periods); one tick at a time (a tick past the backstop could drop
  a new watch); a move whose started or ending line was not kept stops moves for a day; route names trimmed; a
  "no longer idle" line at most once an hour per agent; the released line no longer claims the agent was moved.
  Left as it is: a Stop cannot land on the mover's own one-agent move (accountmove runs its first pass before
  returning), so the mover's `stopped` branch is unreachable today; it is kept because accountmove can change.
