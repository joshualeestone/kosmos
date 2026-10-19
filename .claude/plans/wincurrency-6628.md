# wincurrency-6628: the Windows build refuses a Plus connector behind kosmos-relay main

Card: kosmos#6628. Assigned by Liu Kang (tmux UPDATE, 2026-10-19). Reviewer: Raiden.

## Finished means

- `tools/build-kosmos-windows.sh` runs `connector_currency_check` on `kosmos-tunnel.exe` (its `.commit` sidecar)
  and exits when the connector is behind relay main; `KOSMOS_ALLOW_STALE_TUNNEL=1` ships it on purpose, as on the Mac.
- A shell test covers refuse, pass and override for the Windows connector, plus the wiring in the build script,
  and `package.json` `test:shell` runs it.
- The Mac check (release.sh step 1d) behaves as before; `tools/test-connector-currency-3884.sh` still passes.

## Decisions

- **The build script is a per-platform input.** The Windows connector is built by kosmos-relay
  `tools/build-tunnel-release-windows.ps1`, not `tools/build-tunnel-release.sh`. So `connector_currency_check` takes an
  optional third argument, the relay build script that made this connector (default: the Mac one, so release.sh is
  unchanged). The Windows build passes the .ps1. A change to the Mac script does not ask for a Windows rebuild, and a
  change to the .ps1 does. Rejected: checking both scripts on both platforms (conservative, but every Mac-only build
  change would refuse a Windows cut for no reason, which teaches people to reach for the override).
- **Where in the Windows build.** Right after the provenance check and before the connector is copied into the stage,
  so a stale connector costs a rebuild, not a zip. Same relay checkout default as the Mac (`KOSMOS_RELAY_REPO`, else
  `~/work/kosmos-relay`).
- **Weakest part:** on the Windows PC the relay checkout must exist and be fetchable; if it is not, the build refuses
  (fails closed, like the Mac). That is the intended behaviour, but it is a new requirement on that box. What would
  change my mind: a Windows release owner saying that box builds without a relay clone, in which case the check moves to
  the Mac side of the Windows cut instead.
