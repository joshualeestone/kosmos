# updatelatch-4342: a failed update no longer leaves the board stopped for good

Addresses #4342 (Josh hit it on his laptop on 2026-09-28; claimed:raiden, Liu Kang m2392). Baron (release lane)
reviews before merge, because this is `install/setup.sh` (Liu Kang m2402).

## Finished when
- An update that fails after it has paused the board leaves the board running again, with no `board.stopped` behind.
- A board the person, or Kano's #4356 connect mode, had stopped before the update stays stopped.
- Pinned by an installer test that goes red on main.

## Cause of this latch (read from the code; not asserted as Josh's cause until his logs arrive, per Liu Kang)
- `board.stopped` silences everything that would bring a board back:
  - launchd's `KeepAlive` is PathState-keyed on its absence (`install/setup.sh`, the board plist);
  - `kosmos board-run` exits at once when it exists;
  - the #2955 watchdog exits at once when it exists.
  Only a person's `kosmos start` (quit and reopen) clears it.
- The installer pauses the board with `kosmos stop`, which writes the marker, and starts it again near the end
  (`Starting Kosmos.`). Between those two points there are 8 `die` calls under `set -euo pipefail` and no `trap`.
  The first step after the pause is `fetch_tmux`, a network download. Automatic installs are started by the board
  (`engine/update.js` `maybeAutoInstall`), so once the board is down nothing retries either.
- The timeline that makes it a candidate for Josh's case:
  - the staging pointer moved to 0.7.05 at 20:30 CDT Sunday;
  - his Mac follows staging;
  - his last relay contact was 19:33, so the Mac was most likely asleep, and the update would start at wake on a
    network that has just come back.

## Change (`install/setup.sh`)
- **Just before the installer's own `kosmos stop`:** record whether `board.stopped` already exists. If it does
  (a person's stop, or #4356 connect mode), a failure leaves it alone.
- **Arm an `EXIT` trap, `_kosmos_update_resume`:** on a non-zero exit, while armed, it ignores SIGPIPE, removes the
  marker, runs `kosmos start` (guarded `[ -f ] && [ -x ]`), and only then says what happened on stderr, guarded:
  "was started again" only when that start succeeded (no "as it was": marker-absent means "should be running", not "was running"), otherwise "could not start again just now. Open Kosmos, or run:
  kosmos start" (review iteration 2; both branches exercised with a stub CLI). HUP, INT and
  TERM become exits, so the trap runs for them too.
  - The order matters (review iteration 1): a closed terminal takes the progress logger with it, and stderr is its
    pipe, so a write before the start would kill the handler.
  - On a real install, removing the marker alone also re-arms launchd's KeepAlive and the watchdog, even if the
    start fails (for example a half-swapped app).
- **Disarm it just before the installer's own start** (`_kosmos_resume_on_fail=no`). `kosmos start` removes the
  marker first, so from there no failure can leave the latch, and a start that fails says only its own sentence.
- **Three states for the trap** (review iteration 5): `yes` = remove our marker and start the board; `clear` = remove
  our marker only; `no` = leave everything. Exercised in isolation with a stub CLI: yes removes + starts, clear
  removes only, no leaves both.
- **The pause block's refusals:** "could not be paused" (our board never stopped) sets `no`. The three "someone else
  holds the port" refusals ("another Kosmos", "another app", "a process is still holding the port") set `clear` when
  the marker is ours. The installer's own stop writes `board.stopped` there, so without `clear` the board would latch
  off once that other process is gone; starting on a port that is not ours is not ours to do.
- **Signal traps** (review iteration 5): HUP/INT/TERM are reset at the disarm line (`kosmos-4342-disarm`), and
  ignored inside the handler so a second Ctrl-C cannot cut the undo short.
  The two "someone else holds the port" refusals ("another Kosmos", "another app") disarm the trap and behave exactly
  as on main (review iteration 3): our board was not running and the port is not ours to start on. Measured control
  (the disarm removed): `kosmos start` reads the other Kosmos as healthy and returns, so nothing is killed, but the
  trap claimed "started again" for a board that is not ours; the test's "no restart is claimed" check went red
  (1 FAIL), and it passes with the disarm. The review's worry that #3079's reclaim would kill that board did not
  happen in this measurement.
- **A TERM to the installer's pid alone** waits for the foreground command to return, and the tmux download has no
  time limit (none before this change either), so a stalled download holds it. A signal to the group (a closed
  window, Ctrl-C) ends it at once; that is the case tested.

## Coordination
- **Kano's #4356:** he owns keeping connect mode's board off after a SUCCESSFUL update, keyed on
  `$KOSMOS_HOME/mode`. His `if` wraps the final start. My disarm line stays on its own line outside both arms: first
  agreed after his `fi` (m2446 to m2456), then moved just before the start after review, and Kano was told. The second of us to merge resolves the setup.sh and test-install.sh hunks and
  re-runs both sets of arms.

## Pins (`tools/test-install.sh`, a new arm after the update arm)
- **The forced failure:** a local tmux source that does not exist makes `fetch_tmux`, the first step after the
  pause, fail.
- **The checks:**
  - the run fails, and it fails after the pause;
  - no `board.stopped` is left;
  - the board serves again;
  - it says it is being started again.
- **The control:** `kosmos stop` first, then the same failed update. The marker stays, and the board is not started.
- **The TERM arm** (review iteration 1): a local release host accepts the tmux download and never answers, so the
  update is held right after the pause. Its process group then gets TERM, the way a closed window sends it. No
  marker may be left, and the board must serve again. The arm first asserts that it reached the held download
  after the pause, so it cannot pass by never getting there.
- **The disarm,** read from the installer: the tagged disarm line sits after the trap is armed and before the
  installer's own start.
- **Another app / a silent holder on the port** (review iteration 5): our board down and unmarked, a stand-in on the
  port; the update refuses there, leaves no `board.stopped`, leaves the stand-in running and claims no restart.
- **Measured with fresh local bundles (`KOSMOS_ALLOW_MINOS=1` builds in the worktree):**
  - this branch: all checks of the arm pass (first measured 9/9, then 13/13, 17/17 as arms were added; the
    another-app and silent-holder arms added in review iteration 5 are re-measured once the 0.7.06 cut hold lifts);
  - main: the 3 core checks FAIL (the marker is left, the board is not back, nothing is said) and the control passes.
  - Both suites also show one unrelated FAIL, `VERSION record installed`: the local bundle build refuses to
    package a dirty tree, so it writes no `VERSION`.
- `tools/test-install.sh` is not part of `yarn test` (only `bash -n` is). It runs as `yarn test:install` at
  release time.

## Weakest part
- If the app files are half-swapped when the failure hits, `kosmos start` may not bring the board up. Removing the
  marker still re-arms launchd and the watchdog on a real install, but the sandboxed test cannot show that (launchd
  registration is skipped there).
- Josh's actual cause is unproven until his logs arrive (Splinter): an interrupted update is a strong candidate from
  code and timeline, and this latch is real on any failed update either way.
