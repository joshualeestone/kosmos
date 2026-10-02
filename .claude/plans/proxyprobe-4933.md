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

## Change (install/kosmos)
- With a proxy set, one direct probe of the board (curl --noproxy '*', -v, 1 s connect, 3 s total). Connected, or
  refused (nothing listening: loopback works, the board is down), keeps the exemption as before. Anything else
  (not permitted, a timeout) leaves loopback to the proxy and takes 127.0.0.1/localhost back OUT of NO_PROXY and
  no_proxy, since an exemption inherited from the board's own start would still bypass the only working route.
  The rest of the caller's list is kept. No proxy set: no probe, no change.
- KOSMOS_LOOPBACK_PROBE_URL: a test seam for the probe target.

## Decisions
- Once per CLI run, not per request: one wrapper and two raw curls would each need the fallback; a 1 s probe only
  happens when a proxy is set.
- Rejected: per-request "direct, then proxy on failure": a stopped board fails direct too and would then read the
  proxy's empty page as "another app" (the #4466 bug).
- Weakest premise: telling "refused" apart rests on curl's verbose wording ("Connection refused"); a curl that
  words it otherwise would read a stopped board as blocked and ask the proxy, which is the #4466 symptom, only when
  a proxy is set and the board is down. The stopped-board test pins this on the curl that ships with macOS.
- Not changed: the Windows CLI (node's http does not read proxy variables) and the agent bridges (node).

## Validation
cli.busy-health-4466.test.js: the #4466 arm (proxy answers empty, direct works) unchanged; a blocked arm (probe aimed
at a listener that never answers, a proxy that really forwards, the board's exemption inherited): status running
through the proxy and NO_PROXY left with only the caller's entry; a stopped board with a proxy set says not running
and never asks the proxy. Reverting the probe, the strip, or the refused rule each fails a test (measured). Every test
that runs install/kosmos (60 files, 1032, 0 failed) and its shell tests (test-install.sh skips without dist/, as on
main).
