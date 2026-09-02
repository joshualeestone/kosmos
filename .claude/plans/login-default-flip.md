# login-default-flip: make login.kosmosplus.com the default coordinator

## The ask

Josh, 2026-08-30 in Discord: he wants `login.kosmosplus.com`, not
`coordinator.kosmosplus.com`. Splinter routed it to me and cleared the change.

## Why this is safe, measured rather than assumed

`login.kosmosplus.com` and `coordinator.kosmosplus.com` are the SAME coordinator
box. Re-verified `/v1/meta` on both, twice (me, then Splinter independently):

    login.kosmosplus.com        build 63c798d  pubkey 44q9RlCh...  TLS valid
    coordinator.kosmosplus.com  build 63c798d  pubkey 44q9RlCh...  TLS valid
    CONTROL zzz-not-a-host      fails to resolve (so the probe can say no)

Same build, same PINNED pubkey, each host with its own valid cert. The client
pins the coordinator's pubkey (an application-layer pin), which is identical on
both hosts, so switching the hostname is transparent to the pin and to TLS.

## What changes, and what deliberately does NOT

Changed:
- `engine/remote.js` `DEFAULT_COORDINATOR` -> `https://login.kosmosplus.com` (the
  primary: what a fresh install enrolls against), plus its docblock.
- `engine/remote.test.js` two assertions that pinned the old default (the
  `DEFAULT_COORDINATOR` equality and the `--coordinator` spawn-arg match; the
  second is the one a single-assertion edit would have missed, and the suite
  caught it).
- `install/setup.sh` the uninstall/retire fallback default, for consistency, so
  the installer and the client agree on the same default host.

NOT changed, deliberately:
- `coordinator.kosmosplus.com` is NOT retired. It stays live. Retiring it is the
  only step that could strand an already-enrolled Mac (one whose stored state or
  a monitor names the old host), and this change does not take it.
- The four kosmos-relay deploy scripts that hardcode `coordinator.*` for health
  checks are a DIFFERENT repo and stay as-is; they check that specific host, which
  remains up.

## Recoverability

`engine/remote.js:90` shows `AGENT_WORKFORCE_TUNNEL_COORDINATOR` overrides the
default, so a wrong default is fixable in one env var rather than a rebuild. Both
hosts answering identically means the failure mode is narrow.

## Timing note

`remote.js` `DEFAULT_COORDINATOR` is what a fresh install enrolls against, and Josh
installs Kosmos on this Mac in the morning as the first outside tester. Whether a
release cut lands before or after this merge decides which default that install
gets. Angel (cutting 0.6.21) is told. Both defaults reach the same box, so either
outcome works; login.* is the intended one.

## Scope

`engine/remote.js`, `engine/remote.test.js`, `install/setup.sh`. Nothing else.
No card number: Josh's direct ask, not a filed issue.
