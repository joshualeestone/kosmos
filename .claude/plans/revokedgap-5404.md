# revokedgap-5404: name the posts a removed member sent before it knew

Card: kosmos#5404 (found in the 0.7.25 two-account test). Owner: April. Started 2026-10-06 11:46 CDT.

## What happens
A member (B) learns it was removed only when its edge check (or later the connector) says so. Every
member post starts that check, but the post itself is sent at once and the check answers later. So a
post B sends just after the revoke goes out under the retired key, the owner withholds it, and B's own
screen never says anything about it. Later posts get "That message stayed on this computer".

## Decision
- Each seat keeps the times its posts were actually written to the connector (`sentLog`, at most 64,
  at most 10 minutes old).
- When the edge check finds the edge revoked, the coordinator's `revoked_at` (unix seconds, already in
  the edges answer) is passed to `endRevokedMember`, which counts the posts sent at or after it, less
  5 s (`REVOKE_SENT_SKEW_MS`, for the two clocks and the whole-second stamp), and says one line after
  the removal sentence: "A message this computer sent around the time it was removed may not have been
  shown to the others in the shared project." (or "N messages ...").
- Said as "may not", not "was not delivered": during the owner's 90 s grace after a rotation, an old-key
  post can still open on the other boards (`REVOKE_GRACE_MS`), so B cannot know.

## Rejected
- Holding every member post for its edge check (as the owner side does with holdForCheck): a larger
  behaviour change to every member post, for a minor card.
- A fallback "posts since the last check that saw the edge active": the edges answer is shared and
  cached for 15 s, so the time it was seen active is not the time it was asked. It produced wrong
  counts in reasoning before any test, so it was dropped.

## Known gap
With no `revoked_at` (an answer without it, or the ending arriving only by the connector's refusal),
nothing is said about the posts. Every member post already starts an edge check that carries
`revoked_at`, so this needs that check to fail (Kosmos+ unreachable) at the same time.

## Tests
`engine/fedseats.test.js`, four #5404 tests beside the #5193 ones: the card's case (one post 3 s after),
two posts in one sentence, a control with the revoke stamped after the posts (no line), and no
`revoked_at` (no line). On origin/main's fedseats.js the first two fail and the two controls pass.

## Weakest premise
That B's clock is within about 5 s of the coordinator's. Behind by more, a gap post can go unnamed
(the old behaviour); ahead by more, a post just before the revoke can be named "may not have been shown".
