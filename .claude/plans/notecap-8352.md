# notecap-8352: room for an honest partial in a built note (kosmos#8352)

## Problem
The note on `kosmos task built` was capped at 300 characters. An honest note on partly finished work ran to about 450; cutting it to fit made the work read more finished than it was.

## Change
`BUILT_NOTE_MAX` is 1000. Any Tasks row with a note over 240 characters shows the first 240 and says "(the rest is on its page)". The task's page, `task show` and the line sent to other agents carry it whole.

## Decided
- One longer note, not a field per completion condition. The ask offered either; a per-condition field is a new shape on every surface for a problem a longer note solves.
- 1000: about twice the reported need. The line sent to other agents has room, as a message may be 10000.
- The row says there is more, so a cut note does not itself read as finished.

## Weakest premise
That 1000 is enough, from one report of 450.

## Not done
The related point on the card (a condition naming a pending decision is not re-checked when it lands) is marked there as not part of this ask.
The iPhone wraps the whole note on its row.
