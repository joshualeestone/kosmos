# Plan: board-restart-on-world-switch primitive (kosmos#2238)

Full scoping + the trigger contract with Angel live on the card (kosmos#2238). This file is the branch plan the PR gate expects; it summarizes the decision and the shape.

## Problem
Multi-Kosmos SWITCH is broken (Josh, 0.6.35 fresh install): create-a-Kosmos works, switching does not. Root cause: `POST /api/worlds/active` writes the new `activeWorldId` but does NOT restart the board, and `worlds.applyActiveWorldEnv` applies a world's data roots ONCE at boot (~26 modules freeze `store.ROOT` at require). So the running board keeps serving the previous world until it restarts.

## My piece (Angel wires the web reconnect on top)
1. `engine/boardrestart.js` - a FAIL-SAFE board self-restart primitive. `canSelfRestart()` returns true ONLY when the disk plist declares unconditional KeepAlive AND the LOADED launchd job (`launchctl print`) shows keepalive active AND runs this exact pid; every uncertainty returns false so the route reports `restartRequired` (manual) and never bare-exits a from-source/disabled board (would brick it). `selfRestart()` re-checks the guard, then `launchctl stop com.kosmos.board` (KeepAlive relaunch; agents survive).
2. `engine/worldenv.js` + `/api/status` - capture the world the board BOOTED into and report THAT (not the live registry pointer), so the reconnect poll cannot false-succeed the instant the pointer flips.
3. `POST /api/worlds/active` - compute `restarting`, return `{ ok, world, restartRequired, restarting }`, fire the restart 500ms after the response flushes. `restartRequired` is precise (false on a no-op switch).

## Trigger contract (agreed with Angel)
Response `restarting:true` -> board self-restarting now; web shows "switching Kosmos...", polls `/api/status.activeWorldId === target` (the booted world) until it flips, then reloads, with a ~150s timeout falling back to the manual banner. `restarting:false` -> manual restart (from-source/unmanaged/no-op).

## Release gate
A real edit/switch on the INSTALLED board with two worlds (Josh's fresh-install test exercises it). Agents survive the ~10-13s board cycle.

## Key decision
The guide-equivalent app-server path is NOT needed: Kosmos runs the board as a launchd KeepAlive job, and `launchctl stop` = relaunch (the mechanism restart-local-board.sh + the update flow already use). The whole risk is the fail-safe detection never false-positiving; that is the load-bearing piece and is challenge-looped.
