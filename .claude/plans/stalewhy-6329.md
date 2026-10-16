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
- Only causes the board measured are said. "No end-of-turn event" from the card is the turns arm; a missing history or
  an unmeasured runner keeps the old line, rather than a guessed cause.
- The board's web page does not show this line today (project status is CLI text), so no page change.
