# startedby-5450: the restart note asks the launcher who started the board

**Branch:** `startedby-5450` · **Card:** kosmos#5450 (follow-up to #5359, found in its blind review 4) · **Base:**
restartnote-5359 (#5359 part 1, not yet merged), rebased onto main once it is.

## The defect
The restart note said Kosmos "started again by itself" when the board started within 15 minutes of the computer
booting. That timer stands in for "the supervisor started it" and is wrong both ways: a person opening Kosmos quickly
after a restart got the note, and a machine left at a login screen for longer (FileVault, a Windows sign-in) did not,
though the login item did bring Kosmos back by itself.

## The change (Mac; Windows is Homer's, specified on the card)
- install/kosmos: `board-run` (the supervised entry: launchd's login item and its crash relaunches) execs the board with
  `KOSMOS_BOARD_STARTED_BY=supervisor`, unless `kosmos start` left a fresh mark (board.person-start, at most 120 s old)
  (written first in `kosmos start`, review 3): then `person`. The board consumes the mark in atStart; board-run deletes
  none (review 4). A stale one is the supervisor's; one that cannot be judged (unreadable, not a time, from the future)
  is `unknown`, so the timer decides (review 5). The direct (nohup) start says `person`.
- server.js takes the variables out of the environment as it loads (no agent inherits them) and passes them to
  engine/restartnote.js atStart, which removes a used person's mark. noteFor: `person` makes no note; `supervisor`
  replaces the after-boot timer; anything else keeps the timer.

## Decided
- A file mark rather than an argument: launchd runs the plist's fixed ProgramArguments, so a kickstart cannot pass
  anything to board-run; the file is the only channel from `kosmos start` to the board it starts.
- 120 s: a kickstart brings the board up in seconds; a mark older than that is from a start that never ran board-run.
- Unknown keeps the timer, so Windows behaves exactly as before until its launcher says who started the board.
- Weakest premise: that every supervised start on a Mac goes through board-run and every person's start through
  `kosmos start`. Checked: the Mac app starts the board with `kosmos start` (native-app/main.swift startBoard), and is
  not registered as a login item. Since review 3, `kosmos start` writes the person's mark FIRST, even when it then
  finds the board already running; such a mark goes stale in 120 s and can only make a relaunch read as a person's.
  Left (review 7, the safe direction): macOS reopens apps that were open at shutdown ("Reopen windows when logging
  back in"). If Kosmos was open, its relaunch runs `kosmos start`, whose mark can reach board-run before the login job
  reads it, so the note is not made. Telling a system relaunch from a person's open needs the app (Swift) to pass
  KOSMOS_START_BY=supervisor on that launch: recorded on #5450 for whoever takes the app's half.
## Verification
- cli.startedby-5450: board-run with no mark says supervisor; a fresh mark says person and is consumed; a stale or
  unreadable mark is not a person and is consumed; source pins for the mark before the kickstart and the direct start.
- engine/restartnote-5359: the supervisor makes a note 40 minutes after the boot (control: unknown does not); a person
  never does (control: unknown and quick does); the other rules hold; atStart removes the variable and ignores an
  unknown value. Mutations: each of the four parts reddens.

## Review 1
- FIXED (blocker): board-run could stop before starting the board under set -e (an unreadable mark, or "0999999999"
  read as octal), leaving launchd to crash-loop on the same mark. Every read is now guarded, the numbers are base 10
  and bounded to 12 digits, and a mark from the future (a clock set back) is not a person. Pinned with a mode-000
  mark, a leading zero, a future mark and a 23-digit one.
- FIXED (blocker): the watchdog brings a dead board back with `kosmos start --force`, which read as a person's start,
  so the reboot case the note exists for lost its note. The watchdog's two starts now say KOSMOS_START_BY=supervisor,
  which `kosmos start` honours (no mark on the supervised path; supervisor on the direct path). Pinned on both lines.
  Installs and updates still read as a person's: a person ran them.
- FIXED: board-run no longer deletes a person's mark; the board deletes it in atStart once it has used it, by its own
  name only (KOSMOS_BOARD_PERSON_MARK). A board that died before then is relaunched still knowing a person started it,
  instead of making a false note.
- FIXED: server.js takes KOSMOS_BOARD_STARTED_BY and the mark path out of the environment as it loads, before anything
  could start a process that inherits them, and passes them to atStart. Pinned by a server test.
- `kosmos stop` removes a start's mark. The allow-list in atStart is gone (noteFor already treats any other value as
  unknown, so the arm could never fail).
- Mutations: the guarded cat, the age check, the watchdog's word, server.js's delete and atStart's consume each
  reddens. (board-run deleting a person's mark is guarded by the "LEFT for the board" arm; the mutation that would put
  a deletion back was blocked by the harness's rm safety check, so it was not run.)

## Review 2
- FIXED: KOSMOS_START_BY (the watchdog's word to `kosmos start`) could reach the board and, through it, every pane a
  person later started Kosmos from, making their start read as the supervisor's. Both launchers strip it and server.js
  deletes it as a backstop; pinned behaviourally (an inherited value never reaches the stub board) and by source.
- FIXED: `kosmos stop` removes a start's mark on every branch, not only when it killed a running board.
- Left: a supervisor-started board can delete a person's fresh mark (since review 3 the mark is written before the
  running-board check, and that board's atStart removes it). Harmless: that person's start finds the board running
  and starts nothing, and the deleting board really was the supervisor's. And the watchdog's kickstart escalation reads a person's mark if one is under 120 s
  old (vanishingly rare, and fails toward no note).

## Review 3
- FIXED (dangerous direction, narrow): `kosmos start` removed the stop marker first, which lets launchd's KeepAlive
  relaunch board-run at once; a board-run that ran before the person's mark existed read the start as the supervisor's
  and could show a false "came back by itself" (after a stop that left the alive record). The mark is now written
  first, before the stop marker goes. A start that finds the board already running leaves a mark that goes stale in
  120 s; within that it can only make a relaunch read as a person's (no note), the safe direction. Pinned (order).
- FIXED: server.js handing the launcher's word to atStart was unguarded (a bare atStart() left every test green). The
  server test now records what atStart receives. Mutation red.
- FIXED: stale comments from before review 1 (who consumes the mark) in install/kosmos and this plan; server.js says
  why worldenv's frozen copy of the environment is harmless.
- Left: a person's board that crash-loops at startup for over 120 s before atStart reaches the supervisor's reading
  on the next relaunch (the mark went stale). It needs a two-minute startup crash loop on the first start after a boot.
- Windows note for Homer: engine/win32board.js startedByTask already tells a task start from others, though a person's
  start may also go through the task.

## Review 4
- FIXED (dangerous direction, narrow): board-run removed a stale mark after reading it, which could remove a person's
  fresh mark written in between and make the kicked board-run read the supervisor's. board-run now deletes no mark (the
  board does once started, and `kosmos stop`); a stale one is simply not read as a person. The mark is written whole
  (temp file, then rename), so board-run never reads it half-written.
- FIXED: with no working clock, a mark that is there reads as a person's (no note), never the supervisor's.
- FIXED: the direct start strips KOSMOS_BOARD_PERSON_MARK too.
- ADDED behavioural tests: `kosmos start` (already-running path) writes a person's mark and the watchdog's does not;
  `kosmos stop` removes the mark when no board is running. Mutations red.
- Checked: the Mac app is not a login item (no SMAppService or login-item registration in native-app or setup.sh), so
  its `kosmos start` is a person opening it, as assumed.

## Review 5
- FIXED: a mark that is there but cannot be judged read as the supervisor's, switching the timer off on an ambiguous
  input (the one branch that could make a false note). It is now `unknown` (the timer decides, as before #5450),
  consistent with the no-clock branch leaning away from a false note. A valid stale mark stays the supervisor's.
- FIXED: the direct start's default (person) was unpinned (flipping it left every test green); now pinned.
- FIXED: a temp mark left by a failed write is removed; the direct start passes the mark path, so the board consumes
  the mark on both paths; stale comments here and in install/kosmos.

## Review 6
- FIXED (test gap, dangerous direction): nothing passed the string 'unknown' to noteFor, so a rule treating only a
  missing value as unknown would have let board-run's 'unknown' switch the timer off. Pinned (a late unknown start
  makes no note; control: a quick one does).
- ADDED: the 120 s bound on both sides (110 s fresh, 125 s stale); `kosmos stop` also removes a killed start's temp mark.

## Review 7
- PINNED: the board removes the mark whoever started it (supervisor, unknown), not only for a person; limiting it
  would leave an unjudgeable mark in place and bring the timer back on every later relaunch.
- Plan text brought up to date (the mark is written first since review 3); the app reopened at login is named above.

## Review 8
- Left, decided: the mark's age is judged by the same clock that wrote it, so only the clock jumping forward by more
  than 120 s between a person's start and board-run reading the mark (a time sync landing in those seconds, just after a
  boot) makes a fresh person's start read as stale, and so as the supervisor's; with the alive record from before the
  boot, that would be a false note. Rejected: judging by the file's mtime (the same clock) or a boot-time stamp (more
  moving parts for a seconds-wide window). A Mac keeps its time across a restart and syncs early.
- A start that finds the board running leaves a mark that goes stale in 120 s; anything that later restarts the board
  without board-run or `kosmos start` leaves it there, stale, which reads as the supervisor's: the real starter.
- Comment in the reclaim path brought up to date (the person's mark comes first).
