# waitonce-6492: a question row says it is waiting on you once

Card: kosmos#6492, filed from Mona Lisa's 0.7.56 noise pass (Splinter assigned it on 2026-10-18).

## Change
tskRow: a decision row with a known start where every reason is a question shows one line, carrying both
.tsk-waiting and .tsk-waiting-who: "Cleo: Waiting for your answer for 24 seconds." (wording from
PJ_NEEDS_WHY.question), or "Cleo: Just started waiting for your answer." The route sends an age only for question
rows today, so the #5942 two-line form stays only as a fallback. A row with no start keeps the who line alone.

## Tests
- web.tasks-look-3559: a #6492 test with controls; fails on main.
- render-tasks-view-3559: the three arms that pinned the old words take the merged line; a strict #6492 arm fails
  on main in all four themes and sizes.
- mobile-shots.js: a tasks-decision screen, scrolled to the row (shoot with --data marketing).

## Status
- [x] Round 1 (opus): WARNING, the "other reason keeps both lines" case cannot happen with real data --> FIXED: the
  comment says the route sends an age only for question rows, and the two-line form is a fallback. NITs: a count
  assertion that passed on the regression --> FIXED and checked against main; wording from PJ_NEEDS_WHY --> FIXED;
  de-duplicate by agent id, not by display name --> FIXED; andList --> not in the page, so ", " is kept.
- [x] Round 2 (sonnet): no new blocker or warning; the engine claim was verified independently. NIT: the shot screen waits on the combined line (both classes) --> FIXED. NIT: the wording is spliced from PJ_NEEDS_WHY --> kept (the test pins it).
- [ ] Validation, proof, PR, merge after the 0.7.57 lift.
