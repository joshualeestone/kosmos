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
  4. its parent is closed as done (not replaced by another task), it was made before that close, and every task above
     the parent is closed as done too (a closed step of open work is work still going on);
  5. retireOffers: never in a project held in two records; never one whose agent needs the person about it (a real
     roster, read only when some row would be offered; an unreadable roster offers nothing); and only one whose WHOLE
     history is rows an agent wrote naming itself (an allow-list, agentOnlyHistory), beginning with its creation by a
     named agent: most rows the person's screen writes carry no sign of who wrote them, so anything else rules it out.

## Rejected
- Auto-retire on a timer: see above.
- A board "Clean up" control: new interface under Josh's hold.
- Parent closed alone: catches deliberate follow-ups under finished work.

## Known limit
- Each candidate's transcript is read twice (once for its quiet date, once for the allow-list). Only candidates pay it.

## Known limit (review 4)
- "An agent filed it" rests on the CLI naming the sender from its tmux session, so a task the person types with
  `kosmos task add` inside an agent's session reads as that agent's. That identity model is fleet-wide, not this card's.

## Weakest premise
"Made before the parent closed" stands for "left behind by that cycle". A task made earlier but still wanted after the
close (an agent's real follow-up that happened to be filed early) is offered too; the offer is advice, and the agent
owning it is the one who closes it.

## Checks at the first build (17:00 CDT; later rounds below)
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
- Round 2: 1 blocker, 3 warnings, 4 nits. Blocker fixed: the history check was a deny-list, and most of what a person
  does (a screen message, a hold or due date set and cleared, a part moved, a repeat cleared) leaves no person mark;
  it is now an allow-list of rows only an agent writes, naming itself, tested against the engine's own writers
  (create, setDue, setOnHold, say) with controls. Warnings fixed: every task above the parent must be finished; an
  empty or unreadable history is no longer "never touched" (the history must begin with its creation); the line
  speaks to the task's owner ("If one is yours"). Nits fixed: the server test's header; the history control uses real
  row kinds; the rule is three short lines (each under 200 characters, asserted). Recorded: the transcript read twice
  per candidate. Engine 16/16, server 2/2, task suites 176/176, tree guards. Broken copies: allow-all, parent only:
  each red.
- Round 3: 0 blockers, 5 warnings, 4 nits. Fixed: hold rows dropped from the allow-list (via 'agent' means "not the
  screen", which includes the person's terminal); a task with an open task under it is not offered (tested, with a
  closed-child control); the server test gives every task its real creation row, so each fails only on its named
  rule (turning off the filed-by and made-before checks now reds it). Decided and recorded on the card: safety over
  coverage (the allow-list rejects agent-only histories whose rows name nobody: Assigner hand-outs, messages, parts);
  built and held tasks are never offered (the person reviews or parked them). Nits: stale comments, #5's title, the
  plan's checks heading, the card's old rule (a new comment replaces it). Not taken: a screen-opened mark as a hint
  (the allow-list already rules out anything the person did that is recorded). Engine 17/17, server 2/2.
- Round 4: 0 blockers, 3 warnings, 3 nits. Fixed: every task under it at ANY depth must be closed and an agent's (an
  open grandchild, or a closed step the person added, ruled it in before); the route wraps the offer in a try/catch
  that offers nothing (a throw left the request hanging: the new test fails without it, by timeout); the filer's own
  wait counts too, for an unassigned task; the plain-list test now has an offered task, so it can fail. Recorded: the
  tmux-session identity limit (Known limit). Engine 19/19, server 3/3, task suites 180/180, tree guards. Broken copies:
  one level only, no filer check, no try/catch: each red.
