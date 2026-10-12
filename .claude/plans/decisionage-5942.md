# decisionage-5942: a decision in the task list says how long it has waited (kosmos#5942)

## Done when
A task under Needs Your Decision whose waiting agent said when it began waiting shows "Waiting on you for 12 days"
(through the page's agoWords; "Just started waiting on you" under 5 seconds). No known start shows no age, never a
guess. Every other state shows nothing. The row is the task, so "which task" is the row itself.

## Approach
- engine/status.js: both card paths carry `waitingSince`, from the self-report's `askedAt` (#5943, Angel), only
  while the state is needs_you or blocked; `waitingSinceFrom` keeps a real time only (missing, garbage or ahead of
  the clock is null). A blocked card carries it too; the task side counts a start only from a needs_you card, so a
  card that needs the person for another reason (crash loop, stuck error, trust wait) makes the age unknown (null).
- engine/tasks.js `waitingSinceOf`: the oldest `waitingSince` among the cards that make waitingOnPerson true, chosen
  by one shared rule (`cardsNeedingPerson`). If any of those cards has no known start, null: an age from the others
  could be shorter than the real wait.
- #5943 (Angel, 12:00 CDT): askedAt's run is state + because + project, so the same words about another project
  are dated afresh.
- server.js Tasks route: `waitingSince` on each row while waitingOnPerson, and null whenever a missed repeating run is
  waiting (that wait has no start, so any age could be short).
- web/index.html tskRow: the "Waiting on you for ..." line.
- docs/browser-checks/fixtures/agent-card.json: the recorded card gains `waitingSince: null` (an idle card's value).

## Depends on
#5943 (selfreport.read(name).askedAt). It has merged (eae4ad58b), so a card whose report carries askedAt now shows
its age. The browser arm (render-tasks-view-3559) and the engine tests state both halves
explicitly (a stamped start, a forced null), so neither depends on whether #5943 has merged.

## Decided
- Wording "Waiting on you for 12 days", agoWords with " ago" dropped, agreed with Angel so #5943's "Asked 12 days
  ago" and this read as one system. Weakest premise: that the oldest holder's known wait is the task's wait (any unknown start shows no age).

## After #5943 merged (eae4ad58b, 2026-10-12): done on this card
- Rebased onto main with #5943. Added the unit arm with no selfreport.read wrapper (status.waitingsince-5942.test.js,
  last test): record a needs_you report, read the real card, assert `waitingSince` is the report's own askedAt, with
  pre-controls that askedAt is a real time. The wrapped arms stay, to compare against a fixed time.
- No doctrine bump on this branch (CLAUDE.md gains one map clause only), so main's v30 is untouched.
- A card that needs the person for another reason (a trust wait, a given-up connection, a crash loop) may carry a
  blocked report's start, but waitingSinceOf counts a start only from a needs_you card, so such a task shows no age.
