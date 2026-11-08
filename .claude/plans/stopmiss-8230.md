# stopmiss-8230: a Windows turn end is never lost in silence (kosmos#8230)

## Problem
On Windows a Stop's idle was dropped with no trace on a busy board just after a restart. The JS report hook gives
each send's listener proof half of a 3 s window (1.5 s), and on a failed proof sends nothing, prints nothing (only
SessionStart speaks) and exits 0. The board also answers two early refusals of /api/report with no log line.

## The sibling is the spec
kosmos#7977 gave the Mac's bash hook (install/kosmos-report-hook.sh, report_turn_end) a retry and a
turn-end-failures.log. The Windows JS hook (engine/kosmos-report-hook.js) never got it. This branch gives it the same
rules:
- Stop is marked `turnEnd`, as the bash hook routes only Stop through report_turn_end (StopFailure and SessionEnd keep
  the single short send);
- an agent's Stop (an agent token, and a caller that waits for the hook) gets the 8 s window (proof 4 s) and the rules
  below; the person's own sessions keep the single 3 s send, and the Windows supervisor's in-process idle
  (engine/win32codexsup.js, not awaited) passes noRetry so a late retry cannot land after the next turn's working;
- the board's keep (`skipped`), a report it cannot tie to an agent, another account's: no retry, no note;
- no board at the address: retried after 2 s, not noted;
- proof timed out (busy): noted at once, not retried;
- anything else: retried after 2 s, noted when lost again (a send that times out after a slow proof usually leaves
  under 1 s, so it is noted "no time left to retry" rather than retried);
- a board serving another Kosmos (421 wrongWorld): neither retried nor noted, as the hook is already silent on it
  (#1704); the bash hook has no such case, since its CLI says so in its own words;
- note: one line in <throttle folder>/turn-end-failures.log, capped past 400 lines to the last 200 (the bash hook's
  file and cap; the line names the agent's throttle key and the reason, not a pane and an exit code).

## Board side (server.js POST /api/report)
- a not-recorded answer from the record carries `skipped` when the record kept a standing wait;
- an automatic idle/stopped/blocked refused before the record (roster unreadable, sender not resolved) writes one
  line to the board log, only for a request carrying an agent token (the person's own sessions are refused by
  design on every turn).

## Tests
server.report-turnend-8230.test.js: the real route on a sandboxed board answers a kept wait with skipped:"waiting"
(control: a clean automatic idle is recorded) and logs a refused automatic idle only with an agent token (controls: no
token, and a non-automatic report, log nothing). Both fail against origin/main.
engine/kosmos-report-hook.turnend-8230.test.js: each outcome with its control, the note's shape and cap, the window,
the keep phrases bound to their board sources, the board's two changes. Against origin/main every changed arm fails
and the unchanged one (a non-turn-end report) passes. Two #1765 tests updated: a refused Stop is now proved twice,
and its first proof gets half the 8 s window.

## Cost, stated
The Windows hook awaits its send (unlike the bash hook, which detaches), so a lost agent Stop holds the turn end for
up to 8 s instead of 3 s. That is why no STOP_TOKEN twin is needed: no later event starts while the hook runs.
Windows does update in place (engine/win32update.js), so during an update restart every agent Stop waits out its
proof, the 2 s pause and a retry, within the 8 s: the price of that Stop not being lost across the restart, which is
the loss the retry exists for.
The keep list is checked equal to the bash hook's _TE_KEEP, so the two hooks cannot drift apart.

## Rejected
- Reconciling a "working" card from the transcript's stop_hook_summary on the board: a second source of truth and a
  bigger change; its own card if the notes show drops the retry does not cure.
- A new log file in the data folder (my first design): the Mac's file and shape are the convention.

## Weakest premise
That the 1.5 s proof timeout dropped Homer's run 1. Unproven; the notes and the board log are what tell next time.
Verify on Windows: Homer's V2 check right after an in-place update restart.
