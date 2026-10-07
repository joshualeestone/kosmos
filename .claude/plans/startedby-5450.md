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
  just before it kickstarted the supervised board: then `person`. The mark is consumed either way; a stale or
  unreadable one is not a person. The direct (nohup) start always says `person`.
- engine/restartnote.js: atStart reads the variable once and deletes it from the environment (no agent inherits it).
  noteFor: `person` makes no note; `supervisor` replaces the after-boot timer; anything else keeps the timer.

## Decided
- A file mark rather than an argument: launchd runs the plist's fixed ProgramArguments, so a kickstart cannot pass
  anything to board-run; the file is the only channel from `kosmos start` to the board it starts.
- 120 s: a kickstart brings the board up in seconds; a mark older than that is from a start that never ran board-run.
- Unknown keeps the timer, so Windows behaves exactly as before until its launcher says who started the board.
- Weakest premise: that every supervised start on a Mac goes through board-run and every person's start through
  `kosmos start`. Checked: the Mac app starts the board with `kosmos start` (native-app/main.swift startBoard), and
  `kosmos start` returns before the kickstart (and before writing the mark) whenever the board is already running or
  busy, so opening the app after the login item brought the board up leaves no mark. Left: a person who opens the app
  in the few seconds while launchd's board is starting but not yet listening kickstarts it with the mark, so that
  restart reads as a person's and makes no note: the safe direction (a missing note, never a false one).

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
