# kosmos#9010: an account move asks the agent for its handoff first, and points the new session at it

## Call
Reuse #3492's "Write a handoff, then restart" pieces (engine/handoff-restart.js: the prompt, the freshness test, the
pickup line; server.js handoffFileSnap: the per-session path the auto-handoff sweep also uses). #3492's browser drives
those steps; a move restarts on the board, so the steps are driven there:

- engine/accountmove.js: an optional `handoffFirst` dep. Before each agent's restart: ask, then wait (at most 2 minutes,
  HANDOFF_WAIT_MS) for the file to be freshly written; restart either way (the card: a move is never kept back for it);
  after a RESTARTED restart with a saved handoff, the pickup line points the fresh session at it (not awaited). The
  move's sentence says which: wrote it and picks up; did not write it in time; or not asked, and why. A stop during the
  wait leaves the agent pending, so the move's tail puts it back rather than restarting it. Without the dep a move runs
  exactly as before (no extra await: the first restart still starts at once).
- server.js accountMoveDeps -> moveHandoffDeps(): ask via chat.deliverAsync (UNCONFIRMED counts as asked: it may have
  been typed); isFresh via handoffIsFresh on handoffFileSnap; pickup via chat.deliverAutomaticAsync (the moved note
  rides it, #5400). Not asked: an agent not running, and one OUT OF USAGE (the status card's state, rate_limited).
- AGENT_WORKFORCE_MOVE_HANDOFF_OFF=1 turns the step off (the card's control).

## Rejected
- Asking an agent that is out of usage: it cannot take a turn to write anything, and the usage mover moves exactly such
  agents. It is moved at once, and the move says why no handoff was asked for.
- Holding the move until the handoff exists: the card says the move goes ahead.
- A separate handoff location: one path per session, shared with auto-handoff and #3492.

Weakest premise: that 2 minutes is enough for a busy agent to finish its turn and write the file. A slow turn means
"not written in time", said plainly; the next session then starts cold, as today.

## Tests
- engine/accountmove-handoff-9010.test.js (6): written in time (ask, restart, pickup, in order, and the words); not in
  time (restarted anyway, no pickup, said); not asked (out of usage) said; an ask that throws never stops the move; a
  stop during the wait puts it back; CONTROL: no handoffFirst is the old move, word for word.
- server.move-handoff-9010.test.js (4): the wiring is on by default with every step; not running and out of usage are
  not asked, with the reason; CONTROL: the off switch.
- Existing move and auto-move tests (146) unchanged and green. Mutants: dropping the usage check, dropping the pickup:
  each fails its test.
