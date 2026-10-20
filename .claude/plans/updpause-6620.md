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
- `engine/win32update.js` `begin`: a NEW install (after the unfinished-journal handling, which is never held) waits
  out the pause with the same sentence.

## Decided

- **The two choke points**: every install of a newer version passes `runSetup` (Mac: the board's auto and manual
  installs, `kosmos update`, the .pkg postinstall) or `begin` (Windows). Rollback is not held: it installs no new code.
- **Fails open**: no answer, a timeout (10 s), a non-200, not JSON, or no field all read as not paused. A fleet that
  holds every update whenever the coordinator blinks cannot take a security fix. So the pause covers computers that
  can reach the coordinator; for the rest the signed manifest is the only defence.
- **Exactly `true`**: `"updates_paused": "true"` or `1` is not paused (a strict read cannot be steered by a lookalike).
- **Under test**: `NODE_TEST_CONTEXT` (inherited by spawned children) and no `KOSMOS_UPDATE_PAUSE_URL` means nothing
  is asked, so no test reaches a real server.
- **Operator override**: `KOSMOS_UPDATE_IGNORE_PAUSE=1`.
- **Same address as remote access**: `AGENT_WORKFORCE_TUNNEL_COORDINATOR` or `https://login.kosmosplus.com`.

## Disclosure

A board with remote access off has never contacted the coordinator. Now, when it is about to install a newer version,
it makes one unauthenticated GET to `/v1/meta`, carrying no identifier. The site's privacy page (another repo) may
want one line saying so: a follow-up there, not built here.

## Not in this PR

- The coordinator monitor reporting a pause left on (the relay half's premise 5): due with this half, in kosmos-relay
  `deploy/coordinator-monitor.sh`, as its own small PR.
- The release pointer freeze (runbook e step 1).

## Weakest premise

That `runSetup` and `begin` really are the only ways a newer version gets installed. The map (2026-10-20) found
`beginInstall`, the CLI, the .pkg postinstall and the native app all reaching one of the two; a path added later that
installs without them would not be held.

## Validation

`install.update-pause-6620.test.js` (address rules, the strict read, the sync and async forms, run-setup held with 96
and the installer not run, an unpaused control, fail open, the override); the existing run-setup suites; the Windows
`begin` arm in `engine/win32connectupdate.test.js` runs only on the Windows CI job (it skips on a Mac); a mutation
removing the Mac check turns the held arm red.
