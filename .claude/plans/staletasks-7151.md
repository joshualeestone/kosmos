# staletasks-7151: the stale task list offers tasks left behind by finished work for retiring

Card: kosmos#7151 (agent feedback, 2026-10-25). Rotation card, my shard (mod 7 == 4).

## Decided (reversible; Josh can override)
- OFFER, never retire automatically. The card allows either. Closing is reversible (tasks.reopen), but an automatic
  close reads as done to a person who was still counting on the task, and nothing in the store can prove nobody is.
  The agent who owns the task decides, with the rule in front of it.
- WHERE: the agent's own `kosmos task list --stale` (#7057), the tool the report praises. No board interface: Josh's
  10-17 hold on new interface (#6501's note) still stands.
- THE RULE (tasks.leftUnder + the route), printed with every offer:
  1. in the stale list already: open (not done, built or held) and quiet N days or more;
  2. an agent filed it (addedVia process) or the Assigner did (assigner); the person's own, or one with no record of
     who filed it, is never offered;
  3. a task above it in the same project is closed, and this task was made BEFORE that one closed. Filing a follow-up
     under finished work is allowed on purpose (parentProblem), so a task made after the close is new work;
  4. its agent is not waiting on the person about it (tasks.waitingOnPerson; the roster is read only when some row
     would be offered, so the list costs nothing more otherwise).

## Rejected
- Auto-retire on a timer: see above.
- A board "Clean up" control: new interface under Josh's hold.
- Parent closed alone: catches deliberate follow-ups under finished work.

## Weakest premise
"Made before the parent closed" stands for "left behind by that cycle". A task made earlier but still wanted after the
close (an agent's real follow-up that happened to be filed early) is offered too; the offer is advice, and the agent
owning it is the one who closes it.

## Checks so far (17:58 CDT)
- engine/tasks.leftunder-7151.test.js 7/7, server.tasks-leftunder-7151.test.js 3/3; the neighbouring task suites
  (220 pass, 0 fail); fixture-discipline and no-name-refs.
- Broken copies: no made-before check, no filed-by check, no waiting check, no line marker: each red.

## Review
