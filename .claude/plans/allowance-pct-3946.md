# allowance-pct-3946: a swarm's daily limit as a % of the weekly allowance (#3946 phase B, part 2)

## Why

Josh (#3946 items 9 and 10): "Daily usage limit", with the subtext "Choose how much
of your weekly allowance this swarm can use in one day", and a slider in % of the
weekly allowance, set very low by default (about 3%). Part 1 (#4018) records each
Claude account's weekly figure. This part turns it into a number a swarm can be
held to, and puts it on screen.

## The calibration, per account

- Tokens per point = the tokens Kosmos measured today across every Kosmos agent on
  that account (swarm.meter on each card's transcript, the same count the daily
  limit already enforces), divided by the points the weekly figure moved today (from
  kosmos-weekly.json's history).
- It is trusted only when the figure moved at least MIN_POINTS today. Before that,
  the last trusted value is used, and it is stored per account and kept for up to a week.
- Errors fail safe: use outside Kosmos moves the figure with no Kosmos tokens behind
  it, so each point looks cheaper and the swarm pauses early, never late.

## The setting

- The swarm stores dailyAllowancePct (the % Josh named) next to dailyTokenLimit.
- While the account is calibrated, the enforced limit is
  pct x tokensPerPoint. Otherwise dailyTokenLimit stands, as today.
- The sweep compares tokensToday with the enforced limit, and the Paused sentence
  says "today's limit".

## On screen

- The heading is "Daily usage limit". While calibrated, the slider is in % (default
  3) with Josh's subtext. While not calibrated, the slider stays in tokens with
  plain words, and no percentage is shown.
- Item 11's pause text is already on main.

## Weakest premise

The calibration assumes the swarm spends tokens the way the account's other Kosmos
agents do (cache reads versus fresh tokens). A swarm heavier on cache reads pauses
early, which is the safe direction.
