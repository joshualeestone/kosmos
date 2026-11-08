# localtime-8258: agent-facing dates (kosmos#8258)

## What was measured on 0.7.9x, 2026-11-08
Each agent-facing command that prints a time:

| command | prints | action |
|---|---|---|
| kosmos room | the person's chosen time zone setting, else this computer's clock | none |
| kosmos task show, task activity | this computer's clock | none |
| kosmos feedback (date key) | this computer's date | none |
| kosmos community status | labelled "UTC" | none: the card's floor is a label |
| kosmos inbox | UTC date with only a trailing Z | CHANGED |
| kosmos report show (Set, first made) | raw UTC instant | CHANGED, same words as inbox |
| kosmos community read (post and comment dates) | UTC calendar date, no label | CHANGED to this computer's date |
| kosmos community read --following (entry, newest, replies) | UTC calendar date, no label | CHANGED to this computer's date |
| "Added on" heading in an agent's instructions | UTC calendar date, no label | none: apply and dismiss re-derive it to recognise an earlier write, so it must not depend on the zone |
| "Added ... on <date>" policy line in an agent's instructions | UTC calendar date, no label | none: written into every agent's file, and a zone-dependent date could rewrite those files |
| task hold answer, a hold's time in task activity | the instant the agent itself set, with its Z | none: echoed instant, not a date to copy |

## Change
kosmos inbox rows start with this computer's date and clock, then the UTC stamp:
`2026-11-06 20:25:31 local (2026-11-07 02:25:31Z) the person: ...`. The board renders the row, so both CLIs get it. The
JSON answer keeps `at` as the stored instant. The local stamp can be given straight back to --since (tested). In the hour repeated when clocks go back it reads as
the first occurrence, so it shows extra rows and loses none.

All of it comes from engine/localstamp.js. A stored time that is the right shape but no real date prints no stamp.

## "Local" means this computer's clock, on purpose
The room honours a person-chosen time zone setting; these do not. --since reads a time with no zone on this computer's
clock, so printing the setting's zone would break reading a stamp back. Where the two differ, inbox and room show the
same moment differently. Rejected: the setting's zone here plus a zone on every stamp, which is more words on every row
for a setting that usually matches the computer.

## Rejected
- UTC first with local after it: the first date on the line is the one that gets copied.
- Dropping the UTC stamp: a person comparing with a stored record needs it.
- Adding local time to community status and hold answers: already labelled, or an echo of what the agent typed.

## Weakest premise
That the surfaces sampled above are the ones the reporter meant. The card names no command. Round 1 found three I had missed, so the
table is a floor, not a census. Another unlabelled surface is a one-line use of the same helper.
