# guidereset-5031: the Guide stays on Kosmos's backup after its Claude limit resets (kosmos#5031)

Started 2026-10-02 10:31 CDT, Ice Cream Kitty. Stacked on guidecap-5029 (kosmos#5029); rebases onto main once that merges.

## Problem
While the Guide is capped the bubble answers on the hosted backup (#3660) and sends nothing to the Guide (web/index.html ~71977). The limit line
stays on the Guide's screen until it gets a new turn, so the card stays rate_limited after the reset and the bubble never hands back; the backup
stops at 30 a day per install.

## Change (as of review round 1; the first design is recorded under Review)
- engine/status.js limitResetAt(line, nowMs): reads "resets <Mon> <D>[, <YYYY>] at|, <h>[:mm][ ]am|pm (<zone>)", wall time in that zone. With
  no year, the LATEST candidate at most 35 days ahead. The repeated fall-back hour resolves LATER. Null for anything else.
- retireResetLimits(text, nowMs): removes each Claude Code limit block (vendor row by #5029's gate, plus its indented rows up to the footer)
  whose own reset has passed, unless the limit MENU is on screen after it. snapshot() classifies the retired screen (the one place with the
  screen and a clock). Everything else on the screen reads as it would have with no limit line.
- vendorFooterAt(rows, i): #5029's gate, shared by limitMarkersFor and retireResetLimits so they cannot disagree.

## Decided, and why
- Option 1 (read the reset) over option 2 (try the Guide first after a guess): it uses the vendor's own time, needs no bubble change, and fixes
  every Claude card's stale Paused, not just the Guide's.
- Unparsed -> stays capped. Failing toward Paused is the old behaviour; failing toward "answering" would send the person's next message to a
  capped Guide.
- Only the observed date form. "resets 3pm (zone)" (time only) is a likely 5-hour shape but has not been observed here; it stays capped.

- The limit MENU stays capped past the reset: it holds the session until a key, and whether it closes itself at the reset is not observed.
  Staying on the backup is the safe side. (#5039, Renet, is the same class: a vendor modal reads needs-you, not idle.)
- Time-only lines ("resets 4pm (zone)", which Claude Code 2.1.287 writes for any reset under a day away, so every 5-hour limit) still stay
  capped. Placing them needs the day the line was written (the footer's clock, or a first-seen time Kosmos records); deferred to a follow-up
  card rather than guessed here.

## Weakest premise
The time-only shape is probably the common one for 5-hour limits, and this does not read it. Changes my mind: a captured time-only line.

## Validation
- #5031 test: before the reset capped and guideFailure fires; after it idle and guideFailure null; unreadable/unknown-zone lines stay capped;
  a January reset read in December is next year. Mutant (rule disabled) reds "a minute AFTER the reset".
- engine/status*.test.js + engine/setup-assistant*.test.js: 503/503.
- Full suite: PENDING (after #5029).

## Review
- Round 1 (opus, blind): 2 BLOCKER, 3 SHOULD-FIX, 4 NIT. The first design relabelled a scraped rate_limited as idle in reconcileReport.
  BLOCKER 1: it read only the OLDEST limit line (messageAt is first-match), so a pane capped AGAIN after the reset read healthy and the Guide
  would talk into a capped account. BLOCKER 2: the limit MENU past the reset handed the bubble back to a session the menu holds. SF1: the
  relabel replaced the whole reading, so #5029 round 6's recovered pane (a later permission question) read idle instead of needs_you, and
  #5029's doc line "#5031 retires a vendor row" was false. All three fixed by the redesign above (retire rows, re-classify). SF2 (time-only
  lines are most lines): recorded above, follow-up. SF3 taken: explicit ", YYYY" parsed; the year-1 arm tested. NITs taken: fall-back hour
  resolves later; (UTC), "12 am", case-insensitive am/pm, the comma form; the evidence no longer quotes the old line on a non-capped card;
  a months-old line reads passed (35-day horizon). Not taken: "Sept" (Claude Code writes 3-letter months).
  Measured 11:17 on a scratch copy, each red by name: retire as a no-op; menu check removed; vendor gate removed; pm ignored; minutes ignored;
  single offset pass (red only on the new spring-forward arm, "Mar 14, 2027 at 4am"); later-hour step removed; horizon removed; explicit year
  ignored; Feb 30 check removed. Survives, equivalent: nearest-year instead of latest (inside the 35-day horizon the candidates are a year
  apart, so the latest IS the nearest).
  engine/status.test.js + status.pane-states-1889.test.js: 240/240 (12 "server exited unexpectedly" lines are the tmux tests' existing noise;
  the #5029 base prints the same 12).
- Round 2: PENDING.
