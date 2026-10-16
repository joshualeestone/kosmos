# stalewhy-6329: a stale summary line says which rule kept it stale

Card: #6329 (feedback). Owner: Angel.

## Done means
`kosmos project show` (engine/projectview.js renderShow) names the cause on a stale member's summary line when the
board measured one: reported work past the 4-hour rhythm since it was written ("5h 2m of reported work since it was
written"), or, for a runner that reports turn ends only, how many turns have ended since. With nothing measured the
line reads exactly as before. The idle, quiet, rate-limited and before-idle arms already say their cause and are unchanged.

## Steps
1. [x] workExcused: when it leaves a summary stale it now keeps what decided it: `workedSince` (minutes of reported
   work) or `turnsSince` (turns ended). Every other return is unchanged.
2. [x] SUMMARY_WORDS.stale words them in its plain arm.
3. [x] Tests: both causes measured and worded, the one-turn control unchanged, the unmeasured line unchanged;
   summarydue-nudge-6209 still green.

## Decided, not missed
- "Reported work" is said only when `working` reports stand behind all the counted time. Waits (needs_you, blocked,
  rate limited) and stretches with no report are counted too (errs toward stale, #5635), and then the line says
  "counted as working or waiting" instead, so it never contradicts a "needs you" state on the same line.
- The card's three causes: long active work is the work arm; idle time was already said (idleNoted, idleExcused,
  quietExcused); a missing end-of-turn event is said for a turn-ends-only runner as "written more than a day ago ...
  its work cannot be timed" (the 24 h cap) and "it reported working or a wait since". A Claude seat whose heartbeats
  stopped is capped at 30 min per working report (#5635 F2) and then reads as the work arm or current; there is no
  separate "heartbeats stopped" line, because the board cannot tell a stopped hook from a finished turn.
- Turns are counted after the one that wrote the summary.
- With nothing measured (no history, an unmeasured runner), the line keeps its old words rather than a guessed cause.
- The board's web page does not show this line today (project status is CLI text, Mac and Windows), so no page change.
