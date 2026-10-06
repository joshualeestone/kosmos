# gatesnap-5247: the board gate accepts other worlds' tokens only for worlds it knew at start or made itself (#5247)

**Finished means:** the main dispatch gate's multi-world token acceptance (#3055) can no longer be widened by a file
written after the board started: only worlds in the start-time snapshot, plus worlds the board's own create route
made, count; a world hidden since start stops counting. Hardening after #4491 / PR #5122 (Ice Cream Kitty's option B).

## Change (server.js)
- `snapshotWorlds()` in start(): KNOWN_WORLD_TOKENS = each listed world's id and its board.token AS READ NOW (null if
  it has none yet), so neither a registry entry nor a token file written later widens acceptance (review round 1). Before start: null, so only the
  active token is accepted (fail-closed, as when the registry is unreadable).
- `boardTokenOk`: the per-request registry read is kept (hiding narrows) but tokens come from the snapshot, not disk.
- the create-world route calls `knowWorld(world.id)`: recorded with no token (it has none until its own board boots,
  a new process with its own snapshot).
- A world switch restarts the board (#2346), so the switched-to board snapshots then; #3055's post-switch cookie case
  (the world just left) is in that snapshot.

## Decided
- Option 1 (snapshot) over option 2 (refuse multi-world for agent-marked requests): an agent that wrote a token would
  present it without a marker, so a marker test would not close it.
- Rejected: drop multi-world acceptance (breaks #3055's post-switch browser).

## Weakest premise
That nothing else on the Mac legitimately creates a world and then expects THIS running board to accept its token
without a restart (a CLI or second process writing the registry directly). Such a world is accepted after the next
board start; until then its token gets a 403 at this board's gate, which is the safe direction.

## Tests
server.board-auth-worldswitch-3055.test.js: setup writes the registry BEFORE start (as on a real Mac); new: a world
added after start is refused (with a same-state control), a board-made world (knowWorld) is accepted, a world hidden
since start is refused, wiring pinned. Mutant (filter removed) turns two red. 81 related files + guards: 1163 pass,
0 fail.

## After Ice Cream Kitty's review (approved for after Monday)
- The snapshot is as of board START: a token written before a restart is what the next board snapshots. #4491's
  write protections (PR #5122) stop a token-only agent writing one, so the two layers work together; this one alone
  does not cover a restart.
- Hiding is not revoking: a world hidden after start and later un-hidden (by hand; there is no un-hide) counts again
  with its start-time token.
