# kosmos#8870: a log of each full-suite turn, so an overlap can be read afterwards

Branch `suiteturns-8870`, worktree `~/work/kosmos-suiteturns-8870`, from origin/main 8c193f2a12.

## Measured first (Mortals, 17:54 CST 11-21)

Two full suites were live at once: run-tests.sh 54596 (taskmine-8867) and 66413 (whatsnew-0814), each with its own
`node --test` workers, both started about 17:41; load 10.8 / 13.4 / 13.7. Cause: not a lock defect. run-tests.sh
allows `KOSMOS_SUITE_MAX` suites at once, default 2 (#6334), and Mortals had no `suite-max` cap file. Both waited
behind a relay CI job; when it ended, two slots were free and both took one.

## Done outside this branch

`~/.cache/kosmos-run-markers/suite-max` = 1 on Mortals, 17:55:12 (Splinter 17:56: keep it; two suites put the load
past the relay gate's limit of 12, its core count, which blocks every relay push). Reasoning on #8870 and #6334.
Rollback: delete the file.

## What this branch changes

- `tools/lib/cut-guard.sh`: `kosmos_suite_turn_log <event> <details>` appends one line,
  `<local time> <took|ended> pid=<pid> <details>`, to `suite-turns.log` in the run-marker folder. Best effort.
- `tools/run-tests.sh`: after its queue wait returns, a full suite logs `took cap=<cap> head=<sha> tree=<folder>`;
  both exit traps first log `ended exit <status>` for a suite that took a turn.
- Reading it: two suites overlapped exactly when one has a took line between the other's took and ended lines. A suite
  killed with KILL writes no ended line; its pid then no longer answers. A TERM still runs the exit trap.
- Not logged: an --only run, a run that skips the queue (KOSMOS_TESTS_IGNORE_SUITE=1 or inside a test), and a
  queued-heavy turn, none of which take a suite-queue turn.

## Rejected

- Changing the default cap to 1 in run-tests.sh for every Mac: #6334 chose 2 on measurement, and this card is about
  Mortals, which the file already covers.
- Counting the live suites in the took line: it needs the subtle candidate pipeline in kosmos_refuse_if_suite_live
  factored out, and the took/ended pairs already show an overlap.

## Tests

`tools/test-cut-guard.sh`: a lone run under a cap of 1 starts at once and logs one took and one ended line for its
own pid (the CONTROL); beside one live suite under a cap of 1 a run is held and logs no turn. Each red under a targeted
mutation of run-tests.sh (no took line; no end call in the trap; took logged before the wait).

## Weakest premise

That a took/ended pair per run is enough to see an overlap. It is for runs that end normally or by TERM; a KILLed
run leaves an open took line, which reads as still running until someone checks its pid.
