# lightlane-4609: a light lane in the suite queue, by order not concurrency (kosmos#4609)

## Measured (2026-09-30 10:07, Agent1s)
22 waiters, oldest 08:11: 3 full suites and 19 queued-heavy one-offs. From 55 queued-heavy logs' TURN/END pairs: most
one-offs hold the box 7 to 200 s (browser checks 20 to 120 s); relay pushes and other-repo validations 20 to 36 min; a
kosmos suite 15 to 20 min (node phase 201 to 254 s). Load 3 to 5 on 10 cores: the wait was ORDER. Mortals: 0 waiters.

## Call
- tools/lib/cut-guard.sh: a waiting marker gets line 5, its class (KOSMOS_QUEUE_CLASS=light, else heavy). "Ahead" is
  now rank, then queue time, then pid: rank 0 a heavy waiter older than KOSMOS_QUEUE_STARVE_S (2700 s, the queue's
  bound), 1 a light one, 2 any other heavy. One run holds the box at a time exactly as before: the second ask and every
  bound are unchanged; only who is first changes.
- queued-heavy.sh (the shared wrapper, outside the repo) takes --light to set the class.
- Routing, no code: full kosmos validations go to Mortals (mortals-validate.sh) while its queue is shorter.

## Rejected
- Two turns at once: the queue exists because a check beside a suite reds for reasons that are not the change.
- Shortest-job-first by estimated duration: nobody knows their duration; a declared class is honest, an estimate not.

## Compatibility
An older copy of this lib (other worktrees' run-tests.sh) reads lines 1 to 4 and orders oldest-first, so until branches
take main the order is mixed. That changes fairness only: exclusivity rests on the second ask, not on the order.

## Weakest premise
That --light stays honest: a mislabelled long job jumps the line. Bounded: the lane still takes one turn at a time, a
heavy waiter past 45 min goes first, and queued-heavy logs each turn's length.

## Tests (tools/test-cut-guard.sh, 137 pass)
light ahead of an older heavy (an older lib's marker reads heavy); CONTROL heavy in the same place waits; heavy past
the starve line ahead of light; CONTROL a longer starve line; two lights oldest-first; unknown class recorded heavy.
Mutation (constant rank) reds the light arm and the starve control.
