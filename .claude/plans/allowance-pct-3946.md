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
- Which way the errors run, stated per error rather than as one direction:
  - Use outside Kosmos (claude.ai, another computer, another Kosmos world on the same
    account) moves the figure with no Kosmos tokens behind it, so a point looks cheaper:
    the swarm pauses early. This one is NOT small or bounded: on an account used mostly
    outside Kosmos, a point can look many times cheaper than it is, and a "3%" swarm can
    pause far sooner than 3% of the week. Accepted because it is the direction Josh asked
    for ("a very low percentage"); no floor is invented for it.
  - The figure is a whole number, so the points moved can be under-read by up to one.
    Tokens are divided by points + 1, which leans the same way (early).
  - A figure that lags the tokens (the provider updates it later than Kosmos counts)
    makes a point look dearer: late. So does an agent that switched accounts today,
    whose tokens on the old account are counted against the new one. Neither is
    bounded here; the daily re-measure and the points rule below keep them to a day.
- A new day's estimate replaces the stored one only once it rests on at least as many
  points, so a noisy 2-point morning does not overwrite a 15-point day. Past three days
  old, any qualifying day replaces it, so one heavy day does not hold until it expires
  at seven and drop every % swarm on the account back to tokens mid-day.
- Every Claude account with a Kosmos agent is measured each sweep, swarm or not, so the
  create screen can offer the % for an account's first swarm.
- A % that changes no tokens (an uncalibrated account) is not a new limit, so it does
  not cancel a switch-back-on override for today.

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
