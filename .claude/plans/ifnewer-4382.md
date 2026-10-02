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

- Flip the Mac switch in this PR, as Johnny Cage's approved plan says. Weakest premise: #4356's "both" first-run
  sign-in turning the Kosmos+ switch on is still an open item on #4356; if it needs work it is a separate PR and
  this one waits for it before merging.
- Merge order: Liu Kang ruled #4342 merges before #4382. PR #4425 (#4342) is open, waiting on Baron's release-lane
  read since 09-29. This PR does not merge until #4342 has.
- The CLI refuses when a board runs rather than racing it. Weakest premise: a connect computer whose stop failed
  keeps a running board that never shows its own offer (the page is the other computer's). The launch-time stop
  retries every launch, so this is bounded by the next launch.

## Iterations

(filled in by the review loop)
