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
- A first-seen entry lasts only while its line keeps being read (the board reads every card every few seconds): a
  line not read for ten minutes is a limit that ended, so the same words the next day are a new limit, never read
  against yesterday's time (caught before review: the first version kept entries for two days).
- Rejected: the turn footer's time ("done 10:35 PM") as the anchor. It has no date either, and is absent on some
  screens.
- Not in this slice (3b): holding and retiring on a dateless line. That changes classification for every agent and
  needs its own review.

## Residuals
- A weekly limit's last-day line first seen after a restart, when its time is already past today, reads as tomorrow's
  time (within a day, so not refused).
- Windows cards reading rate_limited at all is unmeasured (slice 1's gap).

## Tests
- engine/limituntil-5805.test.js: the dateless resolution (same day, next day refused for a session limit, weekly
  next day, midnight, the minute's grace, the fall-back hour), first-seen kept as time passes, the card field for a
  dated and a dateless capped card and null for an idle one.
- web.limituntil-5805.test.js: the page's stateReason says the time while ahead, never a past one; the Antigravity
  wording keeps its arm.
