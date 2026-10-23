# remove-wait-7000 (kosmos#7000)

## Problem
`engine/remove.test.js` #4964 "a bootout that failed is not waited on" redded in a full Mortals run with
"it waited 5651 ms" (limit 1500), and passed alone.

## Finding (measured)
- No #4964 wait path runs when the bootout fails (stopped=false, so waitUnloaded is skipped; the retry wait
  is 0 under the test's env).
- Tracing execFileSync in the test showed a REAL `tmux list-sessions` (status.tmuxSessions, 5 s timeout),
  reached by restart -> communityblock.tellAgent -> instructions.read -> staleness ->
  status.sessionStartedAtFromTmux. 10 such calls in the file; 3 across the nine #4964 tests (a 2 s cache
  decides which test pays, hence order-dependence).
- Red arm: AGENT_WORKFORCE_TMUX_BIN pointed at a stub that sleeps 8 s reds the test on main ("waited 10014 ms").

## Change
Default the session-list seam (`status.setSessionSource(() => '')`) in the file's existing #1794
beforeEach, beside the pane roster and pane capture seams, and reset it in afterEach.

## Rejected
- Widening the 1500 ms limit: hides the leak, and the card says not to.
- Setting the seam only in the #4964 helper: every restart test in the file touched the live tmux.
- Changing status.js: production's real read is correct; this is test isolation.

## Verified
- Same slow stub: test passes; whole file 104/104 under it; traced real tmux calls 10 -> 0.

## Weakest premise
That Mortals' 5651 ms was this call. Supported by the shape (one 5 s timeout plus the rest) and the only real
exec in the path; not measured on Mortals itself.
