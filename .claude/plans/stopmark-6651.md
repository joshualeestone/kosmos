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
- `bash tools/test-stopmark-6651.sh`: 77 PASS, including a real full disk (an 8 MB disk image, filled), dash, and setup.sh's own decision lines run under dash set -eu over a marker x names x mode matrix. Mutants, each red then restored: the start-time comparison removed
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
- Iteration 4 (a BLOCKER, three WARNINGs, NITs; each fixed and mutant-checked, with a control for the dash one):
  - BLOCKER: under dash (Debian's /bin/sh) a failed redirection on the special builtin ":" ends the whole script,
    and `|| x=""` cannot catch it: on a full disk the name create killed the installer before its stop. Now
    `if ( : > name ) 2>/dev/null`. Measured under /bin/dash, with a control showing the plain form does end it.
  - Adoption no longer removes the old names before this run's own name exists (a kill in between left a bare
    marker, a person's stop); a later clear moves them aside.
  - `kosmos start` removes the names with the marker, and its refusal paths put them back (`restore_stop_marker`),
    so leftovers cannot make a later plain marker read as stranded, nor a refused start make a person's stop.
  - Tokens of two kinds (ps vs /proc) are never compared: the pause stands.
  - Evidence keeps the newest ten clears (aside names carry the pid as well as the second); the clear's comment says
    the window it cannot close. Known and accepted: `kosmos restart` on a stranded pause writes a person's marker
    (restart is a deliberate act) and, if its start is then refused, that marker stays.
- Iteration 5 (a WARNING and NITs; each fixed, mutant red):
  - Two updates at once (the card saw two 16 s apart): a second update finding another's LIVE pause now names itself
    too (without taking that update's put-back), so the pause holds while either runs and is stranded only once
    both are gone. Before, killing the first released the board in the middle of the second's swap.
  - An agent's start whose clear backs off (a person's stop or a new update came in) now refuses instead of going
    ahead (`agent_clear_stranded_or_refuse`).
  - restore_stop_marker never ends the CLI under pipefail when one name cannot be put back.
  - Names a run adopted go with its EXIT trap, so a marker the run writes on purpose (kept off at its end) is not
    read as stranded.
  - The clear's log line on a full disk leaked printf's buffer to stdout; a subshell alone did not stop it
    (measured), so the subshell's stdout goes to /dev/null too.
- Iteration 6 (a WARNING and NITs; each fixed, mutant red):
  - During the changeover to this version, a name left by a killed update survives an older `kosmos start` (which
    removes only the marker); a later deliberate stop through that older CLI then sat beside a stale name and the
    next update would adopt it and start a board the person stopped. Now an update touches its name AFTER its stop
    writes the marker, and a gone update's name OLDER than the marker supports nothing (a later stop wrote that
    marker). A live update's name still holds the pause whatever its age.
  - The join comment no longer overclaims: it holds if the other update is killed; if that update finishes, its
    own start clears the marker and every name, as before this card.
  - setup.sh's decision lines are now run, not just read: extracted and executed under dash set -eu across six
    rows of marker x names x mode.
  - The Linux token carries the boot id, so a pid and tick from an earlier boot cannot pass for a live installer
    (reasoned, not measured: no /proc here).
- Iteration 7 (two WARNINGs, both against iteration 6's age rule, which is withdrawn):
  - The post-stop `touch` re-created a name a person's stop had removed during the update's own stop, so a person's
    stop could read as stranded; and an update killed during its own stop (after the marker write, before the
    touch) had a name older than its marker, so its pause read as a person's (measured 2 to 8 in 10). Both are gone:
    no touch, and the age is now taken against the board's last START (board.started-at, written by every start
    since #4466), not the marker. A gone update's name older than the last start is a leftover (that pause ended
    when the board started); a kill at any point of a pause leaves a name newer than the last start. Mutant red.
  - Accepted: within the same second as a start, -nt is false (whole seconds in dash and bash 3.2), so a leftover
    made in the very second the board started would still count; and a kosmos older than #4466 writes no start
    record, so on such a machine a leftover always counts (the transition window iteration 6 named).
- Iteration 8 (a WARNING and a NIT; mutants red): the join branch took any name as "another update's live pause",
  so beside a person's stop (an older kosmos's) with only a leftover name, a killed joiner left the person's stop
  reading as stranded. It now joins only when some name's update is provably running (`kosmos_live_pause`, in the
  shared block). And a start no longer saves leftover names (older than the last start) for its refusal paths to
  put back with a fresh time, which would make them count again.
- Iteration 9 (a WARNING; a NIT accepted): an update whose own ps was refused (a sandboxed shell) made no name, so
  when it adopted or joined a pause the watchdog (with a working ps) could judge the other names gone and clear the
  pause mid-swap. It now always names itself, as "<pid>.unknown" when it has no start time; an unknown name counts
  as gone only once that pid has provably ended (a live or reused pid keeps it: the safe direction). An adopting run
  that still could not make a name moves the adopted names aside (the bare marker of before this card; its put-back
  covers a failure). Matrix rows with ps refused in the updater only; mutants red.
  Accepted residuals, both needing the changeover window: a JOINING run that cannot make any name (no inode) cannot
  protect the other update's pause; and an update killed between creating its name and its stop's marker write,
  followed by a person's stop through an older kosmos, reads as stranded.
- Iteration 10 (a BLOCKER, a NIT): tools/test-setup-pause-sandbox-4651.sh lifts setup.sh's pause block into a harness
  and failed 32 cases on this branch (the block now calls the shared functions and reads the new variables), which
  CI's test:shell would have shown red; I had last run it before the adoption change. Its harness now sources the
  shared block, sets the two variables, and starts each run with no names (a real run's EXIT trap removes its own;
  this harness never runs it, so names from earlier cases read as stranded pauses in later ones). Also found by
  searching for the other tests that pin setup.sh's lines: install.linux-board-4920.test.js pins KillMode, the #5033
  line and the stop as consecutive lines; the naming block now sits above the KillMode line and the pin names the
  new stop line. And a moved-aside unnamed-adopt name now lives outside the by-install glob.
