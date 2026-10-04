# #5191: an owner refuses a revoked member's posts within seconds

Design: the two design comments on #5191 (Ice Cream Kitty, Renet's review), A + B, owner side only.

## A. The owner's grace after a rotation (engine/fedseats.js graceAfter)
- A member keeps EPOCH_GRACE_MS (10 min): it is not told why the owner rotated.
- An owner rotates only on a revoke. Its rotation now records `rotatedFor: 'revoke'` with the epoch
  in the rooms file (W1). Every owner rotation, a missing or unreadable reason included, gets
  REVOKE_GRACE_MS (90 s) while a member peer remains and NO previous epoch once none does.
- "A member" is a pinned member peer only (N4).

## B. A post waits for a fresh edge check (holdForCheck, checkRoom)
- A sealed post to an owner room with pinned members, whose last edge check is older than
  EDGE_FRESH_MS (15 s), is held and one room-keyed check is asked (N5: one per room per 15 s, and
  never a second while one is out).
- On a check: the held posts open under the keys it leaves (a found revoke has rotated the room).
- On a failed check they stay held (W2), and the 60 s pass shows them unchecked if its own check also
  fails: today's behaviour, never worse.
- Held count is capped at INBOUND_PER_WINDOW; past it the room's minute-budget note.

## Residual (N3)
With members left: about min(90 s, the relay's ticket life ~60 s) + 15 s, so about 75 s. With none:
B's detection, up to 15 s after the last check, plus in-flight posts.

## Controls (engine/fedseats.test.js, '#5191' tests), each perturbed to red
only-member revoke + post 10 s later refused / same post before shown; two members 90 s grace incl.
a post sealed 1 s before the rotation (N6); restart + legacy record (W1); failing then succeeding
check shows once (W2); failing at the pass shows unchecked; 50 posts = 1 check, slow check not
doubled (N5); selfShared owner (N4).
