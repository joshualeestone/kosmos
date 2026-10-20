# stopmark-6651: an update's pause marker says who wrote it, so a stranded one does not keep the board off (kosmos#6651)

## What this branch does
- `install/setup.sh`'s update pause passes `KOSMOS_STOP_BY_INSTALL="<its pid> <that process's start time>"` to
  `kosmos stop --force`. Only that stop: the uninstall and connect-mode stops stay a plain stop.
- `install/kosmos`: `write_stop_marker` writes `install <pid> <start>` for that caller and the empty marker for
  everyone else (a person's `kosmos stop`, unchanged). `stop_marker_stranded` says a marker is stranded only when it
  is an install marker whose pid is gone or now belongs to a process with another start time. `board-run` and an
  agent's `kosmos start` (the #5450 refusal) clear a stranded marker first, moving it aside as evidence and logging
  it. A start that puts back a marker it removed (#4636) restores the words it found (`restore_stop_marker`), so an
  installer's pause is never turned into a person's stop.
- `bin/board-watchdog.sh`: the same `stop_marker_stranded` (pinned byte-equal by the test) at its stop gate; a
  stranded marker is moved aside and logged, and the usual down-streak logic brings the board back. launchd's
  KeepAlive (PathState on the marker) then sees no marker too.
- `tools/test-stopmark-6651.sh` (in `test:shell`); `tools/test-update-putback-4818.sh`'s pin of the pause's stop
  line updated to the attributed line (still immediately after the #5033 arming line).

## Decisions
- Attribution by pid AND start time (`ps -o lstart=`, LC_ALL=C): a pid alone can be reused by an unrelated
  process, which would hold the pause forever. A live installer's pause stands, as the card asks.
- An empty or unrecognised marker is a person's stop, exactly as before: the change can only release a marker that
  says it is an installer's and whose installer is provably gone.
- Moved aside (`board.stopped.stranded.<epoch>`), never deleted, and logged to board-watchdog.log, so the evidence
  the card's recovery used stays.
- Weakest premise (the card's): nothing else writes a non-empty board.stopped today. Checked: every writer in
  install/kosmos, install/setup.sh and bin/board-watchdog.sh writes it empty (`: >`), except the new attributed one.
  engine/linuxboard.js and the Windows files read or name it; none writes words into it.
- Not in this branch: Linux. systemd's `ConditionPathExists=!board.stopped` cannot read the marker's words, and the
  watchdog that clears it is the macOS one (it gates on the board plist). A stranded pause on Linux still needs a
  person; noted on the card as the follow-up.
- Not in this branch: what launched two installs 16 seconds apart (the card says no instrument recorded it).

## Proof
- `bash tools/test-stopmark-6651.sh`: 29 PASS. Mutants, each red then restored: the start-time comparison removed
  (also caught by the byte-equal twin check), the watchdog's clear removed, the writer ignoring the attribution.
- Neighbours, all green on this branch: test-board-watchdog-2955 (0 failures), test-update-putback-4818 (33/33;
  red at first because it pins the pause's stop line, updated), test-setup-pause-sandbox-4651 (0 failures),
  test-board-foreground-2956 (all pass).
- Not run yet: the full suite (Mortals), which includes tools/test-install.sh and its install-static checks.
- Iteration 1 (a BLOCKER and two WARNINGs, each fixed and mutant-checked):
  - BLOCKER: the update attributed its stop even when the board was already off, so a person's empty marker became
    an installer's and a failed update later started a board the person had turned off (connect computers too).
    Now setup.sh attributes only when it is pausing a running board (`_kosmos_was_running=yes`, #5033's own case),
    and write_stop_marker never writes an attributed marker over one already there.
  - lstart is local time, so a different TZ between the installer and the launchd-run watchdog read a live installer
    as gone. The token is now `start_token`: ps lstart under TZ=UTC0, or on Linux /proc/<pid>/stat field 22 (start
    ticks since boot, which a clock step cannot move; reasoned, not measured on Linux).
  - A ps that cannot run printed nothing, read as "gone". Empty now means "gone" only when kill -0 itself says
    "No such process"; anything else leaves the pause.
