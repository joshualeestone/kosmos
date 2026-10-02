# guidereset-5031: the Guide stays on Kosmos's backup after its Claude limit resets (kosmos#5031)

Started 2026-10-02 10:31 CDT, Ice Cream Kitty. Stacked on guidecap-5029 (kosmos#5029); rebases onto main once that merges.

## Problem
While the Guide is capped the bubble answers on the hosted backup (#3660) and sends nothing to the Guide (web/index.html ~71977). The limit line
stays on the Guide's screen until it gets a new turn, so the card stays rate_limited after the reset and the bubble never hands back; the backup
stops at 30 a day per install.

## Change
- engine/status.js limitResetAt(line, nowMs): reads "resets <Mon> <D> at <h>[:mm]am|pm (<IANA zone>)" (observed 2026-10-02), wall time in that
  zone, year nearest to now. Null for anything else.
- reconcileReport (the one place with a clock): a SCRAPED rate_limited whose reset has passed becomes idle, because "its usage limit reset at
  <time> and it has not been given anything since". guideFailure then returns null and the bubble hands back ("Your own AI is answering again.").

## Decided, and why
- Option 1 (read the reset) over option 2 (try the Guide first after a guess): it uses the vendor's own time, needs no bubble change, and fixes
  every Claude card's stale Paused, not just the Guide's.
- Unparsed -> stays capped. Failing toward Paused is the old behaviour; failing toward "answering" would send the person's next message to a
  capped Guide.
- Only the observed date form. "resets 3pm (zone)" (time only) is a likely 5-hour shape but has not been observed here; it stays capped.

## Weakest premise
The time-only shape is probably the common one for 5-hour limits, and this does not read it. Changes my mind: a captured time-only line.

## Validation
- #5031 test: before the reset capped and guideFailure fires; after it idle and guideFailure null; unreadable/unknown-zone lines stay capped;
  a January reset read in December is next year. Mutant (rule disabled) reds "a minute AFTER the reset".
- engine/status*.test.js + engine/setup-assistant*.test.js: 503/503.
- Full suite: PENDING (after #5029).

## Review
- Round 1: PENDING.
