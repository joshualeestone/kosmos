# loophandoff-7461: while the room wake cap is paused, a one-member handoff still wakes its member (kosmos#7461)

Card: kosmos#7461 (Splinter, 2026-10-28 02:12; feedback item 14, 10-22). Follow-up to #7246 slice 2 (C).

## What changed
engine/roomloop.js: while a project is paused (40 agent wakes an hour), a post asking exactly ONE member still wakes it,
within PAIR_CAP = 3 per ordered pair (sender to recipient) and THROUGH_CAP = 10 per project, per pause. pairCan checks,
pairTake spends (where the post's wake is counted, after the board's refusals and before any typing), pairRefund gives
a slot back when the post reaches nobody. Counts are forgotten whenever a pause ends (it runs out, or a person clears it).
engine/messages.js sendPostWithDelivery: askedAll (before switched-off members are set aside), askedHere, oneThrough,
loopQuiet.

## Decisions
- One member, not "any addressed post": a handoff names one; a loop is what the cap is for.
- Two bounds: per ordered pair (two agents answering each other stop at 6 a pause) and per project (a ring of agents
  uses fresh pairs; review 1 measured N x (N-1) x 3 without it).
- Spend late, refund on reach-nobody (reviews 1 and 2), so a refused or failed handoff cannot use up the budget.
- An @all is never one member, except in a room of exactly two, where it is (review 2, decided and pinned).

## Weakest premise
That 3 per pair and 10 per project per pause cover a real handoff queue. Both are one constant.

## Not covered
A pause that begins and continues only with one-member posts is not announced until a post is left quiet.
