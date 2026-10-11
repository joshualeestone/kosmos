# limituntil-5805: the card says "Out of usage until <time>" (kosmos#5805 slice 3a)

Stacked on limithold-5805 (slice 1, kosmos#5818). Rebase onto main after it merges.

## What
A capped Claude card carries `limitUntil` (ISO), the reset its limit line printed, and its state line says "Out of
usage until <time>" while that is ahead. Dated lines are read as slice 1 reads them (status.limitResetAt). Dateless
lines ("resets 4pm (America/Chicago)": the 5-hour session limit, and a weekly limit's last day) are read as the next
occurrence of that time after the board first saw the line.

## How
- engine/status.js: `limitResetTimeOnlyAt(line, firstSeenMs)`; `claudeLimitUntil(agent, evidence, now)` keeps each
  agent+line's first-seen time in memory; the pane card gets `limitUntil` (claudeLimitUntilIso: Claude panes read
  rate_limited only).
- web/index.html: stateReason's rate_limited arm says "Out of usage until <time>." after the Antigravity arms, only
  while the time is ahead.
- docs/browser-checks/fixtures/agent-card.json: the golden card gains `limitUntil: null` (#2519).

## Decided
- A dateless time is read from when the board first saw it. Bounded: a session limit resets within five hours of the
  turn it stopped, anything else within a day (Claude Code dates a reset further away); a reading past that (the
  board restarted after the reset passed and saw the line late) gives no time rather than tomorrow's.
- First-seen is in memory, not on disk. Rejected persisting it: the span bound already stops a restart from producing a
  wrong time; a restart inside the span re-reads from the restart, which can only move a dateless reset LATER by up
  to a day for a weekly line whose printed time already passed today. Weakest premise: Claude Code always dates a
  reset a day or more away (observed on the weekly form; the session form is always under five hours).
- A first-seen entry ends when the line does: when the agent's card is read not capped, or capped on another line,
  its entries are forgotten, so the same words the next day are a new limit. Not on a gap in reads: a Mac that
  slept through the reset still shows the line, and restarting its clock would name tomorrow's time. Two days is
  only a memory backstop for an agent that is gone.
- Rejected: the turn footer's time ("done 10:35 PM") as the anchor. It has no date either, and is absent on some
  screens.
- Not in this slice (3b): holding and retiring on a dateless line. That changes classification for every agent and
  needs its own review.

## Residuals
- A weekly limit's last-day line first seen after a restart, when its time is already past today, reads as tomorrow's
  time (within a day, so not refused).
- A capped card read as another state for two minutes or more while its line is still on screen (if any reading
  can do that) forgets its first-seen time; the next capped read restarts it.
- Windows cards reading rate_limited at all is unmeasured (slice 1's gap).

## Tests
- engine/limituntil-5805.test.js: the dateless resolution (same day, next day refused for a session limit, weekly
  next day, midnight, the minute's grace, the fall-back hour), first-seen kept as time passes, the card field for a
  dated and a dateless capped card and null for an idle one.
- web.limituntil-5805.test.js: the page's stateReason says the time while ahead, never a past one; the Antigravity
  wording keeps its arm.

## Review 1 (opus)
- FIXED (WARNING): the ten-minute expiry (added before review) restarted a first-seen time on any gap in reads, so a
  weekly last-day line on a Mac that slept through its reset would name tomorrow's time. Entries end on a real
  absence (the card read not capped, or capped on another line); tested across a sleep and across a day with an idle
  read between.
- FIXED (WARNING): "Out of usage until" dropped the #215 hedge for a screen reading. A scraped card says "Looks like a
  usage limit until <time>."; a reported one says "Out of usage until <time>." (tested; browser check updated).
- FIXED (NIT): the hour the fall-back repeats now reads as the later instant, as limitResetAt does (tested).

## Review 2 (sonnet)
- FIXED (WARNING): one reading that is not capped (an unknown read, a moment in another state) ended the limit and
  restarted the clock. A limit ends after two minutes of readings that are not capped; one such reading between
  capped ones keeps the first-seen time (tested through the real card builder).
- FIXED (WARNING): a dated line did not end a dateless entry, so the same dateless words after a dated limit kept a
  stale time. A dated line ends the agent's other entries (tested).
- FIXED (NIT): the key control now shows the key is the agent (a weekly line first seen by two agents at different
  times reads two different days).
- NIT not taken: "Out of usage until" for a reported card next to "Usage limit reached" elsewhere. The card asks for
  "out of usage until <time>" in those words; the screen-read form keeps the existing "Looks like a usage limit".
- Stated (residual 1, unchanged): a weekly line first seen after a restart, past its printed time, reads as tomorrow's.

## Review 3 (opus)
- FIXED (WARNING): nothing tested that a capped reading clears an earlier stray one, so deleting that line passed;
  a capped agent with two failed reads hours apart would have lost its first-seen time. A new test reads only through
  the real card builder at set clocks (capped, stray, capped, stray, capped keeps the limit; two strays three minutes
  apart end it).
- FIXED (NIT): both maps are pruned on every card read (a gone agent's entries last two days at most).

## Review 4 (sonnet)
- FIXED (WARNING): a capped line with no reset this reads (a relative "resets in 4m") did not end an earlier dateless
  limit, as the comments promised; any other line now does (tested). The comment naming which function forgets what
  is corrected.
- FIXED (NIT): no array built per not-capped card to ask whether an agent has entries (hasLimitLines), and
  forgetLimitLines takes no "null" sentinel line.
- STATED (test limit): the two tests that base times on the real clock can fail in the one hour a year before the
  Chicago fall-back repeat (a target in the repeated hour reads as its later instance, by design). The fixed-clock
  tests cover that hour.
- NIT not taken: "until 1:00 AM" with no "tomorrow" for a reset past midnight; it is within five hours and matches the
  existing quota wording (quotaResetWords names the day past 20 hours).

## Review 5 (opus)
- FIXED (NIT): three comments still promised "Out of usage until"; every Claude card is a screen reading today, so
  they now name "Looks like a usage limit until" and say the plain form is for a reported reading.
