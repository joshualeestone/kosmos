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
- Only a row the board watched arrive is timed. A row already on screen at the board's first capture of that agent (a
  restart, an agent first appearing) is marked late: no time, no hold, no retirement, as before 3b. Review 1: timed
  from the restart, a weekly last-day line already past its printed time would read as tomorrow's and hold every
  automatic line for most of a day while the agent was free.
- Only Claude Code's own limit rows are recorded (a "hit your ... limit" row with its turn footer, the rule classify
  and retireResetLimits use), so a quoted line in a tool result never sets a time.
- More rows with one key than at the last capture is a new limit printing the same words (yesterday's retired row
  still in the scrollback above today's): its first-seen time starts again.
- A dateless row with no time read (late, or beyond the span bound) is neither retired nor held: today's behaviour.
- Rejected: retiring a dateless line on the turn footer's printed time ("done 10:35 PM"): no date either, absent on
  some screens.
- Weakest premise: one row count per key is enough to tell a new limit from an old one. A new limit whose identical
  row replaces the old one in the same capture (the old scrolled out exactly as the new arrived) keeps the old time.

## Residuals
- A row off the screen for more than two minutes that comes back (a redraw that drops scrollback) is timed afresh as a
  new limit, and if its printed time already passed today it reads as tomorrow's (bounded by the one-day span).
- (from 3a) A weekly last-day line first seen after a restart, past its printed time, resolves to tomorrow's time.
  With 3b that also means it is held, and not retired, until then. Bounded by the one-day span.
- Windows cards reading rate_limited at all is unmeasured (slice 1's gap).

## Tests
- engine/limitretire-5805.test.js: the screen pass records and ends first-seen times (row present, absent under two
  minutes, absent over; a failed capture); retireResetLimits retires a dateless row past its resolved reset and keeps
  one ahead of it, one with no first-seen time, and one with the limit menu below it; a capped agent on a dateless
  line ahead of its reset is held (automatic line not typed) and after it reads idle and is typed to; controls on a
  dated line unchanged.

## Review 1 (opus)
- FIXED (WARNING): a row first seen at a restart was timed from the restart; now marked late (see Decided). Tested.
- FIXED (WARNING): a new limit with the same words inherited yesterday's first-seen and was retired at once; a higher
  row count starts it again. Tested.
- FIXED (WARNING): a quoted limit line could set the time; only Claude Code's own rows count. Tested.
- FIXED (NIT): all three have tests.
