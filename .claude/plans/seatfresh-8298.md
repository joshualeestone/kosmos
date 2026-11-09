# seatfresh-8298 (kosmos#8298 items 5 and 6, first half)

## Done when
Served on PROD: `kosmos project show` flags a working member whose summary is over 4 hours old by the clock, once it has done some work; and `kosmos handoff`, run by an agent whose last self-report is more than 10 minutes old, says it was at work when the handoff was run, keeping the old report as the old report.

## What
- engine/projectview.js wallClockStale: past the rhythm by the clock, its own latest report working, and its current stretch of work at 30 minutes or more. 24 hours still applies alone.
- engine/handoff.js stateFact: "at work when this handoff was run; its last self-report: ..." at 10 minutes or more.

## Decisions
- A 30-minute grace, because #5635 F2 fixed a seat woken five hours after its summary reading overdue in its first minute.
- Only the agent's own latest report counts as working, not the board's read of the screen (Josh, 0.7.48).
- Handoff makes no board call: the file makes none, and an agent running the command is better evidence than a read of the screen. Rejected: fetching the board's card state.

## Not in this
Runners that report turn ends only (codex) keep their turn-count rule. The nudge (summarydue-nudge) is unchanged. Item 3 (#7977, seven agents read Can't tell) and item 6's Meta re-deliveries are separate.

## Weakest premise
That the reporter's 12-hour seat had a latest report of working. A seat whose reports stopped reads as before.
