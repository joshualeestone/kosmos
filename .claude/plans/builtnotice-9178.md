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

## Review round 1 (21:10): no blocker; fixed
- SHOULD-FIX: the new holder was excepted whether or not its heard line went out (budget skip, COULD_NOT). Fixed at both
  sites: excepted only when the heard line was PLACED or UNCONFIRMED; otherwise it is owed a re-read like the others.
- SHOULD-FIX: the agent-adds test expected what the control expects, so it could pass with no notice at all. Fixed: a
  third holder (nia) who must be owed one; plus a heard-did-not-go-out test at each site.
- SHOULD-FIX (coverage): droppedBuiltForWork was only ever stubbed. Added engine/builtnotice-9178.test.js on the real
  engine: an add on a built task (true), on a plain one (false), a give open (true), a keepBuilt give (refused inside
  the write, writes nothing: measured), a part put back (true), and a fresh read of the task (false).
- NIT fixed: `except` names are trimmed. NIT fixed in the comment: the Assigner never reaches the notice with a
  dropped mark (it refuses a built task inside the write), so `failoverFrom` is only a backstop. That also answers this
  plan's earlier weakest premise.
- Measured: server test 7/7, engine test 5/5; mutant (always except the assignee) fails exactly the heard-did-not-go-out
  give test, restored byte-identical; neighbours and meta 64/64.

## Review round 2 (21:13): no blocker, no defect in the logic; one coverage gap fixed
- Checked clean (reasoned): no path sends a heard line AND a re-read; the async heard line is awaited before the notice
  is built; the budget-skipped arm returns COULD_NOT (so its holder is owed one); every Assigner path refuses a built
  task inside the write, so the notice fires only on a screen give or an unnamed process give.
- SHOULD-FIX (coverage): no test drove an UNCONFIRMED heard line, so dropping that half of the rule passed. Added a test
  at both sites. Mutant (PLACED only at the add site) fails it; restored byte-identical.
- NIT fixed: the test's stale "not typed" comment.
- Residuals accepted (reasoned): an UNCONFIRMED paste that is never submitted leaves the new holder without a re-read
  (UNCONFIRMED is counted as went, the side that avoids a duplicate); an adder that cannot be named is owed a re-read of
  its own change (errs toward telling, as owesNotice does).
- Measured: server test 8/8, engine test 5/5.
