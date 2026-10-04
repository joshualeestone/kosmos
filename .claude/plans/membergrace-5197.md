# #5197: a remaining member stops opening a revoked member's old key after 90 s

Stacked on #5191 (revokewindow-5191). Member side only, no protocol change.

## Call
A member's grace after a rotation becomes REVOKE_GRACE_MS (90 s), the owner's, instead of
EPOCH_GRACE_MS (10 min, removed). graceAfter returns it for any non-owner role.

## Why not the rotate frame carrying the reason (the card's first direction)
That is a frame version both ends must ship. It would buy nothing today: the owner rotates
only on a revoke (rotateForRevoked is its only rotation), so every reason a member could be
told is "revoke". If a routine re-key is ever added, that change adds the reason to the frame.

## Weakest premise
A member treats every old-key post after 90 s as the revoked member's. An honest member that
missed the rotation and posts more than 90 s later has that post refused on the other members'
boards (as on the owner's, since #5191). It catches up when the owner re-sends the key: on its
next connect, on each pass, and at once when the owner refuses one of its old-key posts (#5191).
The refused post itself is not resent (#5192). What would change my mind: evidence that members
routinely miss a rotation for more than 90 s while posting.

## Control
engine/fedseats.test.js '#5197': rotate at R; an old-key post at R+60 s shows, one at R+2 min
does not. Perturbed: the old 10 min grace turns it red.
