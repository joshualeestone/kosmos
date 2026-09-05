# worldswitch-2238 - make the multiple-Kosmos switch actually work

## Card
kosmos#2238 (PRIORITY, Josh #3 structural): "create a Kosmos works but you can't select/go to it" (0.6.35 fresh install). Owner: Angel (#1704 worlds). This is the deferred 2b-iii (board-switch half); the engine endpoint POST /api/worlds/active landed as #2212 (2b-ii).

## Investigation (origin/main = the shipped 6.35 Josh has)
- The switcher UI (`worldswRender`, web/index.html ~15631) builds rows **read-only**: the comment says "row selection is deferred to slice 2b, so the only wired action here is New Kosmos." No click handler on `.worldsw-row`; the UI calls GET /api/worlds and POST /api/worlds (create) but **NEVER POST /api/worlds/active** (the switch). Confirmed: no branch wires `/api/worlds/active` from the UI; no open PR. -> **That is Josh's bug: selecting a world does nothing because the rows are inert.**
- POST /api/worlds/active (my #2212) records `activeWorldId` + returns `restartRequired: true`, but deliberately does NOT repoint the running board. server.js:24: a world's data-root env is applied ONCE at board start(), before engine modules freeze `store.ROOT`. So the running board keeps serving the world it booted with until it **restarts**.
- The installed board is a launchd KeepAlive job (`com.kosmos.board[.<hash>]`, install/setup.sh ~1284). `launchctl stop`/`kickstart -k` on a KeepAlive job respawns it (restart-local-board.sh relies on exactly this), and on respawn start() applies the now-active world's roots.

## Design - two slices

### Slice A (this branch): wire the switch UI + honest restart-required state
- Make `.worldsw-row` clickable (button semantics + keyboard). Clicking a NON-active row calls POST /api/worlds/active {id}.
- On 200 {ok, world, restartRequired}: mark the new row active, update the promoted header name, and show an honest "Switched to <name>. Kosmos needs to restart to load its projects and agents." state with a **Restart now** action.
- Classify failures by the endpoint's contract: 404 (no such world -> refresh the list), 409 (another op in progress -> try again), 400/500 (honest error copy). Never innerHTML a world name (textContent only, matching the existing rows).

### Slice B (this branch): the board self-restart, so "go to it" actually completes
- New endpoint **POST /api/board/restart**: respond 200 first, then schedule a clean board exit so launchd respawns it into the now-active world. Guard: only meaningful when the board runs under a launchd KeepAlive job; on a non-launchd board return a clear "restart Kosmos yourself" signal rather than exiting into no respawn.
- "Restart now" (Slice A) calls it, then the UI polls GET /api/worlds until the board answers again and reloads into the new world.

## What is testable in-session vs not (stated honestly)
- **Hermetic (headless render check):** row-click -> POST /api/worlds/active called with the right id -> active marker + header move -> restart-required state shown; a stubbed 404/409 shows the right copy. This is the #2190/#1921 pattern.
- **Unit (no live restart):** the /api/board/restart handler responds 200 and INVOKES the restart path (stub the exit/launchctl shim; assert it was called with this board's label, and that a non-launchd board returns the no-respawn signal instead of exiting).
- **NOT exercised in-session (fleet-sensitive):** an ACTUAL board restart booting into the new world. Restarting `com.kosmos.board` on the shared dev box blips Josh's review dashboard; in the PRODUCT each user has their own board so it is correct. Verify the live restart-into-new-world on an install (Josh's fresh Mac), not on the shared box. Documented as the one un-in-session step.

## Fleet-box caveat (do not lose)
A switch-triggered board restart is fleet-affecting ONLY on the shared dev box, and only if someone switches worlds there (not a normal fleet op). In the product it is a per-user board. The endpoint restarts THIS board's launchd label only.

## Verify + ship
- Hermetic render check `render-worldswitch-2238.js` (indexed + wired) + the /api/board/restart unit test, both green; full suite (web change trips the browser-check gate chain - re-run the whole suite). challenge-loop to convergence. No em dashes. PR, no reviewer (Kosmos beta), merge on green. Leave #2238 open + ready-to-test until the live restart-into-new-world is confirmed on an install.
