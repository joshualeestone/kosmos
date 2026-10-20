# updpause-6620: the fleet's update pause, the board half (kosmos#6620, O04-5)

Card: kosmos#6620 (re-scoped 2026-10-20 17:29 by Splinter): the release-side containment step of the incident runbook
(private: Kosmos/Security/2026-10-19-renet-O04-incident-runbook.md, playbook e step 3, "stop auto-install
fleet-wide"). The coordinator half is kosmos-relay branch updpause-6620: `/v1/meta` always carries `updates_paused`,
true while `UPDATES_PAUSED` is in its data dir, flipped by `deploy/updates-pause.sh on|off|status`. This branch is the
board half. The release pointer freeze (step 1) is a separate PR.

## What it does

- `engine/manifest-verify.js`: `pauseUrl`, `pausedIn`, `pausedSync`, `pausedAsync`, `PAUSED_SENTENCE`. `runSetup`
  asks first and, while paused, returns 96 (NOT_FETCHED: "a retry can succeed") with the installer not run, so the
  board's existing retry and backoff take the update once the pause is off. The functions live in this file, not a
  module of their own, because run-setup is a frozen interface also run by .pkg files already downloaded, and test
  fixtures carry this one file.
- `engine/update.js`: when a look finds a newer version, it also asks the pause (only then, so an up-to-date board
  makes no extra request); while paused the automatic install waits and `/api/update` (server.js) refuses with the
  pause sentence, which the confirm dialog shows. run-setup's own sentence goes to no screen (review 1).
- `engine/win32update.js` `begin`: a NEW install (after the unfinished-journal handling, which is never held) waits
  out the pause with the same sentence.

## Decided

- **The two choke points**: every install of a newer version passes `runSetup` (Mac: the board's auto and manual
  installs, `kosmos update`, the .pkg postinstall) or `begin` (Windows). Rollback is not held: it installs no new code.
- **Fails open**: no answer, a timeout (10 s), a non-200, not JSON, or no field all read as not paused. A fleet that
  holds every update whenever the coordinator blinks cannot take a security fix. So the pause covers computers that
  can reach the coordinator; for the rest the signed manifest is the only defence.
- **Exactly `true`**: `"updates_paused": "true"` or `1` is not paused (a strict read cannot be steered by a lookalike).
- **Under test**: `NODE_TEST_CONTEXT` in the given env OR this process's own, and no `KOSMOS_UPDATE_PAUSE_URL`, means
  nothing is asked; tools/run-tests.sh (and tools/test-pkg-checksum-1670.sh, which runs run-setup under plain bash)
  point the address at a dead local port. MEASURED after review 1: the win32connectupdate, win32update, update and
  this card's tests under a preload that records every fetch to the coordinator: 0 requests (a positive control with
  the same preload recorded 1). Review 1 had measured 18 before the fix.
- run-setup asks with its own curl (`-q`, so no `.curlrc`), never the injected spawnSync, so a test that counts its
  downloads sees only those.
- **Two overrides, both needing control of the computer's env**: `KOSMOS_UPDATE_IGNORE_PAUSE=1` skips the question;
  `KOSMOS_UPDATE_PAUSE_URL` asks another address.
- **Same address as remote access**: `AGENT_WORKFORCE_TUNNEL_COORDINATOR` or `https://login.kosmosplus.com`.

## Disclosure

A board with remote access off has never contacted the coordinator. Now, when it is about to install a newer version,
it makes one unauthenticated GET to `/v1/meta`, carrying no identifier. The site's privacy page (another repo) may
want one line saying so: a follow-up there, not built here.

## Not in this PR

- The coordinator monitor reporting a pause left on (the relay half's premise 5): due with this half, in kosmos-relay
  `deploy/coordinator-monitor.sh`, as its own small PR.
- The release pointer freeze (runbook e step 1).

## Not held today (decided, a follow-up card)

A .pkg install that takes the pinned path (once install/pkg-verify/floor stops reading "off") and a pasted install
line run over an existing install run the installer without run-setup, so they are not held (review 1).

## Weakest premise

That `runSetup` and `begin` (plus the board's own check) are the only ways a newer version gets installed today. The map (2026-10-20) found
`beginInstall`, the CLI, the .pkg postinstall and the native app all reaching one of the two; a path added later that
installs without them would not be held.

## Validation

`install.update-pause-6620.test.js` (address rules, the strict read, the sync and async forms, run-setup held with 96
and the installer not run, an unpaused control, fail open, the override); the existing run-setup suites; the Windows
`begin` arm in `engine/win32connectupdate.test.js` runs only on the Windows CI job (it skips on a Mac); a mutation
removing the Mac check turns the held arm red.
