# revokedgap-5404: name the posts a removed member sent before it knew

Card: kosmos#5404 (found in the 0.7.25 two-account test). Owner: April. Started 2026-10-06 11:44 CDT (claim log).

## What happens
A member (B) learns it was removed only when its edge check (or later the connector) says so. Every
member post starts that check, but the post itself is sent at once and the check answers later. So a
post B sends just after the revoke goes out under the retired key, and B's own screen never says
anything about its fate. Later posts get "That message stayed on this computer". Whether the others see
it depends on who is left: with nobody else in the room the owner keeps no grace and withholds it (the
card's two-account run); with members left, the owner's 90 s grace after its rotation can still open it.

## Decision
- Each member seat keeps the times its posts were actually written to the connector (`sentLog`, at
  most 64 entries, pruned past 10 minutes whenever a post goes).
- When the edge check finds the edge revoked, the coordinator's `revoked_at` (unix seconds, already in
  the edges answer) is passed to `endRevokedMember`, which counts the posts sent at or after it, less
  5 s (`REVOKE_SENT_SKEW_MS`, for the two clocks and the whole-second stamp), and says one line after
  the removal sentence: "A message this computer sent around the time it was removed may not have been
  shown to the others in the shared project." (or "N messages ...").
- When the connector's own refusal ends the seat first (the edge check had answered from a shared
  answer asked before the revoke), the refusal carries no time, so B asks the edges once more, refusing
  any answer asked before then, and says the same line from its `revoked_at`.
- Said as "may not", not "was not delivered": B cannot tell whether anyone else is left, so it cannot
  tell whether the owner's grace applied (see above).

## Rejected
- Holding every member post for its edge check (as the owner side does with holdForCheck): a larger
  behaviour change to every member post, for a minor card.
- A fallback "posts since the last check that saw the edge active": the edges answer is shared and
  cached for 15 s, so the time it was seen active is not the time it was asked. It produced wrong
  counts in reasoning before any test, so it was dropped.

## Known gap
With no `revoked_at` (the coordinator cannot be asked, or its answer lacks the field), nothing is said
about the posts: no claim without a time.

## Tests
`engine/fedseats.test.js`, five #5404 tests beside the #5193 ones: the card's case (one post 3 s after),
two posts in one sentence, the connector's refusal arriving first, a control with the revoke stamped
after the posts (no line), and no `revoked_at` (no line). On origin/main's fedseats.js the three
positive ones fail and the two controls pass.

## Weakest premise
That B's clock is within about 5 s of the coordinator's. Behind by more, a gap post can go unnamed
(the old behaviour); ahead by more, a post just before the revoke can be named "may not have been shown".
