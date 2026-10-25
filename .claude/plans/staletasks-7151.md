# staletasks-7151: the stale task list offers tasks left behind by finished work for retiring

Card: kosmos#7151 (agent feedback, 2026-10-25). Rotation card, my shard (mod 7 == 4).

## Decided (reversible; Josh can override)
- OFFER, never retire automatically. The card allows either. Closing is reversible (tasks.reopen), but an automatic
  close reads as done to a person who was still counting on the task, and nothing in the store can prove nobody is.
  The agent who owns the task decides, with the rule in front of it.
- WHERE: the agent's own `kosmos task list --stale` (#7057), the tool the report praises. No board interface: Josh's
  10-17 hold on new interface (#6501's note) still stands.
- THE RULE (tasks.leftUnder + tasks.retireOffers, after review round 1), printed with every offer. Strict on purpose:
  any sign the person may still want a task means no offer.
  1. in the stale list already: open (not done, built or held) and quiet N days or more;
  2. an agent filed it, naming itself (addedVia process with addedBy); the person's own, one with no record, one with
     no agent named, or a webhook's, is never offered;
  3. nothing on it the person set up: no repeat, due date or done-when, no part added or moved from the screen;
  4. its OWN parent is closed as done (not replaced by another task), and it was made before that close; a task under
     an open parent is part of work still going on, whatever is above it;
  5. retireOffers: never in a project held in two records; never one whose agent needs the person about it (a real
     roster, read only when some row would be offered; an unreadable roster offers nothing); never one whose history
     shows the person acting on it, or a re-parent or reopen since it was made.

## Rejected
- Auto-retire on a timer: see above.
- A board "Clean up" control: new interface under Josh's hold.
- Parent closed alone: catches deliberate follow-ups under finished work.

## Known limit
- taskchat.read answers [] both for no history and for an unreadable one, so an unreadable history reads as none; the
  task's own fields (rules 2 to 4) still guard.

## Weakest premise
"Made before the parent closed" stands for "left behind by that cycle". A task made earlier but still wanted after the
close (an agent's real follow-up that happened to be filed early) is offered too; the offer is advice, and the agent
owning it is the one who closes it.

## Checks so far (17:58 CDT)
- engine/tasks.leftunder-7151.test.js 7/7, server.tasks-leftunder-7151.test.js 3/3; the neighbouring task suites
  (220 pass, 0 fail); fixture-discipline and no-name-refs.
- Broken copies: no made-before check, no filed-by check, no waiting check, no line marker: each red.

## Review
- Round 1: 3 blockers, 5 warnings, 4 nits, all fixed by the stricter rule above. Blockers: repeating tasks (and a
  person-reviewed missed run) were offered; an unreadable roster offered everything; the waiting check had no real
  test (now retireOffers against real fleet cards, with a control). Warnings: a shared project in two records; a
  replaced parent read as finished; due dates, done-when, repeats and screen parts ignored; a walk past an open parent;
  re-parenting invisible. Nits: the Assigner branch dropped (tasks are never written with it); an agent must be
  named; one tree per project; the project filled into the close command; a test renamed. The server test now uses a
  real 30-day-old person entry in the transcript (removing the history check goes red). Engine 14/14, server 2/2, the
  18 task suites 174/174, fixture-discipline and no-name-refs. Broken copies: unreadable roster offering, two records
  allowed, no history check: each red.
