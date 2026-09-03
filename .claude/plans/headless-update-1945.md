# kosmos#1945: a headless board never auto-updates

## The mechanism (confirmed by Splinter2 with a registered prediction)
`engine/update.poke()` is the only thing that fetches `latest.json` and, on finding something newer,
can fire `beginInstall({auto:true})`. Its ONLY caller was `server.js`'s `/api/status` route, which runs
only while someone has the dashboard open. So a board nobody looks at never poked, never learned a
release existed, and ran old code forever. The property is perverse: the more stable the install, the
more stale it gets. Confirmed live: sending status requests to a headless 0.6.22 board took it to 0.6.24
with NO restart, twelve seconds after the 15-minute cache TTL expired.

## The fix
1. `engine/update.startPolling(intervalMs)` - an unref'd, best-effort `setInterval` that calls `poke()`,
   returning the handle so a caller can clear it. The module already owns the look (its docblock: "the
   15-minute look is the only clock in this module"), so the timer lives here, not in the server.
2. `server.js` `start()` calls `updates.startPolling(...)` next to the sibling sweeps (ensureTick / nudge
   sweep / autohandoff sweep), with an interval seam `AGENT_WORKFORCE_UPDATE_POKE_MS` (default 60s, a
   fraction of the TTL).

## Why this is safe (it changes WHEN the board looks, never WHAT it installs)
- `poke()` is TTL-gated: `if (Date.now() - cache.at < TTL) return`. So no matter how often the timer
  fires, a real `latest.json` fetch happens at most once per 15-min window. A 60s cadence does not hammer
  the release host. (Test 2 pins this: ~8 ticks -> exactly 1 fetch.)
- `maybeAutoInstall()`'s gates are unchanged: `available()` (numeric, unknown loses), `installedRoot()`
  (a from-source checkout is never auto-installed over), `autoPref().on` (an unreadable pref reads OFF),
  and the hourly `AUTO_RETRY_AFTER` backoff on a failed auto-install. This PR adds no new install path and
  relaxes no gate; it only ensures the existing gated path is reachable without a viewer.
- The timer is `unref()`d, so it never holds the process open; `poke()` is wrapped so a throw costs the
  board nothing.
- The intended consequence: a headless board with auto-update ON (the documented default) now auto-installs
  releases, which is exactly what "Done looks like" asks (update awareness must not depend on a viewer).

## Test (engine.update-poll-1945.test.js), red-capable both halves
- startPolling drives a viewer-less fetch (inject a fetcher, no /api/status) -> RED if startPolling does
  not poke (verified by breaking the callback).
- poke() stays TTL-gated: ~8 ticks -> exactly 1 fetch.
- shape-pin: server.js calls `updates.startPolling(` -> RED if the server wiring is reverted (verified).
- the handle is unref-able.
Full node suite green 3978/0.

## Not done here (the standing observation, do NOT disturb)
cabal9 and test9 sit at 0.6.20 with live headless boards on Splinter2's Mac - the live control for this
finding. They must NOT be restarted or probed (a status request IS the poke), so they remain the
untouched experiment. This PR is the code fix; the on-a-real-machine confirmation rides the next serve.
