# noproxy-4466: a proxy in the environment must not hide (or kill) the board (#4466 follow-up)

## The report (on #4466 and #4569, via Splinter 2026-09-29 11:06)
A real agent's sandbox is proxy-only (http_proxy / HTTPS_PROXY / ALL_PROXY set). curl sends even
127.0.0.1 through the proxy, which answers `GET /` with an empty page, so the CLI's health check never
passes: a running board reads as a stranger ("another app is using port"), and start refuses.

## What it also exposed (found while reading the start path)
cmd_start's #3079 reclaim (older than #4466) kills a same-user Kosmos listener that does not answer. Under a
proxy, that is a HEALTHY board it cannot reach: a plain `kosmos start` in such a sandbox would kill it.

## Changes
1. `install/kosmos`, next to `URL=`: prepend `127.0.0.1,localhost` to NO_PROXY and no_proxy (curl reads either)
   unless already there, and export them. Every loopback request (29 direct curl calls plus kosmos_curl) skips
   the proxy; outside requests still use it; the caller's own list is kept.
2. `_listener_is_our_board`: the port's listener is the live pid in board.pid. Then:
   - `start` says "already running ... did not answer this command" (plus the person-only hint) and returns 0,
     BEFORE the #3079 reclaim, unless KOSMOS_RECLAIM_BUSY=1 (the watchdog and the installer keep their reclaim).
   - `status` in its stranger branch says running (process N) and exits 4, like busy (the watchdog's grace).

## Tests (cli.busy-health-4466.test.js), each red on #4539's code
- a stub proxy that answers everything with an empty 200, and http_proxy/HTTPS_PROXY/ALL_PROXY pointed at it:
  `status` reports running and the proxy sees ZERO requests; a caller's NO_PROXY is kept (loopback prepended).
- stubbed probes: listener == board.pid -> status exit 4 "running (process 4242)", start "already running" and
  never reclaims (kill is stubbed and must not be called); control: a different listener pid still gets the
  stranger sentence.

## Review round 1 (opus): 1 WARNING + 5 NITs, all fixed
- W: the KOSMOS_RECLAIM_BUSY bypass of the new start guard had no test (the watchdog's reclaim arm uses a
  busy board, which never reaches this guard). Now: the same stubs plus the flag must reach "Reclaiming it"
  and call the stubbed kill. Red with the condition dropped.
- NIT: the stubbed listener uid was 501, so the kill arm was only live on a uid-501 box; now `id -u`.
- NIT: start's `rc=0` is asserted.
- NIT: `agent_board_guard` now reads a listener that IS the recorded board as up, so an agent's start neither
  goes on nor spends the start claim. Red with that line removed.
- NIT: the #3079 comment names the new precondition; the NO_PROXY comment says the export reaches the board
  and its agents too (only loopback is added).

## Weakest premise
Only curl honours NO_PROXY here; any future non-curl loopback client in this script (none today) would need
the same. And board.pid must be current: a board started outside this command (no pidfile) still reads as a
stranger under a proxy, but change 1 removes the proxy from that path anyway.

## Status
- [x] fix + both arms red-checked; cli 229/229; #3079 reclaim 12/12
- [x] review round 1 fixed (reclaim bypass + agent-claim arms, red-checked)
- [x] rebased onto main after #4539; challenge loop CONVERGED at iteration 2 (sonnet, zero NEW); ships in ONE PR with sendsafe-4466 (see that plan's Status and the sendsafe proof)
