# roombusy-8769: a room read while Kosmos is busy shows the last copy held, with its age (kosmos#8769 item 4)

Card: kosmos#8769 item 4 (Angel's, with items 5 = PR #8771 and 6). Item 3 is Mona Lisa's.
Report: "Kosmos is running but too busy to answer (no reply in 20 s)" is honest, but the reader needed the room to
decide something. Ask: fall back to the last copy held, marked with its age, and say how long the board has been busy.

## Finished means
1. `kosmos room <project>` (plain read, no --unanswered / by-id filters) that times out on a busy board prints the last
   copy THIS reader got of THAT room, headed with when it was read ("from 4 minutes ago, Kosmos did not answer now"),
   and exits non-zero (the read did not happen). No copy held: the refusal as today.
2. It says how long reads have been failing: the time of the first failed read since the last good one ("Kosmos has
   not answered a room read since 18:02"), so a one-minute spell and a stuck board can be told apart. Said as what
   THIS computer saw, not as the board's state.
3. Both CLIs (install/kosmos cmd_room and tools/windows/kosmos-cli.js room), same sentences.
4. Tests: busy + copy held -> copy printed with its age, non-zero; busy + none -> today's refusal; a good read
   replaces the copy and clears the failing-since mark; a filtered read neither writes nor shows the copy.

## Design (decided; weakest premise below)
- Where: the CLI's data dir (AGENT_WORKFORCE_DATA), one file per (room, reader): name from the project id and a hash of
  the reader (agent token or "person"), so one agent never shows another reader's view. Mode 600, written atomically.
- Only the plain read is kept: filtered reads answer a different question.
- Busy means the curl timeout (the "too busy" arm, rc 28 / say_unreached's busy branch), not "not running" (healthy
  false keeps today's sentence: no board, so no fresh copy is coming either).
- Size: the server caps a read at 200 rows; the copy is whatever that read printed.

## Weakest premise
That a stale room is better than none for the reader. It can mislead if the reader skips the age line, so the age is
the FIRST line and the exit code is non-zero.

## Next steps (for a fresh session)
1. Find the busy branch: say_unreached in install/kosmos (rc 28 -> "too busy") and the Windows CLI's lastTimedOut arm.
2. Add the save after a 2xx plain read in cmd_room; the fallback in the rc != 0 arm when it is the busy case.
3. Windows parity; tests in a new cli.room-busy-8769.test.js (stub board that sleeps past -m) + the Windows test.
4. Review loop, proof, PR, merge after the 0.8.11 hold lifts.
