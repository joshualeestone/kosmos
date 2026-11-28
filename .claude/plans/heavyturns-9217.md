# kosmos#9217 slice 2: taking turns on a heavy job

Design on the card (comment 7232395523), decided; Josh or Splinter can overrule.

- engine/heavyturns.js: a line of places (<data root>/heavy-line.json) in front of the heavy-job record. take() never
  blocks: the turn (recorded through heavyjobs.start) when no heavy job is shown and the caller is first or the line is
  empty; else a kept place. A place is judged by heavyjobs.judge (pid, agent, 12 h from its last ask). A front place
  with the turn free goes to the back once after GRACE_MS (2 min), then out. The holder is whatever heavyjobs.live()
  shows, so a job recorded with `start` holds the turn too. Kept in its own module so it does not touch #9230's
  heavyjobs.js changes.
- server.js: POST /api/heavy takes `take` and `release`; heavyNow() reads jobs and line with one agentAlive, so a waiter
  missing from the roster runs the same 90 s grace a holder does; /api/status carries heavyLine, GET /api/heavy `line`.
- Both CLIs: `kosmos heavy take "<label>" [--pid N]` (exit 0 = your turn, 3 = wait) and `kosmos heavy release`; the
  bare list shows the line. Same words on Mac and Windows, pinned by twin tests.
- Board: the heavy-job note adds "Next: A, then B", and shows the line alone when the turn is free. A job not started
  today shows its day (Baron, 0.8.29 review); paintHeavyJobs takes `now`, so its tests do not depend on the day they run.

Rejected: a blocking `wait` (a tool call times out long before a suite ends); reading the fleet's queue files (ordinary
users have none); priority by job size (an order agents can predict is the point).

Weakest premise: agents poll take. The line informs; it does not stop an agent that runs anyway.
