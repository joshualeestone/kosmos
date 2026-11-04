# kosmos#7977: a lost turn-end report leaves an idle agent reading "Can't tell"

## Measured (11-04, this board, read-only)
Irma's card: state unknown, "it said it was working and has not said anything since; we could not check"
(status.js:8733, the deliberate Mac honest-unknown). Her selfreports end `working, auto, 18:07:00Z`; her Stop hook ran
at 18:08:18Z (transcript stop_hook_summary, 304 ms, no hook error) and no idle arrived. report() discards all output,
so the cause of the lost send is unrecorded. Vivienne shows the healthy pair (working, idle 10 s later).

## Finished looks like
The Stop hook's idle report runs detached (the hook never waits on it). If the board did not answer, it is tried once
more, but a retry is not STARTED once another hook event of the same pane came after the Stop (a per-pane STOP_TOKEN
every other event removes); a retry already sending can still land after a newer report, as the single send always
could. Only the board's deliberate keep (an agent waiting on a person or its provider; every such answer says the idle "did
not overwrite" it, selfreport.js skipped:'waiting') is neither retried nor noted; every other failure, including a
"not recorded" for another reason (a failed save), is retried and noted. A second
lost send writes one line (time, pane, exit code, the CLI's first line; no command text) to
$THROTTLE_DIR/turn-end-failures.log. Every other report is unchanged. The Windows node hook is out of scope (the
symptom is the Mac board's honest-unknown).

## Call
Retry plus a note in the hook. Rejected: letting an idle screen outrank a stale working report on a Mac (the fleet-wide
precedence change status.js already raised rather than took); counting a placed delivery as life.
Weakest premise: that the five family-board agents (non-Claude runners) fail this way; their selfreports would show it.

## Measured on the branch
report-hook-turnend-7977.test.js 8/8: (1) a send that goes through is sent once, no note; (2) the hook returns at once
while the send takes 2 s; (3) a send the board never answered is retried, a landing retry leaves no note; (4) the
board's deliberate keep ("did not overwrite") is neither retried nor noted; (5) a newer event of the pane cancels the
retry; (6) two lost sends leave one line (time, pane, exit code, the CLI's first line, its indent stripped); (7) a
"not recorded" for another reason (a failed save) IS retried and noted; (8) the hook's phrase is bound to every
skipped:'waiting' answer in engine/selfreport.js. Mutants, each red on its own test: token check removed, the skip
removed, output held open, the old broad 'not recorded' match restored.
report-hook-auto-1453.test.js counts report_turn_end as a report call (floor 8). Ten sibling hook test files pass.
