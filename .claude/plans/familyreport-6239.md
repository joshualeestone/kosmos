# familyreport-6239: a family's first report, seen end to end (#6239)

Adds step 9b to tools/family-e2e-6239.js (merged in kosmos#6293). K's first rollup (sent a minute after its board starts,
server.js orgRollupTick) is accepted by the coordinator only when the words K accepted are the family's current ones, so
the console counting K as reporting is the family's words working for reporting, not only for joining.

## Result (2026-10-16 02:50 CDT, run as an exclusive queued turn)
- VERDICT PASS 25/25. Step 9b control: straight after the join, before the first tick, the console's members.reporting is
  0; then 1 at 100 s.

## Decided
- Read from the console overview (the parent's own view), not the coordinator's database.
- Not built: an agent-events refusal arm (it needs an agent to act and be refused; a later piece).
- The step 4b comment is reworded for #6286's fix (kosmos#6291 and kosmos-relay#404).

## Weakest premise
That only a matching words hash lets a report count. A rollup refused for another reason would leave reporting at 0,
which the step reports as a failure, so the step cannot pass on a refused report; it can only fail for the wrong
reason.

## Round 1 (opus) fixes
- Step 9b waits for the first rollup tick after the join (corrected in round 3: ticks fall at K's start + 60, 300, 600 s; a join
  starts none), plus 90 s, so a join later than 60 s no longer fails for the wrong reason; the detail says when K joined
  and when the tick was due. The watchdog budget counts the worst case (855 s).
- The positive check is K's own row (by email) in the parent's console inventory, not a count of reporting members.
- The labels say what is measured: a report lands. The words gate itself is not exercised (no mismatched-words arm).
- Found while re-running: P's first sign-in failed twice with "the tunnel program did not answer in time" (always the
  first board to sign in; K's a moment later succeeded). boardSignin now asks once more on exactly that answer. Not seen
  firing yet: the passing run did not need it.
- Rerun (exclusive queued turn, 03:17): VERDICT PASS 25/25; joined 17 s after K started, tick due at 60 s, K's row
  state ok.

## Round 2 (sonnet) fixes
- The control reads the same measure as the check: K's own inventory row is present with no report before the tick
  (as well as nobody counted reporting); then the same row reports.
- After a retried sign-in start, the harness waits for codes to settle and takes the newest, so a late first code
  cannot be used. Still not seen firing.
- K's start is stamped when its board answers (closer to the tick's own start); the watchdog is 17 min (the retry
  added up to 90 s); a failed inventory read shows its status rather than "row not found".
- Rerun (exclusive queued turn, 03:54): VERDICT PASS 25/25; K's row went from state unavailable, reportedAt null, to
  state ok, reportedAt 2026-10-16; joined 10 s after K started.

## Round 3 (opus) fixes
- The tick schedule was modelled wrongly: server.js arms the 60 s setTimeout and the 5 min setInterval together, so
  ticks fall at start + 60, 300, 600, 900 s, not 60, 360, 660 (my round 1 model). A join at 300-360 s would have waited
  for a tick that never comes and gone red for the wrong reason. Now: start + 60 s if the join came first, else the
  next multiple of 300 s. The constants' comment, the step comment and round 1's line here are corrected together.
- The join is stamped when the enroll answers, not after step 9's polls, so the tick and the reported offset are exact.
- A tick due within 5 s of the control's reads makes the control inconclusive (said in its detail), not red.
- The settle after a retried sign-in is stated with its bound (2 s); the comment says the control is what shows the
  report came after the join (reportedAt is a day).
- Rerun (exclusive queued turn, 04:00): VERDICT PASS 25/25; joined 27 s after K started (stamped at the enroll answer),
  tick due 60 s. The 300 s branch of the tick formula was not reached (the join came before 60 s); it is checked by
  reading, not by a run.

## Round 4 (sonnet) fixes
- The control passes only on its own condition. Round 3's "inconclusive" arm let a past-due tick pass, the exact case it
  exists to catch, and it was tallied green. A tick due within 5 s of the reads (or past) now fails the control and says
  why: a rare false red to rerun, never a pass it could not prove.
- The retry's match words are named at the site (the board's own refusal, engine/remote.js); a rewording only loses the
  retry.
