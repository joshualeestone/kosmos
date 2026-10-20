# holdnudge-6683: a blocked report that says until when is not re-raised at a fixed age

Card: kosmos#6683 (a feedback report, 2026-10-13: a task on hold on purpose still got an idle nudge, and later a
"your blocked report has stood for 12 days" reminder).

## Measured before building (main 9d3d4fa696)
- Ask 1 (no idle nudge for a held task) ALREADY HOLDS for the task itself: `agentnudge.openParts` skips
  `tasks.isOnHold(t)` (#4771), pinned by `onhold-4771.test.js` ("an agent holding only held work is not nudged").
- Not changed, by decision: a SUBTASK of a held task is still open work. `tasks.js` states it ("NOTHING CASCADES"), and
  `assigner.test.js` pins it (#5678: "a parent on hold kept its tree from everyone" is the failure it guards). I built
  the cascade first; that test failed, which is how I found the rule, and I reverted it.
- The likeliest path to the reported idle nudge: a person's `kosmos task hold` from a terminal is recorded as an
  AGENT's hold (`isViaScreen` is false without sec-fetch-site or an Origin), so `holdstale` tells the agent it may run
  `kosmos task unhold`, after which the idle nudge applies. Not changed here (agents run the same CLI, so the board
  cannot tell them apart on that path); stated on the card as a finding.
- Ask 2: the stale-report reminder (`stalereport-nudge.plan`) ignored the report's `--until` and fired once a report was
  a day old (the "12 days" is when the run began, not a constant).

## What changes
- `stalereport-nudge.plan`: a report with `until` is not reminded at its age.
  - `until` an exact time (ISO with Z) or a date (YYYY-MM-DD, counted to the end of that day, UTC): not before it.
  - `until` anything else ("the owner says", "Monday's release"): never re-raised by age; the agent named its own end
    and the card shows it to the person.
  - No `until`: as before.
- `untilTimeOf`: only exact forms, as `status.quotaResetOf` reads its until; `Date.parse` alone reads "1" as a year.

## Weakest premise
That an agent's free-text `until` is honest. A vague one ("soon") now hides a block that really is stale; the person
still sees "until soon" on the card, which is the check this relies on.

## Not done
- Ask 3 (who lifts the hold, on the card): optional in the card; not built.
- `kosmos report --until` help does not yet say that a date is read.

## Tests
`engine/stalereport-nudge-5959.test.js`: a date to come is not told, a passed time is, words are never, "1" is not a
time, no until is told (control); the date's own day counts; `untilTimeOf` reads only exact forms. Mutant: the until
rule removed, red.
