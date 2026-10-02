# #4382 (Mac half): a connect computer updates with no board

Card: joshualeestone/kosmos#4382. Reassigned to PigeonPete 2026-10-02 09:52 (Splinter). Windows half is Homer's (#4381).
Design: Raiden's, amended by Liu Kang's ruling on the card (2026-09-28 20:51): native menu item + native bar, nothing
in the page, no macOS notification, relaunch after a successful update approved.

## What changes

1. `install/kosmos`: new verb `kosmos update --if-newer [--install]`.
   - Runs `engine/update-ifnewer.js` with the engine's node. That file requires `engine/update.js` and
     `engine/autoupdate.js`, so the channel (env, then the source-channel stamp), the staging+prod comparison
     (#2969), `newer()` and the consent rule (absent ON, unreadable OFF) are the board's own code.
   - A `file://` release base is read from disk (node's fetch does not read file URLs; setup.sh already accepts
     file:// bases).
   - Consent on, or `--install`: the same `curl <setupUrl> | sh` as `beginInstall`, with KOSMOS_RELEASE_BASE,
     KOSMOS_UPDATE_CHANNEL (the pointer) and KOSMOS_SOURCE_CHANNEL (the subscription); writes `logs/install.started`
     and `logs/install.status` the same way; installer output to `logs/install.log`.
   - Consent off or unreadable: prints `newer <v>`, installs nothing.
   - A running board (running_pid): prints `board` and does nothing (two installers must never race).
   - Last stdout line is the answer: current / newer / updated / failed / board / unknown.
   - Listed in the help, in the --help guard, and as a person-only verb in the Windows parity test.
2. `native-app/main.swift`:
   - `UpdateAnswer`, pure `updateAnswer(fromOutput:)`, and `runKosmosUpdate(kosmosHome:port:install:)`.
   - `startUpdateLooks()` after `stopBoardIfRunning`'s stop and after `switchToConnect`'s stop; a daily Timer;
     `stopUpdateLooks()` in `runAgentsHere`.
   - `lookForUpdate` counts in `stopsInFlight` so Run agents waits for an installer.
   - Offer: hidden menu item "Update Kosmos" (title becomes "Update Kosmos to X") and an
     `NSTitlebarAccessoryViewController` bar with Update / Not Now. Never the page, never a notification.
   - `.updated(v)`: relaunch into `freshAppURL(theirs: v)` with the existing `relaunch(...)`.
   - `--kosmos-app-update-selftest` (14 rows), run by `tools/build-kosmos-bundle.sh`; menu table gains the row.
   - `kosmosFirstRunChoice = true`. Windows' FirstRunChoice stays off (its connect computer cannot update yet).
3. Tests: `cli.update-ifnewer-4382.test.js` (9), `native-app.update-ifnewer-4382.test.js` (8), the 4356/4381
   switch tests updated, and a `tools/test-install.sh` arm with the real installer (connect + consent off: offered,
   nothing installed, board down; consent on: installed, board down, status recorded; then current).

## Decisions (reversible)

- Flip the Mac switch in this PR, as Johnny Cage's approved plan says. #4356's open item (does the "both" first-run
  sign-in turn the Kosmos+ switch on?) is answered on #4356 (comment 5955657427): it already does, via #3827.
  Nothing to build first.
- Merge order: Liu Kang had ruled #4342 merges before #4382. That gate is gone (Baron, 2026-10-02 10:31, PR #4425
  comment 5955710440): #4425 is changes-requested, do not merge, and #4818 (PR #4827) already put the board-back
  fix on main (setup.sh `_kosmos_put_board_back`). This branch is rebased onto that main. The put-back reads the
  mode again and keeps a connect computer's board off, which is what this PR's update needs. The residual Baron
  named (a port-in-use die before the put-back arms) is not this PR's.
- The CLI refuses when a board runs rather than racing it. Weakest premise: a connect computer whose stop failed
  keeps a running board that never shows its own offer (the page is the other computer's). The launch-time stop
  retries every launch, so this is bounded by the next launch.

## Iterations

### Iteration 1 (opus, blind): 5 warnings, 4 conventions, nits. All taken except where noted.
1. WARNING: an install made because updates are on relaunched the app unasked (words typed on the page lost).
   Fixed: only the person's own Update restarts at once, and never under a dialog of ours; otherwise the bar
   and the menu offer "Restart" (`showInstalledOffer`), and later looks keep that offer.
2. WARNING: `kosmos update` had no mode check and no agent guard. Fixed: refused (exit 3, `refused <why>`)
   unless `$KOSMOS_HOME/mode` reads exactly `connect`, and refused for an agent (`_invoked_by_agent`).
   CLI tests: run, both, not-exactly-connect, no file, agent; control: a person on connect installs.
   The install harness runs its update calls with the agent markers removed.
3. WARNING: an unknown answer waited a day. Fixed: one retry an hour later, and a wake looks when the last
   look is a day old.
4. WARNING: merge order behind #4342. Resolved by Baron's finding (Decisions above): no longer a gate.
5. WARNING: checkNow() could reach the board's auto-install inside the look. Fixed: update-ifnewer.js sets
   the board's auto preference off for its process; consent is still read from autoupdate.read(). Test spies
   the install seam with Updates on.
6. CONVENTION: false comment on KOSMOS_PORT in runKosmosUpdate. Rewritten.
7. CONVENTION: update.js "Production code never calls these". Now names update-ifnewer.js.
8. CONVENTION: plan file name. Deferred: this repo's plans are `<branch>.md`.
9. CONVENTION: updateLookInterval comment contradicted itself. Rewritten to what the code now does.
NITs taken: update wording in the Run agents refusal; the bar's button hidden while an install runs and a
second press ignored; duplicate mkdir in tools/test-install.sh. Not taken: the wiring tests are source
reads (the repo's accepted pattern for AppKit wiring no selftest reaches).
Each new guard was perturbed: removing it fails exactly one test.

### Iteration 2 (sonnet, blind): 1 warning, 2 conventions, nits. All taken.
1. WARNING: nothing bounded a stalled install, so the app's wait (and Run agents) could hang all session.
   Fixed: the CLI's curl of the installer is bounded (connect 30s; under 1 KB/s for 60s ends it). Not
   bounded: the installer's own downloads, and no Swift watchdog (killing the CLI mid-install would orphan
   the installer it piped to).
2. CONVENTION: the "retried once" retry retried itself hourly, and a refusal retried too. Fixed: the retry
   is marked and not retried; the CLI's `refused<TAB><why>` is its own answer (`.refused`, two selftest rows,
   16 in all) and is never retried.
3. CONVENTION: "It will try again tomorrow" was false with updates off. Now "Press Update to try again."
NITs taken: a comment that no tab field may be empty (IFS read collapses them); an answer the app cannot
read is logged with what the CLI said. Not changed: a press during a dialog of ours offers Restart rather
than restarting under it (intended).

### Iteration 3 (opus, blind): 2 warnings, 1 convention, nits. All taken.
1. WARNING: quit during an install, reopen, and a second installer started over the first (the app's
   in-flight count is in memory; the installer outlives the app). Fixed: the CLI refuses while
   logs/install.started is younger than 30 minutes (an interrupted install leaves an older marker, which
   update.js already reads, so it is not in the way), and Run agents refuses on the same test
   (`installUnderWay`). CLI test: fresh marker refused and kept; 31-minute marker installs.
2. WARNING (lower confidence): the person's Update relaunched minutes after the press with no warning.
   Fixed: the bar says "Updating Kosmos. It restarts when the update is installed."
3. CONVENTION: the exit-code comment contradicted itself. Rewritten.
NITs taken: a look that could not look keeps the offer it had; a press during a look is logged; the person's
relaunch keeps the Restart offer under it, so a failed relaunch leaves it; `refused` with only spaces is
unknown, and CRLF output splits (18 selftest rows); the help line says the verb is for connect computers.

### Iteration 4 (sonnet, blind): 0 blockers, 0 warnings, 2 conventions, nits. Conventions taken.
1. CONVENTION: Not Now did not hold for an installed or failed offer (the bar came back daily). Fixed: Not Now
   holds for that version whatever the bar says; pressing Update or Restart clears it.
2. CONVENTION: a pressed Update answered `refused` or `board` vanished silently. Fixed: says "Kosmos is
   already being updated on this computer" and keeps the offer.
NITs taken: a marker from the future holds nothing off in the app (the CLI's `find -mmin` cannot cheaply,
left); a comment that `.newer` cannot arrive while Restart waits. Left: the app passes its environment
to the CLI (an agent-launched app is refused, the safe direction).

### Iteration 5 (opus, blind): 2 warnings, nits. Warnings taken; one nit measured false.
1. WARNING: Update pressed from the menu after Not Now installed and restarted with the bar still hidden
   (iteration 3's fix covered only the bar's button). Fixed: a pressed install shows the bar ("It restarts
   when the update is installed") and hides the menu item until the answer.
2. WARNING: an install this app did not see finish (another run of the app started it, then the look was
   refused while it ran) left the old app running with nothing offered: `.current` carried no version.
   Fixed: `.current(v)` carries the version on disk; when it differs from the running app and an app
   carrying it is on disk, Restart is offered. An unasked refusal is looked at again within the hour (once).
   Weakest premise: the app's bundle version and the install's package.json version are the same numbers
   (the stale-app check #4347 already relies on that).
NITs taken: the `.newer` comment (it can replace a waiting Restart); a neutral note when a pressed Update
cannot start. NIT measured FALSE: "BSD find rounds -mmin up, so -30 means 29 minutes". On this Mac,
`find -mmin -30` matches a 1799 s old file and not a 1801 s one, so it already agrees with the app's 30
minutes; `-31` would have opened a minute's gap the other way. Kept -30, with the measurement in a comment.
Left: a retry that fires during a pressed look is dropped with a log line (the daily look covers it).

### Iteration 6 (sonnet, blind): 1 warning (low-medium), 1 convention, 1 nit.
1. WARNING: the `.current(v)` arm offered "Restart" into an OLDER version when a hand-run app is newer than
   its install (pickFresh accepts the running bundle as fresh). Fixed: `restartWanted(running:onDisk:)`
   requires the running app to be strictly behind (isBehind == true; unreadable offers nothing), with five
   update-selftest rows (23 in all).
2. CONVENTION: the order assertion's message was backwards, and the arm's logic was pinned only as text.
   Fixed: message reworded; the logic now has executable selftest rows.
NIT left: a later look can clear a standing "Quit Kosmos and open it again" note (at worst a day's delay).
