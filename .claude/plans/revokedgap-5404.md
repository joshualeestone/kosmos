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
  most 65 entries, pruned past 10 minutes whenever a post goes).
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
- Unsealed rooms get the line too, on purpose: there no key stops the post, and the relay cuts a
  removed member only when its room ticket runs out, so the others may or may not have seen it.
- The log keeps one past its cap of 64, so exactly 64 is said as "64 messages" and more as "More than
  64 messages".

## Rejected
- Holding every member post for its edge check (as the owner side does with holdForCheck): a larger
  behaviour change to every member post, for a minor card.
- A fallback "posts since the last check that saw the edge active": the edges answer is shared and
  cached for 15 s, so the time it was seen active is not the time it was asked. It produced wrong
  counts in reasoning before any test, so it was dropped.

## Known gap
With no `revoked_at` (the coordinator cannot be asked, or its answer lacks the field), nothing is said
about the posts: no claim without a time.
The log lives only in the seat's memory: a board restart, or the seat being replaced, between a gap post
and the revoke being found loses it, and that post is not named (the old behaviour).
A post the connector also refused (its "A message was not sent" line) can be named again by the gap
line. Both are true; it is a repeat, not a contradiction.

## Tests
`engine/fedseats.test.js`, seven #5404 tests beside the #5193 ones. Four positive: the card's case
(one post 3 s after), two posts in one sentence, at and past the cap (64 exact, then "More than 64"), the connector's
refusal arriving first. Three controls that must say nothing more: the revoke stamped after the posts,
the refusal path with a fresh answer that failed or still says active, and no `revoked_at`. Measured
on origin/main's fedseats.js: 5 fail (the four positive, and the refusal-path control, which also
asserts the fresh ask that main never makes) and 2 pass (the other two controls).

## Weakest premise
That B's clock is within about 5 s of the coordinator's. Behind by more, a gap post can go unnamed
(the old behaviour); ahead by more, a post just before the revoke can be named "may not have been shown".
