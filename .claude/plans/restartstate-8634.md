# restartstate-8634: after a restart, remind the agent of its own wait (kosmos#8634)

## Report
One install's feedback (11-17): after a restart an agent's card read "working" though everything was built and waiting
on review; "nothing carried the earlier waiting state across the restart".

## Measured here (fleet board report records, 11-10 to 11-17)
- Every restart's startup turn ended in an automatic idle: "working" lasted only while the restart turn ran.
- No agent-own report in the window; the 10 blocked rows before restarts are the hook's provider-outage reports.
  The reported case was not reproduced on this fleet.

## Cause
#1058: a new run's `started` replaces a deliberate needs_you/blocked (compaction and resume do not). Nothing tells the
agent its wait is gone.

## Change
- engine/awaydigest.js: lastWait(history) finds the agent's own last needs_you/blocked that nothing the agent or a
  person said since has ended (automatic rows neither make nor end one; 7-day limit). contextText/hookJson add a
  paragraph naming the state and time and `kosmos report <state> ...`; no report words.
- server.js /api/away: computes the wait from the long history at a startup (and the Windows hook's call) and passes it
  to the hook, text and JSON forms.
- engine/selfreport.js history(): keeps `by` for 'auto' and 'agent' rows too (it kept only 'operator').
- Tests: engine/awaydigest-8634.test.js (unit, controls), server.away-8634.test.js (a wait past the 64 KB short read
  reaches the hook; an ended wait makes nothing), engine/selfreport.test.js (the row-shape pin updated).

## Rejected
Restoring the old report on the board: the agent may have been unblocked while down (#1058's reason).
