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
- The 35-day horizon: a no-year reset written more than 35 days ahead would read as last year and retire at once (a capped pane reading
  healthy). From the 2.1.287 binary the limit types are five_hour, seven_day variants and monthly overage (31 days at most), so no known
  shape does this. Changes my mind: any limit type with a longer window.
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
- Round 2 (sonnet, blind): 0 BLOCKER, 3 SHOULD-FIX, all taken. SF1: two limit rows under ONE footer, the expired one first, and its
  removal (to the footer) took the live row too, reading a still-capped pane healthy; now the removal stops at the next limit row. SF2: no
  test reached snapshot()'s call, so removing it stayed green; a new arm drives the real snapshot() through the pane seams on the real
  clock (an explicit-year reset in 2020 retired, 2099 kept). SF3: the fixture lacked the /usage-credits row the real captures have, so
  dropping only the limit row stayed green; added. NITs not taken: retiring rows pulls a few older rows into the 25-row tail (no harmful
  case built); dropping the footer row too is equivalent; authErrorLineCount reads the raw text (auth only, correct).
  Measured 11:22, each red by name: drop only row i -> "a minute AFTER"; no stop at the next limit row -> TWO; snapshot() not retiring ->
  the snapshot arm. 241/241.
- Round 3 (opus, blind): 1 BLOCKER, taken. The menu guard matched one option label, but Claude Code 2.1.287 labels option 1 "Stop" (usage-
  based billing) or "Wait for limit to reset" (spend-limit menu) too, all under the title "What do you want to do?", used only by the limit,
  spend-limit and trial-ended menus. I confirmed the strings in the binary myself. Both other labels read needs_you past the reset, guideFailure
  null, the person's text into a held menu: a regression vs main (capped). Now keyed on the title. NITs taken: a minute's grace (the printed
  reset drops seconds); the removal stops at a next limit row of ANY wording except the vendor's own /usage-credits upsell [CORRECTED round 5: false for the observed 2026-08-21 row, which names /usage-credits mid-row and was taken for the upsell; fixed in round 5]; ASKED_FIRST pins the
  first-column-0 gate; the 35-day horizon named above. Reviewer's property check: every 30-minute instant Jan 2026 to Jul 2027 in 11 zones,
  rendered with Claude Code's own formatter and parsed back, none early, none null.
  Measured 11:45, each red by name: menu keyed on one label -> "Stop"; no grace -> "retired before the minute of grace"; stop only at "hit your"
  -> TWO_REACHED; upsell treated as another limit -> "two minutes AFTER"; any footer within six -> ASKED_FIRST. 241/241.
- Round 4 (sonnet, blind): 0 BLOCKER, 2 SHOULD-FIX, 3 NIT. SF1 taken: no test pinned "menu AFTER the row" (menu-anywhere survived);
  MENU_ABOVE added. SF2: wording check only; the "Stop" / "Wait for limit to reset" labels are vendor strings (I read them in the binary),
  not captures, and the plan and test comment say so; only the 3-option menu is observed. NIT1 taken: the title is anchored to the row's
  start (observed indented 3), so an agent's sentence or a tool result quoting it is no menu; PROSE arm. NIT3 taken: a 90 s boundary arm pins
  the grace from above. NIT2 (menu partly scrolled off) is unreachable: the row scrolls out first. Residual kept: a live row that is only
  "/usage-credits" directly under an expired row reads as its upsell (unobserved; the same sentence is the upsell in both captures).
  Measured 11:48, each red by name: menu anywhere -> MENU_ABOVE; title unanchored -> PROSE; grace 119 s -> the 90 s arm. 241/241.
- Round 5 (opus, blind, whole change fresh): 0 BLOCKER, 1 SHOULD-FIX, taken. The upsell exclusion matched /usage-credits ANYWHERE, so the
  observed 2026-08-21 limit row ("You've reached your Fable 5 limit. Run /usage-credits to continue or") under an expired row was dropped
  with it and a still-capped pane read healthy; TWO_REACHED had used a trimmed fixture that stepped around it. Now the upsell must START with
  the command; TWO_REACHED uses the captured row. NITs not taken: last vs first menu row (differs only with two menus on screen, which the
  modal makes unlikely); minute > 59 (Claude Code never writes it); a year-old line re-reads capped in the 35 days before its anniversary
  (safe side). Measured 11:53: the unanchored upsell test reds TWO_REACHED by name. 241/241.
- Round 6 (sonnet, blind; a first attempt was STOPPED at 12:15 for retrying an unguarded `rm -rf $S/$n` that Splinter refused twice,
  and re-run with a guarded-rm rule in its prompt): 0 BLOCKER, 0 SHOULD-FIX. CONVERGED (12:17). Read every /usage-credits string in the
  2.1.287 binary: rows that START with it are upsells, rows that name it mid-row are limits, and every wrong case errs toward capped.
  Traced live+expired arrangements (live above, live after, shared footer): all stay capped. No path hides a question. Mutants: 5 red by
  name, 2 survive and are equivalent (\b after usage-credits; loop inclusive of the footer). NIT kept: removing a block can pull a footer into
  an older quoted row's window, a stale capped reading on a pane that already had an expired block (safe side, unconstructed).
