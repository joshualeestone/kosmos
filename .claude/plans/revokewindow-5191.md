# #5191: an owner refuses a revoked member's posts within seconds

Design: the two design comments on #5191 (Ice Cream Kitty, Renet's review), A + B, owner side only.

## A. The owner's grace after a rotation (engine/fedseats.js graceAfter)
- A member keeps EPOCH_GRACE_MS (10 min): it is not told why the owner rotated.
- An owner rotates only on a revoke (rotateForRevoked is its only rotation), so every owner
  rotation gets REVOKE_GRACE_MS (90 s) while a member peer remains and NO previous epoch once none
  does. The grace is computed from the rooms file alone (peers + rotatedAt), so a restart cannot
  forget it (W1). Decided in challenge iteration 1: no `rotatedFor` field. With one reason it was a
  field nothing read, and the restart safety comes from the record, not from it.
- "A member" is a pinned member peer only (N4).

## B. A post waits for a fresh edge check (holdForCheck, checkRoom)
- A sealed post to an owner room with pinned members, whose last edge check is older than
  EDGE_FRESH_MS (15 s), is held and one room-keyed check is asked (N5: one per room per 15 s, and
  never a second while one is out).
- On a check: the held posts open under the keys it leaves (a found revoke has rotated the room).
- On a failed check they stay held (W2), and the 60 s pass shows them unchecked if its own check also
  fails: today's behaviour, never worse.
- Only a post that opens NOW is held (a check can only narrow what opens), so junk takes no place.
  Held count is capped at INBOUND_PER_WINDOW; past it the room's minute-budget note.
- Post-triggered checks share one Mac-wide edges answer per 15 s (sharedEdges), so busy rooms do
  not multiply requests; a room counts as checked from when the answer was ASKED for.
- An owner refusing an older epoch's post re-sends the current key at once (at most once per 15 s),
  so a remaining member that missed a rotation catches up before the pass. Its refused post is not
  resent (#5192). Member side 10 min grace: #5197.
- Held posts are in memory: a board restart while they wait loses them, like any post in transit.

## Residual (N3)
With members left: about min(90 s, the relay's ticket life ~60 s) + 15 s, so about 75 s. With none:
B's detection, up to 15 s after the last check, plus in-flight posts.

## Controls (engine/fedseats.test.js, '#5191' tests), each perturbed to red
only-member revoke + post 10 s later refused / same post before shown; two members 90 s grace incl.
a post sealed 1 s before the rotation (N6); restart with two members keeps the 90 s grace (W1); junk takes no held place; the cap; two rooms one request; freshness from the ask; key re-sent once on an old-epoch refusal; failing then succeeding
check shows once (W2); failing at the pass shows unchecked; 50 posts = 1 check, slow check not
doubled (N5); selfShared owner (N4).
