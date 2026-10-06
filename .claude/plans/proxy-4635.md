# proxy-4635: in a shell with a proxy set, kosmos start never kills a healthy board and status reports running

Card: kosmos#4635 (priority bug, #4580 items 6 and 10): "In a shell with a proxy set (lowercase http_proxy or ALL_PROXY), 'kosmos start' kills a healthy board as 'your own stale Kosmos', and status says it is not running."

## Finished looks like
- In a shell with a lowercase `http_proxy`, `all_proxy`, or `ALL_PROXY` pointing to a dead proxy:
  - `kosmos status` reports running (exit 0) and gives no start advice.
  - `kosmos post` posts successfully.
  - `kosmos start` says the board is already running and leaves the live process alive, as a person and as an agent.
- A control with the fix removed proves the original bug kills the board as "stale Kosmos".
- Belt and braces: if the health probe cannot read the board (proxy bypass removed), the second guard (`_listener_is_our_board`) still prevents start from killing the process.
- Watchdog recovery: a truly hung board is still reclaimed by `KOSMOS_RECLAIM_BUSY=1` with or without a proxy; a person's start on a hung board says busy and leaves it alone.
- Diagnostic N13 (#4933) integration: in a proxy-only sandbox where direct loopback is blocked, loopback calls route through the forwarding proxy to the board.

## Cause
- curl sends 127.0.0.1 through lowercase `http_proxy` or `ALL_PROXY` unless `NO_PROXY` names 127.0.0.1 (`localhost` alone does not help).
- Health probe got curl exit 7 (refused) and set `HEALTH_STATE=down`.
- `cmd_start` then checked `port_has_listener` using `lsof` (unaffected by proxy), found our own Kosmos process on the port, and `_kosmos_reclaim_decision` said reclaim: the healthy board was killed as stale.
- The agent board guard asked the same failing health probe, read down, and let an agent's start through as recovery, killing the board.

## Architecture and verification
- `install/kosmos` prepends `127.0.0.1,localhost` to `NO_PROXY` and `no_proxy` and exports them, preserving any caller-provided entries (e.g. `no_proxy=corp.example`).
- `kosmos_loopback_route` probes direct loopback with `--noproxy '*'` (1 s connect, 1.2 s total). When direct loopback connects (including when a dead proxy is exported in the environment), calls route direct. When direct loopback is blocked and a proxy forwards a Kosmos health body, calls route via proxy (`--noproxy ''`).
- `cmd_start` guards the reclaim: before any reclaim kill, `_listener_is_our_board` verifies whether the listener pid matches `running_pid` (`board.pid` with `app/server.js`). If so, start prints that Kosmos is already running and exits 0.
- `cli.proxy-4635.test.js` exercises the complete matrix against real stub board processes in independent process trees.

## Decisions
- Dedicated suite `cli.proxy-4635.test.js` pins the card's exact acceptance criteria, including real child processes, control with unfixed code killing the board, second guard isolation, hung board recovery, and diagnostic N13 route integration.
- Windows CLI is unaffected: Node http does not read environment proxy variables without explicit configuration.

## Weakest part
- The second guard checks `running_pid`, which reads `board.pid` and matches `app/server.js` in process command output. If an old process died and its pid was recycled within a narrow race by another `app/server.js` process of the same user, it would be treated as our board.
