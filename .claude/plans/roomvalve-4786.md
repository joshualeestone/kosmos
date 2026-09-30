# #4786: the room's back-and-forth valve gives work moving a bounded allowance

Card: joshualeestone/kosmos#4786 (claimed:angel). Branch roomvalve-4786, off main fc006ce1e.

## What finished looks like
A room whose posts come with work moving forward in the project (a task made, a part added, a first close or built
mark, a part handed to someone new) gets more room before the back-and-forth valve holds it; a room with no work
moving is held exactly as before; and no amount of cheap task activity can keep a loop running past twice the cap.

## The change
- engine/taskchat.js: progressTimes(projectId, now), every first-time forward step in that project's task
  histories, oldest first, clamped to now. Counted: created, part-added, a task's first 'closed', a part's first
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
3. Task files are read only when the room is already over its cap.
WEAKEST PREMISE: the size of the allowance. A quarter of the cap per step, at most double, is a judgement: a busy
real pipeline may still be held at twice the cap, and a loop that makes tasks gets up to twice the cap before it is
held. Both are one constant (ROOM_PROGRESS_STEPS) and the cap's own dial. What would change it: a real room held
while tasks were moving, or a loop seen reaching the doubled cap.
Also: a webhook-made task counts as a step (it is still a real new task); a same-user process writing task files
directly can add steps, but only up to the same bound.

## Tests
- engine/taskchat.progress-4786.test.js (10): each counted and uncounted kind, first-time rules for close, part
  close, built and handoffs, per-part holders, the future-date clamp, other projects, a real pipeline through
  engine/tasks (close a part, hand the next on) and the loop shape through the same functions.
- engine/messages.test.js #4786 (1): held with no work (control); old work, talk and another project's work earn
  nothing; one step earns exactly a quarter of the cap and the room is held again after; twenty made tasks earn at
  most one more cap, then held.
- Nine mutants (repeat close, repeat assign, no seed, wrong seed, no clamp, no cap, no window filter, no credit,
  full-cap credit) each fail a test. The seven test files touching the valve or taskchat: 186/186.

## Review
Round 1: 1 blocker (repeatable events), taken. Round 2: 1 blocker (cheap creation reset the budget) and 2
should-fix (holder seeding; tests off the real path and no re-trip), taken.
