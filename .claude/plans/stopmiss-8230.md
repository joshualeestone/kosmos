# stopmiss-8230: a Windows turn end is never lost in silence (kosmos#8230)

## Problem
On Windows a Stop's idle was dropped with no trace on a busy board just after a restart. The JS report hook gives
each send's listener proof half of a 3 s window (1.5 s), and on a failed proof sends nothing, prints nothing (only
SessionStart speaks) and exits 0. The board also answers two early refusals of /api/report with no log line.

## The sibling is the spec
kosmos#7977 gave the Mac's bash hook (install/kosmos-report-hook.sh, report_turn_end) a retry and a
turn-end-failures.log. The Windows JS hook (engine/kosmos-report-hook.js) never got it. This branch gives it the same
rules:
- a turn end (Stop, StopFailure, SessionEnd) is marked `turnEnd` and gets the 8 s window (proof 4 s);
- the board's keep (`skipped`), a report it cannot tie to an agent, another account's: no retry, no note;
- no board at the address: retried after 2 s, not noted;
- proof timed out (busy): noted at once, not retried;
- anything else: retried after 2 s, noted when lost again;
- only a session with an agent token notes;
- note: one line in <throttle folder>/turn-end-failures.log, capped past 400 lines to the last 200.

## Board side (server.js POST /api/report)
- a not-recorded answer from the record carries `skipped` when the record kept a standing wait;
- an automatic idle/stopped/blocked refused before the record (roster unreadable, sender not resolved) writes one
  line to the board log.

## Tests
engine/kosmos-report-hook.turnend-8230.test.js: each outcome with its control, the note's shape and cap, the window,
the keep phrases bound to their board sources, the board's two changes. Against origin/main every changed arm fails
and the unchanged one (a non-turn-end report) passes. Two #1765 tests updated: a refused Stop is now proved twice,
and its first proof gets half the 8 s window.

## Rejected
- Reconciling a "working" card from the transcript's stop_hook_summary on the board: a second source of truth and a
  bigger change; its own card if the notes show drops the retry does not cure.
- A new log file in the data folder (my first design): the Mac's file and shape are the convention.

## Weakest premise
That the 1.5 s proof timeout dropped Homer's run 1. Unproven; the notes and the board log are what tell next time.
Verify on Windows: Homer's V2 check right after an in-place update restart.
