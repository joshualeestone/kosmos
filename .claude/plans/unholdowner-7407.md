# unholdowner-7407: taking a task off hold says who has it now, by the Assigner's own rules (#7407)

## Why
An outside user unheld four tasks and one went to an agent unrelated to the work (#7407). Measured on main: a hold
never changes who is on a task (tasks.setOnHold only flips the hold); the Assigner hands out only tasks nobody is on
(handOutable); failover is off by default and skips held tasks. So the case was almost certainly a task nobody was on,
handed to an idle agent once it came off hold: the Assigner's ordinary job, with nothing telling the person it would
happen.

## Call
Explain the hand-out, do not block it (scope comment on the card: blocking would make a once-held task behave
unlike a never-held one, with nothing on screen to tell them apart).
- The hold route's unhold answer carries `next`, one plain sentence (no double quote or backslash, so the Mac CLI's
  sed read prints it whole). Both CLIs print it, and after any sentence ending "To choose who, assign it now." the
  assign command. An older board sends no `next`, and the CLIs print nothing extra.
- The sentence is built from the Assigner's own rules, not a restatement of them. pick's per-task check moved
  unchanged into candidateIn; whoMayGet asks it for every member; treeHeldBy reads pick's tree holders; subtasksFirst
  is candidateIn's subtask check; stallable is stalledParts' task filter (both moved unchanged).
- Branches: open-part holders keep it (finished parts do not count; loose parts said; a failover caveat only where
  failover could move it: live, unpaused, a task it moves, a limited holder that is ours and its tree's sole busy
  holder, and someone else here to take it); someone worked on it but nobody is on it now; the Assigner off; a task it
  never hands out; archived; a tree another builder holds (waits on their work, or only they can take it); paused
  (asked as if resumed); subtasks first (only when someone could take it after); nobody here could be given it; one
  agent ("when they are free"); a subset ("whichever is free first"); or an idle agent on the project. Every promise
  says "in its turn (soonest due first, then oldest)", never "next".
- Agents count only if this board runs them with their swarm not paused (idleCard's checks); an empty roster (no scan
  yet) is unknown, not "nobody". The roster is read lazily and once per unhold, shared with the re-tell.
- Everything after the unhold is recorded is in try/catch: a failure gives an empty `next`, never a refusal.

Rejected: a sentence computed from handOutable alone (round 1: it promised a hand-out pick would never make);
"next idle agent" (round 2: the Assigner gives out in an order); restating failover's conditions (round 5: it missed
the one-builder-per-tree rule).
Weakest premise: the user's task had nobody on it. Evidence of a held task WITH an owner changing hands on unhold
would reopen the card's diagnosis (a hold never moved one on main).
Not covered by a test (each a one-line copy of the Assigner's own card checks; a roster fixture is heavy): the
paused-swarm filter, the empty-roster rule, the not-ours holder rule. The screen does not show `next` yet: #7430.
The Assigner-role ask is #7429.

## Evidence
- cli.unhold-owner-7407.test.js (13 tests, real board and task engine; both CLIs where a CLI is involved), with
  controls against pick, subtasksFirst and stallable themselves, not the sentence's own inputs.
- Related set (engine/assigner*.test.js and every file touching hold, unhold, stalledParts or failover, 37 files):
  0 fail. All 288 test files that import server.js: run before the PR (round 7 found a broken export the keyword set
  missed).
- Mutants, each confirmed applied, the expected test red, the file restored from a copy: whoOf as holders; the whoMayGet
  check skipped; the failover clause dropped; the roster filter dropped; the stallable gate dropped; paused not asked as
  resumed; archived check dropped; someone-else check dropped; subset read as all; tree-held branch skipped; sole tree
  holder dropped; root wording; eager roster; subtasks-first branch skipped; subtasks-first without takers; held tree
  without takers.

## Review
- Round 1: two BLOCKERS (finished-part holders named; "next idle agent" promised where pick would not). Fixed by
  asking pick's own rules. Warnings: paused words, failover, a throw after the record, tests that could not fail. Fixed.
- Round 2: "next" ignored the Assigner's order; non-running members named; paused promise skipped pick's rules;
  failover caveat for tasks it never moves. Fixed.
- Round 3: failover caveat for archived projects and sole members; paused swarms. Fixed; the scope call recorded on
  the card.
- Round 4: BLOCKER, a busy tree holder named as the one who gets it. Fixed (treeHeldBy).
- Round 5: the failover caveat ignored failoverPick's tree rule. Fixed (sole tree holder).
- Round 6: two snapshots per unhold; subtasks-first said as waiting for a person. Fixed (one lazy read; its own words).
- Round 7: BLOCKER, my export line swallowed two existing exports (server.task-roomrun-6894 failed). Fixed and run.
  Subtasks-first and a held tree promised a hand-out with nobody else to take it. Fixed.
- Round 8: CONVERGED, no blocker or warning (exports checked exactly against the merge base). Nits taken: a tree holder
  this board does not run is not named; a root also waiting on other subtasks says so; "a free agent", as the others.
  Left: the assign command echoes the number as typed (cosmetic); no route-level test of the shared roster read (the
  unit test covers unholdNext's reads). Loop ends here (8-round cap).
