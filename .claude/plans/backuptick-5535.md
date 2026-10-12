# backuptick-5535: what a company backup covers, and the hourly tick (kosmos#5535 E0.6 slice (d))

Stacked on runbackup-5535 (itself on four unmerged prerequisites). Rebuilt from main when they land.

## What
engine/backuptick.js: rootsFor (the roots), startTick (the timer and its pauses), inputsHere (the real sources),
startHere (the board's tick). server.js start(): startHere, beside the hourly file-preview sweep.

## Decisions
- Covered: the workers root (REQUIRED), the projects root, projects outside both (elsewhere/<id>), agent folders outside
  the workers root (agents/<id>), each agent's transcripts (backupsessions). Everything but workers is optional.
- NOT covered: the data root. It holds the keys, the backup state, pairing and codex-homes: credentials the card says
  never to take, and Kosmos's own state rather than the person's work.
- Known gap, stated in the header: per-session Codex homes are not transcript roots (sessionsFor takes one codexHome).
- Gate: orgenroll.isEnrolledHere(), the check /api/org uses. First run an hour after start, never at boot.
- backup_off pauses a day (Kosmos+ answers 404 backup_off on backup-key while backup is off, coordinator plan
  orgescrow-5535). overAllowance pauses to the next Monday 00:00 UTC. A tick during a run is skipped.
- A reason a person acts on (refusedState, missing, unreadableKeyFile) is said once, on the board's log, until it
  changes or a run succeeds. A screen for it is later work.
- engine.reachable: wiring the tick makes 21 of the 28 backup excuses reachable; those 21 are removed. The 7 left
  (restore-side and unused key helpers) keep theirs, measured by removing all and reading the guard's list.

## Rejected
- Backing up the data root with excludes: every exclude is a place a credential can be missed, for content the card
  does not ask for.
- Running at boot: every board restart would send a request; an hour later is at most one an hour.

## Weakest premise
That Kosmos+'s only "off" answer is backup_off on backup-key. If it answered off elsewhere first (a grant), the tick
would not pause a day and would ask every hour, each a signed request, one an hour.

## Tests
engine/backuptick.test.js (7) and engine/backuptick-inputs.test.js (2). Guards by hand: #1732 8/8, connector verbs
27/27, engine.reachable 7/7, every backup test together 417/417.

## Mutants
