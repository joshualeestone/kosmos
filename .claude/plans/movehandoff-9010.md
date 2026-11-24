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

## Review 1 (opus): one BLOCKER, fixed
- BLOCKER: the pickup was typed as soon as the restart said RESTARTED (only the launch job loaded). Now the pickup waits
  for a session start other than the one read at the ask AND an idle card (as #3492's restartReadyWait does for the
  page), gives up after 3 minutes, and its answer is written back to the move's record ("could not point its new
  session at it: tell it to read its handoff").
- Out of usage also covers Claude Code's own usage-limit report (blocked + limitReported, autobalance's stoppedAtLimit)
  and a signed-out agent (auth_failed): none is asked.
- A saved handoff whose restart did not happen says "when it starts again, tell it to read its handoff". An agent asked
  and then not restarted (a stop, a failed restart) is told to carry on (handoff-restart.carryOnPrompt); a stopped one
  stays held until its put-back settles.
- The file counts as written once it is fresh AND unchanged since the previous look (a handoff written in edits).
- The words reach a person: the move's view carries `handoff`; Settings says "No handoff written in time (names)"; the
  automatic mover's notice adds what happened to the handoff. Settings' polling window grew by the 120 s wait.
- Comments: the move's total bound (67.5 minutes) and stop() during the wait.
KNOWN, stated: a bulk move of many busy agents now spends up to 2 minutes each before its restart, so its 60-minute cap
reaches fewer agents (about 25 busy ones); the automatic mover moves one per tick and is unaffected.

## Review 2 (sonnet): no BLOCKER
- A new session is one whose start differs from the ask's AND came after the ask (an unreadable start at the ask cannot
  let the old session pass; tested, mutant caught). A new session busy from the start is typed to at the deadline.
- The words say "will be pointed at it once it is up" until the pickup answers, then "is pointed" or "could not point".
- After a saved handoff, a restart that did not answer RESTARTED gets a line true either way (maybeRestartedPrompt): it
  may or may not have happened. "Carry on" is only for the person's stop.
- The ask is bounded (30 s); a file fresh at the deadline but not yet seen settled counts as saved.
- KNOWN, stated: the agent is released once its restart answers, so the pickup's wait is unheld; moves run one at a time
  and the automatic mover rests a moved agent for a day, so another restart in that window is a person's own.

## Review 3 (opus): one BLOCKER, fixed
- BLOCKER: on Windows no session start can be read (it is read from tmux), so the pickup never found a new session.
  Where no start is readable, it now waits as #3492's restartReadyWait does: a not-ready look after the ask, then idle;
  with no gap seen, idle only after 20 s. Tested both ways.
- A failed pickup no longer also says "picks up". An agent asked, not saved and not restarted gets the true-either-way
  line too (without a path). A stop during the handoff wait is said as such in Settings (waitingForHandoff). Both CLIs
  wait 450 s for a move (the restart's 300 plus the handoff); the Windows CLI's pinned test moved with it. An agent
  not running adds no handoff clause (the move's words already say it).
- NOT changed: the pickup's { cap: false } (a Gemini working-at-once cap is a person's; an automatic move skips it as
  #3492's pickup does): noted.

## Rejected
- Asking an agent that is out of usage: it cannot take a turn to write anything, and the usage mover moves exactly such
  agents. It is moved at once, and the move says why no handoff was asked for.
- Holding the move until the handoff exists: the card says the move goes ahead.
- A separate handoff location: one path per session, shared with auto-handoff and #3492.

Weakest premise: that 2 minutes is enough for a busy agent to finish its turn and write the file. A slow turn means
"not written in time", said plainly; the next session then starts cold, as today.

## Tests
- engine/accountmove-handoff-9010.test.js (9, after review 1: also a handoff written in edits, a pickup that does not
  land, a restart that did not happen after a saved handoff): written in time (ask, restart, pickup, in order, and the words); not in
  time (restarted anyway, no pickup, said); not asked (out of usage) said; an ask that throws never stops the move; a
  stop during the wait puts it back; CONTROL: no handoffFirst is the old move, word for word.
- server.move-handoff-9010.test.js (8, after review 1: also blocked-at-limit and signed out, the ask's real prompt and
  path, freshness against a real file, the pickup waiting for the new idle session, and giving up): the wiring is on by default with every step; not running and out of usage are
  not asked, with the reason; CONTROL: the off switch.
- Existing move and auto-move tests (146) unchanged and green. Mutants: dropping the usage check, dropping the pickup:
  each fails its test.
