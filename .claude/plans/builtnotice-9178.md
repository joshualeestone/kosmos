# builtnotice-9178: new work that drops a task's built mark owes its other holders a re-read (kosmos#9178)

## Why
#9176 shows "[built: ...]" in a holder's instruction block. New work drops that mark (#3951: a part added, a part
given open, a part put back). The routes re-synced every holder's block but passed no `notice`, so an existing holder
kept the copy it read at its start, still saying built.

## Change
- engine/tasks.js: `droppedBuiltForWork(task)`, from writeParts' own mark (DROPPED_FOR_WORK), carried on the returned
  task (no module state).
- server.js `tellEveryoneOn`: an `except` list: holders already told about this change another way are synced but
  never owed a second message.
- The give helper (part-assign route and the Assigner): when the give dropped the mark, a notice, except the new
  assignee (its heard line) and the failover source (engine/failovertell.js owes it one line, #8989 review 5).
- The part-add route: when the add dropped the mark, a notice, except the new part's holder (heard line); the agent that
  added it is the notice's `by` (as the reopen route names its caller).
- The part close/reopen route already passed a notice (#8989): unchanged.

## Measured
- server.built-notice-9178.test.js 5/5 (add from the screen, add by an agent, give from the screen, and a control each
  where no mark dropped). Mutant: dropping `except` at the add site fails 2 of 5; restored byte-identical.
- With server.built-sync-9176, engine/builtmark-9176, server.reread-close-8989, server.reread-e2e-8989, the tmpscope
  guard and fixture-discipline: 57/57.

## Weakest premise
The failover-source exclusion in the give helper is reasoned, not tested: it needs the Assigner's failover path. A
second message there would be a duplicate, not a lost one.
