# #7413: a repeating task's run up to 30 minutes before its slot answers it

**Branch:** `repearly-7413` · **Card:** kosmos#7413 (an outside user's report).

## The defect

A run recorded at 06:15 for a 06:45 daily slot was taken as not done, and the agent was nagged. Three readers in `engine/taskrepeat.js` decide which slot a run answers. The nudge (`dueSlot`) counted a run as early within min(10 min, gap/30), and the missed line and late mark (`answersEarly`, through `answeredSlot` and `firstUnanswered`) within min(15 min, gap/4). A 30-minute-early daily run fell outside both.

## The change

- `earlyWindowFor(rule)` = min(30 min, gap/4) is the one early window: `answersEarly` and `recordBy` (#5920's "record it before") use it.
- The nudge (`graceFor`) uses the same window for slots two hours apart or more, so the nudge and the missed line agree; closer slots keep min(10 min, gap/30), so an hourly late run still leaves the next slot due (#4787 review 3).
- The late mark after a slot keeps the miss grace (15 minutes).

## Tests

`engine/taskrepeat.test.js`: the reported case and a 40-minute control; several daily times; an every-minute agreement sweep asserting the nudge is due for exactly the slot after the one a run answers (uneven 6/9/18 rule, the exact 2-hour pair, weekly); hourly unchanged. `engine/agentnudge.test.js`: the deadline is the next slot less 30 minutes. Every test file that requires taskrepeat, tasks, agentnudge or assigner, plus the repo-wide audits: 68 files, 2280 pass, 0 fail.

## Kept, as on main

For slots under two hours apart the nudge and the missed line can still disagree (the nudge stays cautious for the hourly late-run case). A very late run for the previous slot answers the next slot from 30 minutes before it.
