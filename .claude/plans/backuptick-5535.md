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
- engine.reachable: 18 run-path excuses removed (their caller, the tick, is wired from server.js now). 10 kept: the
  restore side (restoreSnapshot, openManifest, openVerifiedChunk: restore is NOT wired; the excuse is that record) and
  7 unused key and format helpers. CORRECTED in review 1: this first said "21 made reachable by this wiring". Measured
  (orphan list printed as JSON, not node's array): the guard's "reachable" is a NAME match in any non-test file, so most
  run-path names already read reachable on runbackup-5535 just because backuprun.js names them, and runBackup itself
  only because my own re-decision comment in test-connector-verbs.sh mentions it. A mention, not a call.

## Rejected
- Backing up the data root with excludes: every exclude is a place a credential can be missed, for content the card
  does not ask for.
- Running at boot: every board restart would send a request; an hour later is at most one an hour.

## Weakest premise
That a refusal that names no pair is the right signal to back off on. It covers an unreachable Kosmos+ and an older
connector (no refusal code, review 1), but also any new pre-company refusal; if one of those should NOT wait (a
transient that clears in minutes), the first retry is still an hour away, the doubling only starts after that.

## Tests
engine/backuptick.test.js (7) and engine/backuptick-inputs.test.js (2). Guards by hand: #1732 8/8, connector verbs
27/27, engine.reachable 7/7, every backup test together 417/417.

## Mutants
Measured 19:46 CDT from `date`, all red: T1 workers optional, T2 no already-covered check, T3 a bad project slug added, T4 runs while not enrolled, T5 no backup_off pause, T6 said every tick, T7 no skip while running, T8 nextWeekStart on a Monday gives the same instant, T9 a hidden folder counted as an agent, T10 a success does not reset what was said.

## Review 1 (opus, blind, on 96ecd6d5): two must-fix, three nits, all taken
1. MUST-FIX: nesting was checked one way only; backupsnapshot drops BOTH optional roots of a nested pair, so an agent
   folder holding a project lost both, and one at ~/Kosmos lost every project. FIXED: an outer root replaces the inner
   ones it holds; one that would hold workers is refused. Test asserts no two roots nest by real path.
2. MUST-FIX: "never the data root" was a sentence, not a check; a project or agent folder holding the data root or a
   provider home would sweep it whole. FIXED: `protect` (data root + each config home), a root holding or inside one is
   refused. Tests for both directions and for workers itself inside protected data.
3. NIT: `left` was thrown away, and no workers root still sent a backup-key request hourly. FIXED: left said once per
   change; no workers root, no run and no request.
4. NIT: an older connector gives no refusal code, so backup_off would never pause. FIXED generally: any refusal before
   Kosmos+ named the company backs off 1, 2, 4 ... 24 hours. Test of the schedule and of its reset.
5. NIT: the excuse claim was wrong. FIXED and measured, see Decisions.
Tests 9 -> 13 (+4), inputs test asserts protect.
