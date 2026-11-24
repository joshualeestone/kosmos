# kosmos#9010: an account move asks the agent for its handoff first, and points the new session at it

## Call (what the code does now)
Built from #3492's "Write a handoff, then restart" pieces (engine/handoff-restart.js: the prompts and the freshness test;
server.js handoffFileSnap: the per-session path that auto-handoff also uses). #3492's browser drives those steps; a move
restarts agents on the board, so the board drives them here.

engine/accountmove.js, with the optional `handoffFirst` dependency, for each agent before its restart:
1. **Ask.** The ask and the wait share one 2-minute budget (HANDOFF_WAIT_MS). The move does not restart while the ask is
   still on its way within that budget, because a delivery cannot be cancelled and one typed after the restart would ask
   the new session. If the budget runs out first, the agent is "not asked: we could not reach it". If such an ask then
   lands late, the agent gets the line that is true either way.
2. **Wait for the file.** It is "settled" when the file is fresh, unchanged since the previous look, and the agent is not
   busy (any card state but idle). At the deadline, a fresh file counts whether or not it has settled.
3. **Restart either way.** A stop during the wait puts the agent back without restarting it. It stays held until the put-
   back settles, and it is told to carry on (carryOnPrompt).
4. **After a RESTARTED restart with a saved handoff, the pickup.** The server waits for a NEW session (its start differs
   from the one read at the ask, and came after the ask) and an idle card. Where no session start can be read (Windows),
   it waits for a not-ready look and then idle, or idle after 20 s. A new session that is busy from the start is typed to
   at the deadline, unless it cannot take a turn. The answer is written back to the move's record. A pickup that did not
   land is also written into the agent's chat for the person (pickupMissedNote).
5. **After a restart that did not answer RESTARTED, when the agent was asked:** the line that is true either way
   (maybeRestartedPrompt), with the path only if it was saved.

Not asked (moved at once): an agent not running (no clause added, since the move's words already say it); one whose
card reads rate_limited or auth_failed (it cannot take a turn now). A blocked card with a usage-limit report IS asked,
because that report can be hours stale.

The move says what happened: its sentence, its view (`handoff`), Settings ("No handoff written in time (...)", "Not asked
for a handoff (...): why", and a stop during the wait said as such), and the automatic mover's notice. The page and both
CLIs wait 510 s per agent. AGENT_WORKFORCE_MOVE_HANDOFF_OFF=1 turns the step off (the card's control).

## Rejected
- Asking an agent that cannot take a turn: it is moved at once, with the reason.
- Holding the move until a handoff exists: the card says the move goes ahead.
- autobalance's stoppedAtLimit as the "out of usage" rule: it answers whether a limit is worth a move (false when the
  reset is soon or unknown), not whether the agent can take a turn now.
- A second handoff location: one path per session, shared with auto-handoff and #3492.

## Known limits, stated
- On Windows, a status still showing the old session busy and then idle passes as the gap the pickup waits for (the same
  weakness #3492's page wait has); only a readable session start would close it.
- The ask's own turn end lets held room posts be typed into the old session just before its restart, as after any
  restart that follows a turn end.
- The agent is released once its restart answers, so the pickup's wait is unheld; moves run one at a time, and the
  automatic mover rests a moved agent for a day.
- A bulk move of many busy agents spends up to 2 minutes on each before its restart, so the move's 60-minute cap reaches
  fewer of them. The automatic mover moves one agent per tick.

Weakest premise: that 2 minutes is enough for a busy agent to finish its turn and write the file. If not, the move says
so, and the new session starts cold, as it does today.

## Review rounds (8-round cap)
1 opus: a BLOCKER, fixed (the pickup was typed before the new session was up); also the unreadable-usage states, the
words reaching a person, carry-on, settling, the page wait. 2 sonnet: what counts as a new session, the either-way line,
a bounded ask. 3 opus: a BLOCKER, fixed (the Windows pickup); a failed pickup's words; the stop wording; the CLI waits.
4 sonnet: no typing at the deadline to a session that cannot take a turn; a late ask. 5 opus: the ask inside the budget;
the person told of a pickup that did not land; Settings names agents not asked. 6 sonnet: busy beside freshness. 7 opus:
the not-running clause, the out-of-usage rule, page tests, stale comments, this plan.

## Tests
- engine/accountmove-handoff-9010.test.js (17): order (ask, restart, pickup); not in time; not asked; a throwing or
  never-answering ask; a late ask; no restart while the ask is in flight; a stop puts it back, keeps it held and tells it to
  carry on; a handoff written in edits; busy never settles but counts at the deadline; a pickup that did not land; a
  restart of unknown outcome; not running adds nothing; CONTROL: no handoffFirst gives the old move word for word.
- server.move-handoff-9010.test.js (14): the wiring and the off switch; not running, signed out, a stale limit report
  asked; the real prompt and path; freshness and busy against a real file; the pickup's new-session rules (start after the
  ask, an unreadable start, Windows gap and minimum wait, busy at the deadline, cannot turn at the deadline, never up and
  the person told).
- web.account-bulkmove-6173.test.js: the Settings handoff lines. cli.agent-move-8048.test.js: the 510 s wait.
- 225 move, auto-move, CLI and page tests green. Mutants named in the proof each failed their test.
