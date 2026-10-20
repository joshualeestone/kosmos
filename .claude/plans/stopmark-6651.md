# stopmark-6651: an update's pause marker says who wrote it, so a stranded one does not keep the board off (kosmos#6651)

## What this branch does (redesigned at iteration 3: the attribution is a file NAME)
- One shared POSIX block, byte-identical in install/setup.sh, install/kosmos and bin/board-watchdog.sh (pinned by
  the test): `kosmos_start_token` (ps lstart under TZ=UTC0 with spaces as `_`, or Linux start ticks),
  `kosmos_installer_gone`, `kosmos_stranded_pause`, `kosmos_clear_stranded_pause`.
- setup.sh, when it pauses a RUNNING board, first creates an empty `board.stopped.by-install.<pid>.<token>` and
  calls `kosmos stop` with KOSMOS_STOP_BY_INSTALL=1; its EXIT trap removes that name whatever the outcome. A later
  update that finds a stranded pause adopts it (was-running, so its own put-back covers it) and removes the old names.
- A person's `kosmos stop` removes every such name before it writes the marker (an update's own stop keeps them).
- The pause is stranded when the marker is there, the mode lets the board run, and every name's update is provably
  gone. The watchdog (after its board-job gate), board-run (before its refusal) and an agent's start (only once its
  cooldown and claim pass) clear it: marker and names moved aside, kept, logged; a person's marker put back if their
  stop raced the clear.
- tools/test-stopmark-6651.sh (in test:shell); tools/test-update-putback-4818.sh's pin of the pause's stop line updated.

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
- `bash tools/test-stopmark-6651.sh`: 38 PASS, including a real full disk (an 8 MB disk image, filled). Mutants, each red then restored: the start-time comparison removed
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
- Iteration 2 (two WARNINGs and a NIT):
  - A person can choose connect during the very run that is then killed, leaving an attributed marker on a computer
    whose board must stay off. The stranded test now returns "stands" whenever the mode keeps the board off, by
    setup.sh's own rule (no mode file runs; else only run or both). Tested with connect, empty and garbage modes,
    and through the real watchdog; mutant red.
  - "Gone" no longer rests on an error message's language: on Linux, the absence of /proc/<pid> is the proof; elsewhere
    kill -0 runs under LC_ALL=C. A proc: token this reader cannot read (hidepid, another user) stands. Both Linux
    arms are reasoned, not measured: this Mac has no /proc, and macOS's messages are English in any locale, so a
    mutant of either cannot fail here (the suite passes under LANG=fr_FR.UTF-8 too).
- Iteration 3: BLOCKER, the attributed BODY could not be written on a full disk (measured: `: >` succeeds, the printf
  fails ENOSPC), so the card's own incident fell back to an empty person's marker. Redesigned: the attribution is an
  empty file's NAME, which needs no data block (the test writes it on a filled disk image). Also: a second update
  run adopts a stranded pause instead of washing it into a person's stop; the clear puts a person's marker back if
  their stop raced it; the watchdog clears only after its board-job gate; an agent's start clears only after its
  cooldown and claim; the shared block is one text in all three files. Mutants red: mode rule, always-gone, race
  put-back, a person's stop removing the names, the EXIT trap's name removal, the watchdog's gate order.
