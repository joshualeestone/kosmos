# Plan: #3616, board-foreground test holders on an OS-picked port

## Finished looks like
`tools/test-board-foreground-2956.sh` passes when two copies run at the same time on one Mac,
which is how the fleet validates. Each port-holder arm tests against a port its own holder owns.

## Cause (measured 2026-09-24)
Four arms (foreign healthy board, stranger, silent holder, all-interfaces holder) started their
holder on a fixed port (18719, 18723, 18729, 18731). With two suites running at once, the second
run's holder died with EADDRINUSE. Its wait loop (curl or lsof) then saw the OTHER run's listener,
so board-run could find the port free after that listener exited, start node, and clobber the
pidfile. That is the red seen twice during #3605 validation.

## Change
A `start_holder <http|net> <body> <host>` helper listens on port 0 and writes the assigned port
to a temp file, which sets `HOLDER_PORT` and `SRV`. Each arm runs only when its holder started;
otherwise it records a failure and skips, so an empty port never reaches board-run, whose default
port is the live board's.

## Rejected
- A random high port with retry: it still races, just less often.
- Finding a free port and then binding it: that leaves a gap between the check and the bind.
- Leaving arms 1-3's `KOSMOS_PORT=17777` alone: node is a stub in those arms and nothing binds
  it, so it cannot collide.

## Weakest premise
Arms 1-3 still name a fixed port (17777). They pass under concurrency here because no holder binds
it; if a later arm starts a real listener there, it would need the same helper.

## Verification
- Alone: ALL PASS (21 assertions).
- Concurrency control, 3 pairs run at once, old vs new from the same worktree: old had 10 holder
  `listen EADDRINUSE` errors and 1 run failed ("all-interfaces (*) holder: node ran into
  EADDRINUSE"); new had 0 errors and 0 failures.
