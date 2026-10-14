# #6174: an agent mid-move is marked as still on its old account until it restarts

Owner: Angel. 2026-10-14 16:05 CDT. Follow-up named in the #6108 plan ("After a 'partial' move the server already lists
the agent under the new account, though it still runs on the old one until it restarts").

## Finished looks like
In Settings, AI Models, an agent moved to another account whose process is still running on its old account (the move
came back partial because its window could not be closed) is listed under the account it was moved to, with "(still on
its old account until it restarts)" after its name. Once it restarts onto the new account the marker goes, because its
running process then reads the new account. Every other agent reads as before.

## How (review 1 replaced the first design)
- The move route (POST /api/agent/:name/account) reads the agent's tmux session start before its restart attempt. If
  the move comes back partial and the SAME session is still running (same start), it notes it in account-moving.json
  (engine/accountmoving.js); a full restart clears the note.
- `claudeAgentsByAccount().moving(dir, isDefault)` lists the agents on that row whose current session is still the
  noted one; another session (restarted onto the new account) clears the note, no session or an unreadable one marks
  nobody. `GET /api/accounts?agents=1` sends `agentsHere.moving`; the page appends the marker.

## Decided
- Option (b), mark on the new row, not (a), list under the running account: only one cause of a partial move (the
  window could not be closed) leaves the agent running on the old account; a stopped agent, or a failed relaunch,
  runs nowhere and the new row is right for it.
- Rejected (review 1): reading every agent's process environment (runningas) on this route. A failed environment read
  falls back to the default account and would mark agents wrongly, the read blocks the board per pane, a default-
  account agent inherits the tmux server's environment, and on Windows it costs a read that can mark nobody. The
  session start is one cached tmux read and the move route knows the exact case.
- Compare the exact session start, not a time window: a restart that did relaunch the agent but still reported
  partial is a different session and is never marked.

## Not done
- (review 2, accepted) macOS refusing to stop the launch job after the window closed (restartInner's bootout-refused
  partial): launchd may respawn the old job later under a new session, which the note cannot see; restartInner itself
  accepts that case.
- (review 2) A note for an agent that is then removed stays in account-moving.json until a reused name's different
  session clears it: a few bytes, never a wrong mark.
- The disconnect guard (enumerateAgentsOnAccount) still counts launch files only, so it does not see an agent still
  running on the account being removed until it restarts. Separate card if wanted.
- No marker on the old account's row ("X still runs here until it restarts"); the marker on the new row says it.

## Weakest premise
That a partial move whose window could not be closed leaves the same tmux session running (same session start). Read
from remove.js restartInner, not measured on a real partial move. A restart path that recreates the session under the
same name without the agent moving would clear the mark early (safe direction).
- (review 2) The read after the restart is fresh (status.sessionStartedAtFromTmux opts.fresh: no cache read or write),
  so other readers keep their two-second cache; the note is keyed on the cleaned name, the roster's spelling; the
  route-side note is tested through the session seam (same, new, none, unread, full restart).
- (review 3) The session is found as remove.js sessionFor finds it (the roster card tied to the agent), so legacy
  `name-discord` sessions are read and a bystander sharing the name is not; only a PARTIAL outcome notes (a REFUSED
  restart never does); the note keeps the account the agent ran on before its first partial move, so moving it back
  there is not marked. Tests drive restartForMove with injected readers (start read before the restart, each outcome).
- Not testable through the seam: the fresh read (the session seam never caches), so it is covered by reading only.
- Windows, or any machine where tmux cannot be read: no session start, so nobody is ever marked there.
- (review 4) The list is read-only: a stale note never marks (it needs the very same session), and only the move
  route clears, so a page read cannot race a move's write; the notes file is read once per row and agents with no note
  cost nothing. The mark reads the tmux session, not the process: a process relaunched inside the same session would
  stay marked (unmeasured; restartInner kills the session). A default-account agent moved away and back is tested.
