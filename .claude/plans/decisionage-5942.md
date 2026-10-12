# decisionage-5942: a decision in the task list says how long it has waited (kosmos#5942)

## Done when
A task under Needs Your Decision whose waiting agent said when it began waiting shows "Waiting on you for 12 days"
(through the page's agoWords; "Just started waiting on you" under 5 seconds). No known start shows no age, never a
guess. Every other state shows nothing. The row is the task, so "which task" is the row itself.

## Approach
- engine/status.js: both card paths carry `waitingSince`, from the self-report's `askedAt` (#5943, Angel), only
  while the state is needs_you or blocked; `waitingSinceFrom` keeps a real time only (missing, garbage or ahead of
  the clock is null). A blocked card carries it too, but needsPerson does not count blocked, so no Tasks row
  ever shows a blocked agent's age.
- engine/tasks.js `waitingSinceOf`: the oldest `waitingSince` among the cards that make waitingOnPerson true (the
  same holders, the same project rule, #5034 members).
- server.js Tasks route: `waitingSince` on each row while waitingOnPerson (null when only a missed repeating run is
  waiting: that has its own repeat line).
- web/index.html tskRow: the "Waiting on you for ..." line.
- docs/browser-checks/fixtures/agent-card.json: the recorded card gains `waitingSince: null` (an idle card's value).

## Depends on
#5943 (selfreport.read(name).askedAt). Until it merges, no card carries waitingSince, so no row shows an age: the
change is inert, not wrong. The browser arm (render-tasks-view-3559) and the engine tests state both halves
explicitly (a stamped start, a forced null), so neither depends on whether #5943 has merged.

## Decided
- Wording "Waiting on you for 12 days", agoWords with " ago" dropped, agreed with Angel so #5943's "Asked 12 days
  ago" and this read as one system. Weakest premise: that the oldest holder's wait is the task's wait.

## After #5943 merges (owed, on this card)
- Add one unit arm with no selfreport.read wrapper: record a needs_you report, read the real card, assert
  `waitingSince` is the report's askedAt. The card tests wrap the read today because main has no askedAt.
- Cards that need the person for other reasons (a trust wait, a given-up connection, a crash loop) never carry a
  start, so a task held only by such an agent shows no age. That is the "no known start" rule, not a gap.
