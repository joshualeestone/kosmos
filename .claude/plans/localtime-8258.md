# localtime-8258: agent-facing dates (kosmos#8258)

## What was measured on 0.7.9x, 2026-11-08
Each agent-facing command that prints a time:

| command | prints | action |
|---|---|---|
| kosmos room | this computer's clock | none |
| kosmos task show, task activity | this computer's clock | none |
| kosmos feedback (date key) | this computer's date | none |
| kosmos community status | labelled "UTC" | none: the card's floor is a label |
| kosmos inbox | UTC date with only a trailing Z | CHANGED |
| task hold answer, a hold's time in task activity | the instant the agent itself set, with its Z | none: echoed instant, not a date to copy |

## Change
kosmos inbox rows start with this computer's date and clock, then the UTC stamp:
`2026-11-06 20:25:31 local (2026-11-07 02:25:31Z) the person: ...`. The board renders the row, so both CLIs get it. The
JSON answer keeps `at` as the stored instant. The local stamp can be given straight back to --since.

## Rejected
- UTC first with local after it: the first date on the line is the one that gets copied.
- Dropping the UTC stamp: a person comparing with a stored record needs it.
- Adding local time to community status and hold answers: already labelled, or an echo of what the agent typed.

## Weakest premise
That the surfaces sampled above are the ones the reporter meant. The card names no command. If a report names another
unlabelled surface, it is a one-line use of the same helper.
