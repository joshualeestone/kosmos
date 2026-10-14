# #6174: an agent mid-move is marked as still on its old account

Owner: Angel. 2026-10-14 16:05 CDT. Follow-up named in the #6108 plan ("After a 'partial' move the server already lists
the agent under the new account, though it still runs on the old one until it restarts").

## Finished looks like
In Settings, AI Models, an agent moved to another account whose process is still running on its old account (the move
came back partial because its window could not be closed) is listed under the account it was moved to, with "(still on
running on its old account)" after its name, while that same session runs. Once it has restarted the marker
goes. A restart that came from the still-loaded old launch job (a crash, the agent exiting) can still be on the old
account and is then unmarked: under-marking, never a wrong mark (review 9). Every other agent reads as before.

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
- (review 8, decided) macOS or systemd refusing to stop the old job after the window closed is NOT marked. Reviews 5-7
  tried noting the session running right after (an oldJobHeld flag from restartInner): review 6 found it rarely
  exists yet, review 8 found it can be a genuine relaunch onto the new account, marked wrongly with nothing to clear
  it. Removed (remove.js is unchanged from main). That partial stays unmarked, the safe direction.
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
- (review 4, superseded by review 8) The list was read-only; it now prunes through clearIf (see below).
  The mark reads the tmux session, not the process: a process relaunched inside the same session would stay marked
  (unmeasured; restartInner kills the session). A default-account agent moved away and back is tested.
- (review 5) The default row also compares a note's `from` with its own folder (an agent whose launch file names the
  default folder by path); the from-account read cleans the name first (moveFromDir), and is not exercised by a test
  (the route's other reads are; the helper is a one-line readJob).
- (review 6) The held-job case is noted only if the held job's session already exists right after the restart;
  usually it does not yet, so this case is usually unmarked (safe direction). Rejected: adopting the next session
  later, because a manual Restart (not the move route) would then leave a lasting wrong mark. The pane roster is read
  once per row, only when an agent on it has a note. oldJobHeld is pinned false for a stop launchd accepted.
- (review 8) A list read prunes a note whose session is readably another (clearIf: only that exact note, so it cannot
  race a move that just wrote a new one); a note with no readable session is kept. Both session reads in the move route
  are fresh. restartForMove passes the cleaned name to removal.restart (restartInner cleans it again; no change).
- (review 11, wording superseded by review 12) The page said "restart it to finish the move": a restart the never-booted-out old job makes by itself
  stays on the old account, so only a Kosmos restart finishes it. The list prunes only after a FRESH read confirms a
  different session. `from` is the launch file's account, so two partial moves in a row can mark an agent already on
  the row's account (stated in the module header). The route test pins that `from` is read before setAccount.
- (review 12) The marker states only the fact, "(still running on its old account)": whether a Kosmos restart
  finishes the move is unmeasured, so the page does not promise it. The notes file's read-change-write has no lock
  (a lost write under-marks or leaves a leftover); the header says so rather than claiming atomicity.
- (review 13) The list reads the session start fresh for an agent with a note (a 2 s cached read could mark an agent
  that just restarted); the header lists every over-mark case together.
- (review 14, decided, no change) Marker wording kept as "(still running on its old account)": it states the very
  likely state; the rare over-mark cases are listed in engine/accountmoving.js. Rounds 11, 12 and 14 each moved the
  wording (promise, fact, then "has not restarted"); further rotation is churn, not a fix. The fresh read costs one
  tmux read per noted agent per ?agents=1 list, only while a note exists; accepted. The unlocked notes file was
  stated in round 12.
