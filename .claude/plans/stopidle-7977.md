# kosmos#7977: a lost turn-end report leaves an idle agent reading "Can't tell"

## Measured (11-04, this board, read-only)
Irma's card: state unknown, "it said it was working and has not said anything since; we could not check"
(status.js:8733, the deliberate Mac honest-unknown). Her selfreports end `working, auto, 18:07:00Z`; her Stop hook ran
at 18:08:18Z (transcript stop_hook_summary, 304 ms, no hook error) and no idle arrived. report() discards all output,
so the cause of the lost send is unrecorded. Vivienne shows the healthy pair (working, idle 10 s later).

## Finished looks like
The Stop hook's idle report is retried once on failure, and a second failure writes one line (time, event, exit
code, no command text) to $THROTTLE_DIR/turn-end-failures.log. Every other report is unchanged.

## Call
Retry plus a note in the hook. Rejected: letting an idle screen outrank a stale working report on a Mac (the fleet-wide
precedence change status.js already raised rather than took); counting a placed delivery as life.
Weakest premise: that the five family-board agents (non-Claude runners) fail this way; their selfreports would show it.

## Measured on the branch
report-hook-turnend-7977.test.js: 3/3 (success sends once, no note; fail-then-succeed sends twice, no note; fail twice:
two tries and one note line). Mutant (one-shot send restored): 2 of 3 fail. Ten sibling hook test files pass.
