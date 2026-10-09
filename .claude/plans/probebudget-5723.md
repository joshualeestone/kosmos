# probebudget-5723: #4466's one-budget arm measures the page's budget, not the whole command

kosmos#5723. cli.busy-health-4466 "one probe keeps to ONE budget" failed under load: 8.7 s and 9.7 s against 8.5 s.
Measured, the extra time is not the page getting a second budget. It is bash's start-up plus the lsof ownership
sweep that _health_no_answer runs after a timeout (it walks every process; seconds on this 17-agent host).

## Done looks like

- The arm asserts the page's budget itself: from the board's first request to the client dropping the page
  connection.
- It passes at host load, and fails at ~11 s when the page is given a fresh budget (the #4466 defect).

## Decisions (reversible)

- Measured on the stub board (socket close), not with a wider whole-command bound. A wider bound would absorb the
  lsof time today and hide a real budget regression tomorrow.
- The lsof sweep's own cost is left out of scope here. It is bounded per kernel call (-S 2) and asked once per
  healthy() call; whether it should also count against the probe budget is a separate question for the CLI's owner.
