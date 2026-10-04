# #4786: the room's back-and-forth valve gives work moving a bounded allowance

Card: joshualeestone/kosmos#4786 (claimed:angel). Branch roomvalve-4786, off main fc006ce1e.

## What finished looks like
A room whose posts come with work moving forward in the project (a task made, a part added, a first close or built
mark, a part handed to someone new) gets more room before the back-and-forth valve holds it; a room with no work
moving is held exactly as before; and no amount of cheap task activity can keep a loop running past twice the cap.

## The change
- engine/taskchat.js: progressTimes(projectId, now), every first-time forward step in that project's task
  histories, oldest first. A row dated after now is skipped (clamped, it would count in every later window, past
  the person's reset); a task file last written before the count began is not read (it can hold no step since; where
  mtime lags, a step is skipped, which is stricter, never more lenient). Counted: created, part-added, a task's first 'closed', a part's first
  'part-closed', a task's first 'built', an 'assigned' to someone who has never held that part (the task's first
  holder holds part 1; an added part's first holder is who it was added for). Not counted: said, reopened,
  part-reopened, unbuilt, due and parent changes, taking someone off, and any repeat of a counted step.
- engine/messages.js (the room valve): countFrom is unchanged (only an operator post or reopen moves it). When a
  post would take the room over its cap, each counted step since countFrom adds a quarter of the cap
  (ROOM_PROGRESS_STEPS = 4), at most one more cap in all.

## Decisions
1. Progress earns a bounded allowance, it never resets the count. Rejected: raising the limit (Splinter's review
   note: loops would run longer too); progress as a full reset like a person's post (review round 2: making a task
   is cheap, one per budget would have meant no valve at all); counting file changes in the project folder (a scan
   of the person's folder on every over-cap post; a later card if the task signal proves too narrow).
2. Only first-time steps count (review round 1: A to B to A handoffs and close/reopen/close were free resets).
3. Task files are read only when the room is already over its cap AND the limit is on (with it off the room is
   never held, so the allowance could only suppress the told-only notice, and a busy room would re-read its task
   files on every post). Each post over the cap (refused, or let through on the allowance) lists the task-chats
   folder and reads every file of this project written since the count began.
WEAKEST PREMISE: the size of the allowance. A quarter of the cap per step, at most double, is a judgement: a busy
real pipeline may still be held at twice the cap, and a loop that makes tasks gets up to twice the cap before it is
held. A "step" is a counted ROW, not a click: closing a task's last open part writes both 'part-closed' and 'closed',
so one click can earn half a cap (bounded by the same total). Both are one constant (ROOM_PROGRESS_STEPS) and the cap's own dial. What would change it: a real room held
while tasks were moving, or a loop seen reaching the doubled cap.
Also: a webhook-made task counts as a step (it is still a real new task); a same-user process writing task files
directly can add steps, but only up to the same bound.

## Tests
- engine/taskchat.progress-4786.test.js (13): each counted and uncounted kind; first-time rules for close, part
  close, built and handoffs; per-part holders; partless legacy rows are part 1; future rows skipped and a row at exactly now kept; files untouched since
  the count began not read (with a control); other
  projects; a real pipeline through engine/tasks (close a part, hand the next on) and the loop shape through the
  same functions; through engine/tasks, a task's maker holds part 1.
- engine/messages.test.js #4786 (3): (a) held with no work (control); old work, talk and another project's work earn
  nothing; one step earns a quarter of the cap and the room is held again after; twenty made tasks earn at most one
  more cap, then held (arrivals counted from the log, no divisibility assumption). (b) a step before the person's
  last post earns nothing after it; the same step after does (control arm). (c) with the limit off, a step does not
  suppress the told-only notice.
- Mutants, each failing a test: repeat close, repeat assign, no seed, wrong seed, future row clamped instead of skipped, no mtime skip, mtime
  skip at equality, no cap, no window
  filter, no credit, full-cap credit, countFrom replaced by the window start, no legacy part-1 mapping, no limit-on
  gate. The seven test files touching the valve or taskchat: 191/191.
  One equivalent mutant (dropping the early kind filter) cannot fail: other kinds already count as nothing.

## Review
Round 1: 1 blocker (repeatable events were free resets), taken. Round 2: 1 blocker (cheap creation reset the budget)
and 2 should-fix (holder seeding; tests off the real path and no re-trip), taken. Round 3: 1 should-fix (scan with
the limit off), taken; nits taken: before/after-the-person test, divisibility, maker holds part 1 through the
engine, partless rows. Not taken: the held notice's wording (copy; unchanged for loops). Round 4: 2 should-fix
(untested limit-off gate; stale plan), taken; nit on rows vs clicks recorded above.
Round 5: no blocker, no should-fix (converged); nits taken: future rows skipped not clamped, files untouched since
the count began not read, cost comment corrected, test comment. Round 6 (that commit only): plan brought current;
nits taken: a failed stat skips one file not the rest, the mtime premise and its strict-only failure written down,
a row at exactly now tested.
