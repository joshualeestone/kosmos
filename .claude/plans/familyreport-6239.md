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
- Step 9b waits for the first rollup tick after the join (ticks run once at K's start + 60 s, then every 5 min; a join
  starts none), plus 90 s, so a join later than 60 s no longer fails for the wrong reason; the detail says when K joined
  and when the tick was due. The watchdog budget counts the worst case (855 s).
- The positive check is K's own row (by email) in the parent's console inventory, not a count of reporting members.
- The labels say what is measured: a report lands. The words gate itself is not exercised (no mismatched-words arm).
- Found while re-running: P's first sign-in failed twice with "the tunnel program did not answer in time" (always the
  first board to sign in; K's a moment later succeeded). boardSignin now asks once more on exactly that answer. Not seen
  firing yet: the passing run did not need it.
- Rerun (exclusive queued turn, 03:17): VERDICT PASS 25/25; joined 17 s after K started, tick due at 60 s, K's row
  state ok.
