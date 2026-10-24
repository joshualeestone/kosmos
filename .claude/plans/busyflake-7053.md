# busyflake-7053: cli.busy-health-4466 "comes back FAST" flake

Card: joshualeestone/kosmos#7053

## Finding
22 failed kosmos CI runs in 48 h (2026-10-22 18:06Z to 10-24 18:06Z). This test failed in 4,
3 of them pushes to main; always line 713, `actual: ''`.

## Cause (proven)
healthy() in install/kosmos checks `_left <= 0` BEFORE `_busy++` and the busy line. A second busy
reading that lands as the budget ends returns 1 without the line. That is correct (it is not
retrying). SECONDS is whole seconds, so the edge moves by up to 1 s. With KOSMOS_BUSY_WAIT=3 the
second request was measured about 3 s in: on the edge.

Proof: a stubbed _health_probe whose 2nd call advances SECONDS past the budget gives 2 probes and
no line (the CI failure); the control prints the line.

## Decision
Test-only fix. The CLI behaviour is right, so the test's premise (n >= 2 implies the line) is what
changes. The stub records each request's time; the line is owed only when the second request came
more than 2 s inside the window; the budget goes to 8 s so that is the normal case.

Rejected: changing healthy() to print the line on the give-up reading (it would say "retrying"
when it is not); only raising the budget (still a timing assumption, just a wider one).

Weakest premise: that "2 s inside" covers SECONDS rounding (1 s) plus reading latency under load.
Under extreme load the gate skips the assertion rather than failing, so coverage drops, not
correctness.

## Validation
- Whole file 55/55. Test alone 3/3 at 8 s.
- Mutant (CLI never prints the line): red, at 2158 ms and 3010 ms.
