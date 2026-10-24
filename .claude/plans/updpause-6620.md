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
- **Fails open**: no answer, a timeout (5 s), a non-200, not JSON, or no field all read as not paused. A fleet that
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

A board with remote access off has never contacted the coordinator (engine/remote.js, kosmos#4649: a board that
never opted in makes no call to our servers). Now it makes one unauthenticated GET to `/v1/meta`, carrying no
identifier, only around an install: a look after which an automatic install would start (a newer version, an
installed copy, automatic updates on, not backing off or deferred), an Install press while an update is on offer (it
asks before the route's other checks, so a press later refused for another reason has still asked), and run-setup
itself (`kosmos update`, the .pkg postinstall). That is an exception to #4649, for a security step; a board with
automatic updates off on which nobody presses Install asks nothing. The site's privacy page (another repo) may
want one line saying so: a follow-up there, not built here.

## Not in this PR

- The coordinator monitor reporting a pause left on (the relay half's premise 5): due with this half, in kosmos-relay
  `deploy/coordinator-monitor.sh`, as its own small PR.
- The release pointer freeze (runbook e step 1).

## Review 2 decisions

- The board's answer is per look (the 15-minute TTL), and only the board's own automatic install reads it; nothing
  shows the pause on screen yet (review 5). An Install press does not use it: /api/update asks the coordinator at the press (review 4), so a pause
  lifted since the look does not refuse, and run-setup holds a live one itself (96) either way. Set only on the look's own
  cache, so a newer look's answer is never overwritten.
- A test file run with plain `node` (no runner, no harness) can ask the real coordinator: accepted, since only
  `node --test` and tools/run-tests.sh run the suite, and both ask nothing real.
- Board-level tests in engine/update-pause-6620.test.js against a local HTTP server; mutating out the ask, the
  automatic-updates-off skip, the live ask at a press, or the carried-over answer during an ask each turns one red.
  The only-when-newer gate is available()'s, not this diff's; a test pins that an up-to-date board asks nothing.
- Only a Kosmos that already carries this code can be paused. Older installs keep updating during a pause, which
  bounds this step's reach until the fleet has taken this release.

- Review 7: tools/test-install.sh (a cut's install gate, run outside run-tests.sh) runs run-setup, so it now asks the
  dead port too (its env -i reboot simulation as well): during an incident pause the real answer would have held the
  release meant to end it. Swept: it is the only script that runs run-setup outside the node suites. The look asks
  through the same gate as the automatic install (autoInstallWouldStart), so a board backing off or deferred asks
  nothing. Left as they are: on Windows a press asks twice (the route, then begin), up to 10 s against a coordinator
  that never answers; paused() has no on-screen reader yet.
- Review 6: /api/update asks only when something is on offer or running (otherwise its answer is "no update" with no
  ask), and a booted-route test (server.update-pause-6620.test.js) checks the 409, its control and the no-ask case.
  Left as it is: automatic updates turned on during a pause start an install at the next look that run-setup holds,
  backing them off for an hour (the same late-not-wrong outcome as the overlapping looks below).
- Review 5: /api/update asks first, before every other check, so none is read before an ask of seconds (an account
  move begun meanwhile still holds the board); its refusal still answers after the platform and source refusals. Left
  as they are: two overlapping looks can start an automatic install that run-setup then holds, which backs automatic
  updates off for an hour (nothing is installed, the update comes late); the 96 sentence's "try again in a few
  minutes" is short for a long pause, and a manual press during one is refused by the route before it reaches 96.
- Review 4: the ask's time limit is 5 s (it was 10), so a coordinator that does not answer delays a look or a
  run-setup by at most that; it still never holds the install.
- Review 3: exit 96 now means "could not be downloaded, or updates are paused", and the board and the .pkg
  postinstall say both (the .pkg path retries a pause on its bounded budget, then says so).

## Not held today (decided, follow-up #6781)

A .pkg install that takes the pinned path (once install/pkg-verify/floor stops reading "off") and a pasted install
line run over an existing install run the installer without run-setup, so they are not held (review 1).

A connect computer (no board) that installs with `kosmos update --if-newer --install` IS held (run-setup, 96), but
its one-line answer to the native app reads `failed <version>` with the reason only in install.log, so the app cannot
say the update is paused (review 4). Telling it needs a new answer word the native app parses, so it is a follow-up.

## Weakest premise

That `runSetup` and `begin` (plus the board's own check) are the only ways a newer version gets installed today. The map (2026-10-20) found
`beginInstall`, the CLI, the .pkg postinstall and the native app all reaching one of the two; a path added later that
installs without them would not be held.

## Validation

`install.update-pause-6620.test.js` (address rules, the strict read, the sync and async forms, run-setup held with 96
and the installer not run, an unpaused control, fail open, the override); the existing run-setup suites; the Windows
`begin` arm in `engine/win32connectupdate.test.js` runs only on the Windows CI job (it skips on a Mac); a mutation
removing the Mac check turns the held arm red.
