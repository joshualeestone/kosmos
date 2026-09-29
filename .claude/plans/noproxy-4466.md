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

## Weakest premise
Only curl honours NO_PROXY here; any future non-curl loopback client in this script (none today) would need
the same. And board.pid must be current: a board started outside this command (no pidfile) still reads as a
stranger under a proxy, but change 1 removes the proxy from that path anyway.

## Status
- [x] fix + both arms red-checked; cli 229/229; #3079 reclaim 12/12
- [ ] rebase onto main after PR #4539 merges; challenge loop; full suite once; PR; merge before the 0.7.10 freeze
