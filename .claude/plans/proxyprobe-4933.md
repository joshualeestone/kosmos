# proxyprobe-4933: skip the proxy for loopback only when direct loopback works

Card: kosmos#4933 (0.7.15 five-family diagnostic, item N13, Meta family): "The new proxy exemption sends loopback calls
past the proxy and assumes direct loopback works. In a proxy-only sandbox direct loopback is refused while the proxy
forwards fine, so stock status, reply and post all say Kosmos is not running."

## Done looks like
In a sandbox where direct loopback is blocked and the proxy forwards, the kosmos CLI reaches the board through the
proxy (status says running); where direct loopback works, nothing changes from #4466 (loopback skips the proxy); a
stopped board still reads as stopped, never as "another app".

## Measured
- The exemption (install/kosmos, #4466) added 127.0.0.1,localhost to NO_PROXY/no_proxy unconditionally and exported
  it, so the board and every agent session inherit it.
- curl 8.7.1 says only "Couldn't connect to server" (exit 7) for every connect failure; its verbose line names the
  errno ("connect to 127.0.0.1 port 9 ... failed: Connection refused").

## Change (install/kosmos), as rebuilt after review 1
- The #4466 exemption and its export are UNCHANGED (the board and every agent inherit it as before).
- kosmos_loopback_route: before this run's first call to the board (kosmos_curl and the two health reads), and only
  when a proxy curl uses for http:// is set (http_proxy, all_proxy, ALL_PROXY), one direct probe (1 s to connect, 2 s
  in all, curl -v, LC_ALL=C), memoised for the run:
  - "Connected to": direct (a busy board connects and then waits; review 1 found the first version read it as blocked);
  - anything else (refused, not permitted, a connect timeout): one request through the proxy; only a Kosmos health
    body ("app":"kosmos") picks the proxy. Review 2: without that proof on EVERY arm, a saturated board timing out
    behind a corporate proxy would have sent the board and agent tokens to that proxy. An unproven "direct" is not
    remembered, so kosmos start asks again once the board is up. The probe is 1.2 s at most.
- The proxy route is PER CALL: curl --noproxy '' (measured: it overrides NO_PROXY and uses the proxy), on the CLI's
  own three curls. Nothing in the environment is rewritten (review 1: a stripped list would have reached every agent).
- KOSMOS_LOOPBACK_PROBE_URL: a test seam for the probe target.

## Decisions
- Lazy and per call. Rejected after review 1: a top-level probe on every verb (help and report paid it) and stripping
  NO_PROXY (exported to agents, and missed forms curl still honours).
- Weakest premise: the classification reads curl's verbose wording ("Connected to", "refused"), pinned on macOS curl
  8.7.1 by the tests; a curl that words it otherwise falls to "blocked" (the proxy), which is only wrong when a proxy
  is set and the board is reachable directly.
- Not changed: the Windows CLI (node's http does not read proxy variables) and the agent bridges (node).

## Validation
cli.busy-health-4466.test.js: the #4466 arm unchanged; blocked (status and a post both through a forwarding proxy, the
exported exemption untouched); busy (direct, the proxy never asked); network namespace (refused, the proxy forwards to
the board: the proxy); stopped (refused, the proxy answers empty: direct, "not running"). Reverting the connected
rule, the proxied check either way, or the route on the health read or on kosmos_curl each fails a test (measured).
Every test that runs install/kosmos (60 files, 1034, 0 failed) and its shell tests.
