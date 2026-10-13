# readonlyon-4455: the installed app is read-only by default (kosmos#4455)

## Why
#4449 made the installed `app/` folder read-only so an agent's edit is refused (a tester's board went stale after an
agent edited the installed app). It shipped switched OFF, because an installer from before #4449 cannot remove a
read-only app. The card turns it on one release after the lifting reached the `/setup` people run. Production served
0.7.45, which carries the lifting, at 09:29 CDT on 2026-10-13 (Angel, on the card). This is the release after.

## Change
- `install/setup.sh`: the default is ON. `KOSMOS_READONLY_APP=0` is the off switch (unset, empty or anything else
  is on).
- `install/setup.sh`, the swap (condition 3): all three parts are lifted and CHECKED before any is removed. A part
  that holds something rm cannot remove refuses the update with nothing removed.
- `tools/test-update-locked-app-4455.sh`, in `test:shell`: drives the shipped block against a sandbox install.
- `tools/test-install.sh`: the default check is inverted (switch truly unset: read-only), and the update after it
  runs with `=0` and must leave the app writable.
- `release/whats-new-pool.json`: one line for the next release. `engine/defaults.js`: a comment.

## The three conditions recorded on the card
1. **Take the runtime-writes measurement again.** On this computer's own install, 0.7.45, updated by the real updater
   at 09:40:22 and its board started at 09:40:33 with the fleet's agents on it. Read at 09:47: 0 entries under `app/`,
   `runtime/` or `bin/` changed or modified after the board started (`find ... -newercm board.started-at`, and
   `-newermm`). Control: the same search over the rest of the install finds `logs/board.log`, `logs/install.log`,
   `logs/install.status` and `logs/board-watchdog.state`. **That is seven minutes.** It is read again before the proof
   and the later reading is the one that counts. By reading: no code outside the installer addresses a write at the
   app folder (searched `engine/`, `server.js`, `bin/`, `tools/` and `install/`).
   NOT in this measurement: an agent created since the board started (I have not checked that one was).
2. **The sandbox harnesses.** Swept by a subagent, every file under `tools/`, the root and `engine/` tests, the
   browser checks and the workflows. Three things run the real installer far enough to lock an app:
   `tools/test-install.sh` (already ran with the switch on, and lifts before each of its own edits),
   `tools/clean-machine.sh` (lifts before it removes) and the Linux workflow (removes only through `--uninstall`,
   which lifts). The eight candidates the card names only extract blocks of the installer's text, or run
   `--uninstall` over a hand-built folder. Nothing needed changing. **A reading, not a run**: the full suite is the
   measurement.
3. **Check the lift before removing anything.** Built, with a test. What the test taught me: my first version asked
   "is anything stuck?" only after a failed chmod, and a locked file went straight through, because chmod leaves a
   file that is already writable alone and exits 0. Locked files are now searched for directly.

## Decided
- **A failed chmod alone does not refuse.** A file somebody else owns, in a folder this user may write to, is removed
  fine, and refusing there would break updates that work today. Refused only when something is found that rm
  cannot remove.
- **The folder walk runs only where the lift failed.** One `test` per folder; the usual update never pays it. The
  locked-file search runs on every update on macOS: measured at under 0.01 s on this install (341 entries).
- **Off is `=0`, not "anything but 1".** Unset must mean on, so the old spelling of the test would have read an
  unknown value as off.
- **Uninstall is unchanged.** It lifts and removes; on a locked file it stops partway, as it does today. Not this
  card's condition; said under residuals.

## Weakest premise
That no `/setup` older than 0.7.45 is still being served or run. An installer from before #4449, meeting an app this
one locked, dies at its own `rm -rf` with the board paused, and I cannot make an old installer behave. 0.7.45 has
been the served `/setup` for hours, not days. Whoever merges this decides when it ships: it reaches people at the
next release cut after the merge. If `/setup` is ever rolled back below 0.7.45 after that, those installs need
`chmod -R u+w` on the app folder by hand. The card's "also decide" (guard `/setup` rollbacks below #4449) is the
release lane's and is not built here.

## Residuals
- Linux with a read-only app has not been run by anyone. The Linux workflow installs with the new default for the
  first time on this branch's CI; that run is the measurement.
- The locked-file search is macOS only (the flag is BSD's). On Linux an immutable file (`chattr +i`) is not found
  ahead of time, and the update fails partway as it does today.
- A same-user agent can still `chmod` its way past. The app's instructions to agents are the other half (#4449).

## What would change this
A report of an update that died with "Permission denied" under the app folder; a runtime writer under `app/` showing
up in the second measurement; the Linux workflow going red on this branch.

## Verify
- `sh tools/test-update-locked-app-4455.sh`: 17 passed. Its CONTROL arm runs the old line on the locked fixture and
  loses `bin` before stopping at `app`.
- Every `install*.test.js` (23 files): 218 pass. `bash tools/test-install-static.sh`: 23 passed.
- The what's-new tests (4 files): 54 pass. (My first wording was 151 characters; the window allows 140.)
- `tools.shell-shard-4317.test.js`, `tools.every-test-runs.test.js`: 22 pass.
- NOT RUN YET: `tools/test-install.sh` against the flip, the full suite, the Linux workflow. Queued.
