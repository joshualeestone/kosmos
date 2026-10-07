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
  `kosmos start`. The Mac app's own start (if it does not call `kosmos start`) would read as the supervisor.

## Verification
- cli.startedby-5450: board-run with no mark says supervisor; a fresh mark says person and is consumed; a stale or
  unreadable mark is not a person and is consumed; source pins for the mark before the kickstart and the direct start.
- engine/restartnote-5359: the supervisor makes a note 40 minutes after the boot (control: unknown does not); a person
  never does (control: unknown and quick does); the other rules hold; atStart removes the variable and ignores an
  unknown value. Mutations: each of the four parts reddens.
