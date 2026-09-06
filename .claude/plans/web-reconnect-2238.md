# web-reconnect-2238: wire the in-app Kosmos world-switch reconnect

kosmos#2238 (the multiple-Kosmos SWITCH). This branch is the WEB half of the
restart-on-switch feature. The server half landed in #2346 (PigeonPete): the fail-safe
board self-restart primitive (`engine/boardrestart.js` `canSelfRestart`/`selfRestart`),
`POST /api/worlds/active` returning a FINAL `{ ok, world, restartRequired, restarting }`
and firing `selfRestart` after the response flushes, and `/api/status` reporting
`activeWorldId` = the BOOTED world (`engine/worldenv.bootedWorld`, not the registry
pointer).

## What this branch does

`worldswSwitch` (web/index.html) now acts on the FINAL response instead of always
showing a manual-restart banner:

- **restarting:true**: the board is self-restarting now. Show "Switching Kosmos…",
  then `worldswReconnect` polls `GET /api/status.activeWorldId` every ~2s, treats a
  thrown fetch (connection refused while launchd relaunches) as keep-polling, and
  reloads once `activeWorldId` flips to the switched-to world. A ~150s ceiling falls
  back to the manual banner.
- **restarting:false (with a real restartRequired)**: a from-source / unmanaged board
  that will not self-restart safely: the honest manual "restart Kosmos" banner, no
  auto-reconnect.
- **restartRequired:false**: a no-op switch to the already-booted world: say it is
  already active, no restart, no poll.

## Why the poll keys on the booted world

`POST /api/worlds/active` flips the registry pointer instantly, so polling
`/api/worlds.activeWorldId` (the registry) would false-succeed during the restart
window, before the board reboots. `/api/status.activeWorldId` reports the world the
LIVE board BOOTED into, which stays the OLD id until launchd relaunches onto the new
world, so the poll cannot false-succeed. This is the race #2346's status change closed;
the web side must key on it, and the browser check proves it observes the OLD id before
the flip.

## Verification

- `docs/browser-checks/render-worldswitch-2238.js` extended to cover all three outcomes,
  with controls: the pre-fix read-only-rows control, and disabling the reconnect branch
  reds the Switching/reload/booted-poll arms. The reboot is simulated on a poll COUNT
  (not a wall-clock timer) so the race-safe assertion cannot flake on event-loop timing.
- Full node suite green (exit 0). Reconnect flow mirrors the update-flow reconnect
  (#553): 2s poll, no-store, catch-and-continue, reload on the confirmed flip.

## Follow-up (not this branch)

End-to-end verification on a real INSTALLED board (the release gate), the actual
launchd stop/relaunch cannot be exercised on the shared box or in a hermetic file://
check. Hand to PigeonPete once merged.
