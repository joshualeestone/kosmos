# Plan: board watchdog so Kosmos self-recovers after a reboot (#2955)

## Source
Josh, 2026-09-12 ~14:36 CDT, on a box he had just powered down, moved, and restarted:
"the agents didnt launch and kosmos is empty after the restart" / "which means anyone
who restarts might have this issue." LIVE on 0.6.59: any user who reboots can land in a
Kosmos that reads "could not refresh" and does not self-recover. Severity HIGH.

Routed by Splinter with Josh's never-idle rule: "verification needs a reboot" is a
VERIFY blocker, not a BUILD blocker - build the fix now, ship staging-first, gate prod
on a real reboot-verification.

## Diagnosis (verified against origin/main, and folded into the card)
- **The UI already auto-retries.** The status poll is `setInterval(tick, 5000)`
  (web/index.html:45824); it fires every 5s regardless of the previous failure. So the
  "could not refresh" state does NOT latch its retries - "add auto-retry" is a no-op.
  What it cannot do is START a dead board (no UI->board bridge; "Look for agents" calls
  a board endpoint and needs the board up).
- **Root cause is infra.** `com.kosmos.board` is a LaunchAgent, RunAtLoad + NO KeepAlive
  deliberately (install/setup.sh:3581): `kosmos start` daemonises and exits, so launchd
  never supervises the real detached board process. After a reboot, if that process
  fails to start or dies (zombie port 16180 from an unclean power-down, a not-yet-ready
  dependency, a crash), nothing relaunches it and nothing self-heals.
- Blind KeepAlive is WRONG (the launcher exits 0 after daemonising, so KeepAlive would
  loop). The done-right fix is a foreground-supervision mode (launchd owns the board
  process) - Baron Draxum owns that as a follow-up card. This card is the additive
  interim that unblocks the live bug now.

## The change (additive watchdog LaunchAgent + a stop-marker)
A second LaunchAgent, `com.kosmos.board.watchdog`, RunAtLoad + StartInterval, that
brings the board back when it has died and the user did not deliberately stop it. It is
cause-agnostic recovery and touches none of the fragile stop/start/updater rearchitecture
foreground mode would.

### Files
1. **`bin/board-watchdog.sh`** (new): the watchdog body. Reads `$KOSMOS_HOME` (passed as
   argv[1] by the plist, baked absolute at install time). Logic per run:
   - If the stop-marker `$KOSMOS_HOME/board.stopped` exists -> exit 0 (user chose stopped;
     do not fight it).
   - If `kosmos status` exits 0 (board answering on its port) -> clear the down-since
     state, exit 0.
   - Else the board is down and not deliberately stopped:
     - Record `down_since` (first observation) in `$KOSMOS_HOME/logs/board-watchdog.state`
       if not already set; exit.
     - GRACE: if `now - down_since < GRACE` (45s) -> exit (a legit in-flight start's bind
       time is not kickstarted - Baron's race fix).
     - THROTTLE: if `now - last_kickstart < THROTTLE` (180s) -> exit (a board that crashes
       on every start does not thrash - Baron's note).
     - Else -> run `kosmos start` (idempotent: no-ops if healthy, refuses cleanly on a
       stranger port), record `last_kickstart=now`, log the action.
   GRACE/THROTTLE are conservative defaults, tunable once Josh's post-reboot board.log
   arrives (Splinter is relaying it; not blocking - the watchdog is cause-agnostic).
2. **`install/kosmos`** (CLI): define `STOP_MARKER="$KOSMOS_HOME/board.stopped"` beside
   PIDFILE (~line 101).
   - `cmd_stop`: write the marker FIRST, then kill (Baron: the stop's own 16180-going-dead
     moment must not trip the watchdog).
   - `cmd_start`: clear the marker EARLY - at the very top, before the healthy/bind checks
     that can fail (Baron's ONE REAL HOLE: a start that FAILS to bind 16180 - exactly the
     #2955 case - must still clear the deliberate-stop intent, or the watchdog stays
     suppressed and the board never recovers; clearing late would let the bug survive the
     fix).
3. **`tools/build-kosmos-bundle.sh`**: add `cp $REPO/bin/board-watchdog.sh $STAGE/app/bin/`
   + chmod +x, mirroring agent-supervisor.sh (line 84). Per-file copy list - without this
   the script never ships (same delivery trap as claude-setup dist).
4. **`install/setup.sh`**: a watchdog plist install block mirroring the board block
   (label `com.kosmos.board.watchdog` + the same non-default-KOSMOS_HOME hash suffix; the
   same `_xmlq` escaping; the unquoted-heredoc safety rules - no backticks/bare $word in
   the body, guarded by tools/test-plist-heredoc-clean.sh; the sandbox guard - no launchctl
   under AGENT_WORKFORCE_LAUNCH; enable-before-bootstrap; leave-already-loaded-alone
   idempotency; the same outcome messaging). ProgramArguments run
   `/bin/bash $KOSMOS_HOME/app/bin/board-watchdog.sh $KOSMOS_HOME`; add `StartInterval`;
   StandardOut/Err -> `logs/board-watchdog.log` (a separate file, NOT board.log - the
   watchdog runs every interval and would spam the board's own log). The board plist stays
   byte-identical (test-install-board-paths / board-shape invariants); this is a NEW plist.

### The 5 cases (traced with Baron, all correct)
- **Normal start:** marker cleared at top; board binds; watchdog sees healthy, stays out.
- **Failed start (the #2955 case):** marker cleared early even though the bind failed;
  board down; watchdog waits GRACE then kickstarts `kosmos start` (throttled). Recovers.
- **Deliberate stop:** `kosmos stop` writes marker first then kills; watchdog sees marker,
  stays out. Stop means stopped.
- **Crash:** board dies, marker absent (last action was a start, which cleared it);
  watchdog waits GRACE, kickstarts. Recovers.
- **Update:** updater runs `kosmos stop` (writes marker, suppresses watchdog) across the
  whole stop->swap window (verified: update.js:463 stops via `kosmos stop`); setup.sh ends
  with `kosmos start` (2714/3460) which clears the marker early and starts the new board;
  watchdog resumes guarding. A FAILED update leaves marker+board-down and the update flow
  owns recovery (any later `kosmos start` - re-run, login job, or the user reopening the
  app - clears the marker).

## Verification
- Unit/harness tests (run without a reboot):
  - watchdog script: marker-present -> no start; healthy -> no start + clears down-since;
    down < GRACE -> no start; down >= GRACE and not throttled -> runs start; within
    THROTTLE -> no start. Driven against a stub `kosmos` and a fake KOSMOS_HOME.
  - CLI: `kosmos stop` writes the marker (before the kill); `kosmos start` removes it at
    the top (even when the subsequent start fails).
  - setup.sh: the watchdog plist is written with the right label/ProgramArguments/
    StartInterval; the board plist stays byte-identical; test-plist-heredoc-clean passes
    on the new heredoc.
- REBOOT-VERIFICATION is the explicit prod gate (staging -> Josh-approval -> prod). It
  MUST log in, not just reboot to the lock screen: the watchdog is a LaunchAgent and is
  GUI-login-scoped, same as the board (Baron's note). The Mortals box reproduces #2955
  and is the test bed (Splinter).

## Rejected / sequenced
- Foreground-mode-first: re-architects `kosmos stop`/`start` and the updater (KeepAlive
  fights the pidfile-kill stop; breaking the updater is a worse regression than the bug).
  Correct as the done-right fix but too large/fragile for the live interim. Baron owns it
  as a follow-up card; this PR references it as the sequel.
- Blind KeepAlive on the board job: loops (launcher exits 0 after daemonising).
- A UI-only fix: the UI already retries; nothing in the UI can start a dead board.

## Weakest premise
GRACE=45s / THROTTLE=180s / StartInterval are picked before seeing Josh's board.log; if
the real failure has a longer legit boot time or a specific zombie-port signature, these
are one-line tunings. The design (marker + grace + throttle) is invariant to them.

## Delivery
kosmos (agent-workforce). Ships in the release bundle via build-kosmos-bundle.sh. PR to
Splinter for Josh, staging-first, reboot-verification as the prod gate.
