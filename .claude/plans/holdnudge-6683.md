# holdnudge-6683: a blocked report that says until when is not re-raised at a fixed age

Card: kosmos#6683 (a feedback report, 2026-10-13: a task on hold on purpose still got an idle nudge, and later a
"your blocked report has stood for 12 days" reminder).

## Measured before building (main 9d3d4fa696)
- Ask 1 (no idle nudge for a held task) ALREADY HOLDS for the task itself: `agentnudge.openParts` skips
  `tasks.isOnHold(t)` (#4771), pinned by `onhold-4771.test.js` ("an agent holding only held work is not nudged").
- Not changed, by decision: a SUBTASK of a held task is still open work. The Assigner hands a held parent's subtask
  out as real work (#5678, pinned in `assigner.test.js`: "a parent on hold kept its tree from everyone" is the failure it
  guards), so nudging its holder about it is consistent. (Review 1 corrected my first reason: `tasks.js`'s "NOTHING
  CASCADES" is about closing, not holds.) I built the cascade first; that test failed and I reverted it. A cascade only
  in the nudge would contradict the Assigner, which gives that work out.
- The likeliest path to the reported idle nudge: a person's `kosmos task hold` from a terminal is recorded as an
  AGENT's hold (`isViaScreen` is false without sec-fetch-site or an Origin), so `holdstale` tells the agent it may run
  `kosmos task unhold`, after which the idle nudge applies. Not changed here (agents run the same CLI, so the board
  cannot tell them apart on that path); stated on the card as a finding.
- Ask 2: the stale-report reminder (`stalereport-nudge.plan`) ignored the report's `--until` and fired once a report was
  a day old (the "12 days" is when the run began, not a constant).

## What changes
- One rule, `selfreport.untilDefers(rep, now)`, read by BOTH the stale reminder (`stalereport-nudge.plan`) and
  `kosmos report show`'s `stale` (review 1: they had to agree, or the agent still heard the old message from report show):
  - `until` a time it reads (an ISO time with its Z, or a date, counted to the end of that day, UTC): held back until it;
  - plain words with no digit ("the owner says"): always held back, the agent named its own end;
  - anything with a digit it cannot read ("2026-10-20 09:30", "10/20", an ISO time with an offset): the age rule, as
    if no until (review 1: a deadline in an unknown form must not switch the reminder off for good);
  - no `until`: as before.
- `untilTimeOf` reads only exact forms, as `status.quotaResetOf`; `Date.parse` alone reads "1" as a year.
- The help of `kosmos report` (install/kosmos and the Windows CLI) says what `--until` does.

## Weakest premise
That an agent's free-text `until` is honest. A vague one ("soon") now hides a block that really is stale; the person
still sees "until soon" on the card, which is the check this relies on.

## Not done
- Ask 3 (who lifts the hold, on the card): optional in the card; not built.
- Pre-existing, not this change: 6 tests in cli.limitmsg-5805 and cli.msgqueue-5187 fail in this worktree with or
  without this change (measured both ways).

## Tests
`engine/stalereport-nudge-5959.test.js`: a date to come is not told, a passed time is, words are never, an unreadable
time is told as if no until, no until is told (control); the date's own day counts; `untilTimeOf` reads only exact
forms. `server.reportshow-card-5959.test.js`: report show's stale follows the same rule (words and a date to come not
stale; an unreadable time and no until stale). Mutants: the rule removed from the reminder, removed from report show,
and the digit fallback flipped, each red.
