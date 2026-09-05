# worldswitch-2238 - make the multiple-Kosmos switch actually work

## Card
kosmos#2238 (PRIORITY, Josh #3 structural): "create a Kosmos works but you can't select/go to it" (0.6.35 fresh install). Owner: Angel (#1704 worlds). This is the deferred 2b-iii (board-switch half); the engine endpoint POST /api/worlds/active landed as #2212 (2b-ii).

## Investigation (origin/main = the shipped 6.35 Josh has)
- The switcher UI (`worldswRender`, web/index.html ~15631) builds rows **read-only**: the comment says "row selection is deferred to slice 2b, so the only wired action here is New Kosmos." No click handler on `.worldsw-row`; the UI calls GET /api/worlds and POST /api/worlds (create) but **NEVER POST /api/worlds/active** (the switch). Confirmed: no branch wires `/api/worlds/active` from the UI; no open PR. -> **That is Josh's bug: selecting a world does nothing because the rows are inert.**
- POST /api/worlds/active (my #2212) records `activeWorldId` + returns `restartRequired: true`, but deliberately does NOT repoint the running board. server.js:24: a world's data-root env is applied ONCE at board start(), before engine modules freeze `store.ROOT`. So the running board keeps serving the world it booted with until it **restarts**.
- The installed board is a launchd KeepAlive job (`com.kosmos.board[.<hash>]`, install/setup.sh ~1284). `launchctl stop`/`kickstart -k` on a KeepAlive job respawns it (restart-local-board.sh relies on exactly this), and on respawn start() applies the now-active world's roots.

## Design - two slices

### Slice A (this branch): wire the switch UI + honest post-switch status
- The switcher is a **menu**; each non-active row is an actionable `menuitem` (keyboard-operable). Clicking it calls POST /api/worlds/active {id}. (ARIA: role=menu/menuitem, not role=list with a button child, which a blind review flagged as invalid list structure.)
- On 200 {ok, world, restartRequired}: mark the new row active (aria-current), update the promoted header name, and show an honest status banner: "Switched to <name>. Its projects and agents load the next time the Kosmos board restarts (run \"kosmos restart\", or restart your Mac)." No auto-restart button (see Slice B).
- Classify failures by the endpoint's contract: 404 (no such world -> refresh the list), 409 (another op in progress -> try again), 400/500 (honest error copy). Never innerHTML a world name (textContent only, matching the existing rows).

### Slice B: the board restart, so "go to it" completes -- DEFERRED as the #2238 follow-up
**A blind challenge review found my first Slice-B mechanism was WRONG, verified against the code:**
the installed board is NOT a launchd KeepAlive job. `install/setup.sh` sets its login plist to
**RunAtLoad with NO KeepAlive** ("`kosmos start` daemonises and exits, so it is a run-once job"),
and `install/kosmos` `cmd_start` daemonises the server via `nohup node app &` -- so launchd does
NOT own the running board process (it is a detached orphan), and `cmd_start` no-ops when the port
is already healthy. A `launchctl kickstart -k` therefore re-runs `kosmos start`, which sees the live
port and does nothing: the old board keeps serving the old world while the UI falsely reports success.

Restarting the installed board correctly needs a **detached `kosmos restart` helper** (stop the board
by pid, wait for the port to free, start a fresh one) PLUS a client **boot-token reconnect** (poll
until a NEW board's start token differs, not "any 200", or the client reloads into the pre-restart
board). Both are fleet-sensitive and only verifiable by a LIVE board restart on a real install --
which cannot be run on the shared box (it would restart the review board). So this slice ships the
switch + HONEST guidance and defers the auto-restart, rather than shipping a "Restart now" button that
silently no-ops (strictly worse than honest guidance). The removed endpoint/label/test were the wrong
mechanism; they are gone from this branch (server.js is unchanged vs origin/main).

## What ships on this branch (Slice A only)
- The switcher rows are actionable menuitems that POST /api/worlds/active {id}; the active marker +
  promoted name move; an honest status banner names the world and says it loads after a board restart
  (`run "kosmos restart", or restart your Mac`). No server change.

## Testable in-session vs not
- **Hermetic (headless render check `render-worldswitch-2238.js`):** row-click -> POST
  /api/worlds/active {id} -> active marker + header move -> honest banner shown. Control: the pre-fix
  page has no row click handler, so the POST-called + marker-moved arms red on it (perturbation-proven).
- **NOT in scope this branch:** the board restart (the #2238 follow-up above), verified on an install.

## Verify + ship
- render check (indexed + wired) green + perturbation-proven; full suite (web change trips the
  browser-check gate chain). challenge-loop to convergence. No em dashes. PR, no reviewer (Kosmos beta),
  merge on green. Leave #2238 open + note the auto-restart follow-up so "go to it" completes on install.
