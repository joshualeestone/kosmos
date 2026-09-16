# task-open-closed-3171: clear Open vs Closed on the All-tasks view

**Card:** #3171 (Josh, 2026-09-16, screenshot on the card). On the Projects > a
project > All tasks view, a closed task was distinguished only by a faint gray
"finished" buried at the end of its meta line, and open tasks showed nothing.
Josh: "just need some way to distinguish what's open and what's closed on these."
He asked for a line separating open from closed, and an Open/Closed bubble on the
far right of each row. In the same thread he also asked to show the task number
on this index view (it shows on the project's own task cards but was left off
here).

## What this ships (all in the All-tasks view, `openAllTasksView`)
1. **Far-right Open/Closed pill** on every row (`.tkcard-badge`), reusing the
   existing semantic tokens so it follows light and dark by construction.
2. **A labelled "Closed" divider** (`.tk-divider`) between the open group and the
   closed group. The server (`allTasks()` in `engine/tasks.js`) already returns
   tasks open-before-closed, pinned by `engine/tasks.all-1382.test.js` ("open work
   sorts above finished work"), so the render TRUSTS that grouping rather than
   re-deriving it with a second client sort (repo convention: no two derivations
   of one fact). The divider is a non-`.tkcard` element so it is not counted as a
   row, and render-alltasks asserts exactly one divider, so a change to the server
   order is caught here.
3. **The task number** (`.tkcard-n` "Task N") on each row, matching the project
   column's treatment.
4. Closed titles struck through + dimmed (scoped `#alltasks-list .tkcard.closed b`),
   matching how the project column already draws a finished card.
5. The old ' · finished' meta text is retired (the pill carries it, so it is
   not said twice).

## Guarantees kept
- **#1346 (heading == rows):** `rows` is the one array the heading counts; the
  divider is not a `.tkcard`, so render-alltasks' rendered-row-vs-heading
  assertion is unchanged.
- **Scope:** every one of the six new CSS rules is prefixed `#alltasks-list`, so
  the shared `.tkcard` on the project page / consolidated view is untouched
  (render-tasks.js still passes). The `.tkcard-badge` / `.tk-divider` class names
  are also new and unused elsewhere, but the selector scope is the real guard, not
  name-uniqueness.

## Weakest premise
That `t.isClosed` is the authoritative open/closed flag on the all-tasks payload.
Verified: the render already used it for the strike-through class and the "still
open" count, and the browser-check closes a real task via `/task/N/close` and sees
the Closed pill + divider appear.

## Verification
- `web.alltasks-1382.test.js`: 8/8 (source guarantees intact).
- `render-alltasks.js` browser-check: 19/19, extended to close one task and assert
  the pills, the numbers, the single divider, and the open-above-closed ordering.
- `render-tasks.js`: passes (shared `.tkcard` on the project page unaffected).
- Light + dark screenshots eyeballed.

## Out of scope / follow-on
- Newest-first sort on the project task lists is a sibling ask (#TBD); split agreed
  with Angel (I take tab-view + all-tasks, she takes consolidated-view after #3038).
