# limitretire-5805: a dateless limit line is held on and retired at its reset (kosmos#5805 slice 3b)

Stacked on limituntil-5805 (slice 3a). Rebase onto main after 3a merges.

## The gap
Claude Code prints a reset with no date ("You've hit your session limit · resets 4pm (America/Chicago)") for the
5-hour session limit and for a weekly limit on its last day. Slice 1 holds automatic lines only on a DATED line, and
status retires (stops reading capped) only a dated line whose reset has passed (#5031 retireResetLimits). So on a
dateless line:
- before the reset, colleagues' room posts, nudges and wake lines are typed into the limit screen and counted as
  delivered (the original report's failure, for the 5-hour form);
- after the reset, the line stays on screen until something is typed, so the card reads capped for ever, and the
  kept messages of slices 2a/2b (released when the card reads released) never go.
Slice 3a added the time on the card but deliberately left these alone.

## The change
1. **First-seen comes from the screen.** The snapshot's screen pass records, per agent, each dateless limit row on its
   screen (keyed by agent + the row's reset phrase and kind), with when it was first and last seen. An entry ends when
   its row has been absent from the agent's screen for LIMIT_ROW_GONE_MS (two minutes; a failed capture records
   nothing and ends nothing). This replaces 3a's card-state lifecycle (first-seen made by the card builder, ended by
   readings that were not capped), which had to be patched in two review rounds and cannot work once a retired row
   makes the card read idle while the row is still on screen.
2. **Retire.** retireResetLimits takes a lookup for a dateless row's first-seen time; a dateless row whose resolved
   reset (limitResetTimeOnlyAt) has passed by the grace is retired exactly as a dated one is: not while the limit menu
   is below it, and only its own block.
3. **Hold.** chat.limitHeldVerdict reads the card's `limitUntil` when the evidence has no dated reset, so a dateless
   line ahead of its reset holds automatic lines, and after it holds only while status still reads the card capped
   (the menu up), as slice 1 does for a dated line.
4. The card's limitUntil reads the same screen-kept first-seen time (claudeLimitUntil no longer creates entries).

## Decided
- First-seen from the screen, not the card: the screen is the ground truth for "the line is still there".
- A dateless row with no first-seen time (the board saw it late, beyond the span bound) is neither retired nor held:
  today's behaviour, the safe direction (capped, typed into as before).
- Rejected: retiring a dateless line on the turn footer's printed time ("done 10:35 PM"): no date either, absent on
  some screens.
- Weakest premise: a dateless row seen continuously from first sight is the same limit. A second limit with the same
  reset phrase printed under the first without the first leaving the screen would keep the old first-seen time; both
  print the same reset, so the time is still right.

## Residuals
- (from 3a) A weekly last-day line first seen after a restart, past its printed time, resolves to tomorrow's time.
  With 3b that also means it is held, and not retired, until then. Bounded by the one-day span.
- Windows cards reading rate_limited at all is unmeasured (slice 1's gap).

## Tests
- engine/limitretire-5805.test.js: the screen pass records and ends first-seen times (row present, absent under two
  minutes, absent over; a failed capture); retireResetLimits retires a dateless row past its resolved reset and keeps
  one ahead of it, one with no first-seen time, and one with the limit menu below it; a capped agent on a dateless
  line ahead of its reset is held (automatic line not typed) and after it reads idle and is typed to; controls on a
  dated line unchanged.
