# #9168: the Assigner hands out a new unowned task before a hold placed seconds later

Split from #9166 item 1 (feedback triage 11-26, two reports, one agent a non-builder).

## Mechanism (read from origin/main 3fb2aec358)
- The Assigner runs on its own 60 s timer (server.js, AGENT_WORKFORCE_ASSIGNER_MS).
- `handOutable` refuses a task that is ON hold, but between `task add` and `task hold` there is no hold. A tick in that
  gap gives the task out; for a hold S seconds after the add, about S/60 of such tasks.

## Change (engine/assigner.js)
- `NEW_TASK_GRACE_MS` = 60 s (exported). `tooNewToGive(t, now)`: true when the task's createdAt is 0 to 60 s before
  `now`. A createdAt AHEAD of the clock is not held back (a bad clock must not park a task for good).
- `pick(session, projects, taken, now)` skips such a task. `step` passes its `now`. pick with no `now` (direct
  callers) behaves as before.
- Deliberately NOT in `handOutable`: that filter is shared with `willMove` (does an open subtask hold its parent back)
  and with `whoMayGet` via candidateIn (the unhold answer). Put there, a brand-new subtask would read as "will not
  move", and its parent would be handed out instead of waiting. A young task also still counts as open work for the
  goal ask (blocksGoalAsk is untouched). A person can give a young task to anyone at once.

## Rejected
- Make `task add` and `task hold` one step: the reports used two commands, and agents and people will keep doing so.
- A longer grace: one tick is the gap that matters; more only delays work.

## Cost
A new unowned task waits up to about two ticks (its 60 s, then the next tick) before the Assigner gives it out. While
it waits, the agent it would go to is not asked to draft tasks for another project (review 1).

## Weakest premise
That holds which lose the race land within a minute of the add. A hold placed later than that still loses, exactly
as today; this only closes the "add then hold at once" case the reports describe. Still exposed, by design: a new part
added to an old task nobody is on, and a reopened task, are given at once (the wait keys on the task's createdAt).

## Tests: engine/assigner-holdrace-9168.test.js (6 at first, 8 after review 1), each clock set from the task's own createdAt
- CONTROL: a task one tick old is given. A task 5 s old, and 59.999 s old, is not.
- add, tick at 5 s (not given), hold, tick after the grace: never given.
- a createdAt ten minutes ahead of the clock: given.
- an old parent with a brand-new subtask: neither is given; a tick later the subtask goes first.
- pick with no clock: unchanged.
- Controls, each a perturbed engine/assigner.js: grace removed (3 fail); grace moved into handOutable (4 fail,
  including the parent case); a future createdAt counted as young (1 fail).
- Existing: the 21 test files that touch the Assigner, 509/509. (First version counted a future createdAt as young,
  which failed 20 existing tests: they run the Assigner at a 2001 clock over tasks stamped now. Bounded to 0..60 s.)

## Reviews
- Round 1 (opus): 0 BLOCKER, 2 WARNING, 0 CONVENTION, 3 NIT.
  - WARNING: with its only candidate held back by the wait, pick returned null and step went on to the goal ask, so
    the idle agent could be asked to draft tasks for ANOTHER project (spending that project's daily ask) and go busy,
    missing the new task. Fixed: pick reports a held-back candidate (`held.young`), and step skips the goal ask for
    that agent on that tick. Test + CONTROL (nothing waiting: the other project IS asked). Perturbation D (skip
    removed): 1 fail.
  - WARNING: the hold-race test's last assertion also passed on main. Fixed: an unheld twin is added with the held
    task; after 60 s only the twin goes.
  - NITs taken: "one tick" reworded "60 s" (the wait is wall-clock, whatever the timer); the parts/reopen residual is
    named above. NIT not taken: a young task with an earlier due date is skipped for that minute (due dates are set
    after creation; one minute).
  - After: new file 8/8; controls A (no grace) 4 fail, B (grace in handOutable) 6 fail, C (future young) 1 fail, D 1
    fail; the 21 files that touch the Assigner 511/511.
