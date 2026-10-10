# runretry-5643: a recurring task's run is not lost to one busy moment

Card: kosmos#5643, the 10-07 to 10-09 reports (one install): "two hourly results were lost after the check itself had
succeeded"; a result and its state update should complete together or be retried.

Finished means: `kosmos task ran` (both CLIs) asks again when the board did not take a run (no answer, a timeout, a
cut reply, a 503), up to three attempts inside the board's one-minute duplicate window, and a run still not taken
says plainly whether it may have been recorded (a timeout on any attempt: check first) or was not (refusals only: run
the same command again). `task repeat` and every other verb are unchanged.

Measured on main: one attempt (curl -m 15), no retry; the board answers 503 when it briefly cannot check which agents
run or read the projects. Recording a run is one write (run, note, history entry), and a repeat from the same agent
within RUN_DEDUP_MS (60 s) is the same run, so retrying inside it cannot double-record.

Decided (card comment): no combined record-and-deliver command (recording is the delivery to the task's history; the
person-facing post is the agent's own), no on-disk resend queue (a run reported late reads as missed). Already done:
scheduler-owned tasks (#5456, released). Deferred: structured comparison fields (one install, one kind of check).

## Review 1
- A board that stalls past the minute could take a retry as a second run: each command now sends one run_id (16 hex) on
  every attempt, and recordRun takes the same id from the same runner as the same run however late it lands.
- A board that went away after a cut reply is never said to be running; "may have been recorded" exits 3 on both CLIs.
- Retry wording, the pause setting (digits only, 2x then 8x, as Windows), notConnected not counted as maybe-landed.
- Review 3: the board keeps the last 5 run ids per task (keyed by runner), an id the one-minute window absorbed included, so a late attempt of an absorbed or older command is never recorded; a rule change forgets them.
- Review 6 converged (nothing above NIT). Known, accepted: an older board that ignores run_id records a retry twice only if it stalls past the minute (as before the change); the CLIs differ on exotic curl failures (loopback only).
- Not this change: in-process test boards start the update poll (a read of the public latest.json), as every server test already does.
