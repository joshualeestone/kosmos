# emptyday-9033: the daily feedback ask skips an agent with no day of its own (kosmos#9033)

**Posture:** production

**Finished looks like:** a brand-new or idle agent whose day holds nothing (no word with its person in Kosmos, no task it
changed, no room post or message it sent) is not asked for the four-question daily feedback report. An agent with
activity is still asked, as before.

## Why it happened (measured in the code)
engine/feedbacknudge.js asks an idle agent "that itself worked today" (#8572), judged by `lastWorked`. A new agent's
startup turn is work by that test, so the agent the feedback report describes, created that day with nothing else, was
asked, ran `kosmos feedback day`, saw nothing, and wrote a report about having nothing to report.

## Change
- engine/feedbackday.js `hadDay(o)`: true when the agent has today a non-automatic message with its person (the same
  `conversation` reader as `kosmos feedback day`), a task it changed (`taskChanges`), or a room post or agent message it
  sent (the message log's `post` and `message` rows, which the digest does not list: an agent working in rooms all day
  has a day). Fails OPEN: an unreadable thread, task list or log, an agent that answers its person on another channel
  (#8141), or no name counts as a day.
- engine/feedbacknudge.js: the planner passes over a candidate whose `hasDay` is false (a check that throws counts as a
  day); with nobody left it asks nobody and says why. `makeTick` (the board's path) wires the real reader (`hasDayOf`:
  the card's session name and name); `sweepOnce` and `plan` without a check behave as before.
- engine/feedbacknudge-7374.test.js: the gating test gives its tick a `hasDay` (it tests the on/off rule, not days).
- engine/feedbacknudge-9033.test.js: hadDay's kinds and controls, its fail-open arms, the planner, and the real tick in a
  sandbox (an empty day is not asked; once the person writes, it is).

## Rejected
- Turning the ask into the one-line `--unchanged` for an empty day: `--unchanged` means "same as my last report", which a
  new agent has none of, and the ask still costs the person a turn.
- Skipping only an agent's FIRST day: an idle agent on day 40 has the same empty day.
- Counting the startup turn or any `lastWorked` as a day: that is the signal that caused this.

## Weakest premise
That the three readers cover every way an agent spends a day the person cares about. Work that leaves none of them (a
long tool run in its own folder with no message, task change or post) now reads as an empty day, and that agent is not
asked. Its work would also be invisible to `kosmos feedback day`, so its report would have been thin anyway.

## Tests
- node --test engine/feedbacknudge-9033.test.js: 4/4. Mutations: the planner's filter removed fails 2; the tick's real
  reader removed fails the real-tick test.
- Every engine/feedback*, cli.feedback* and server.feedback* test: 364/364.
