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
The refused post itself is not resent (#5192). The realistic cases are a sleeping Mac or any disconnect
spanning the revoke: back more than 90 s later, posting before the owner's re-send reaches it (10 minutes
covered more sleeps). What would change my mind: evidence that members routinely miss a
rotation for more than 90 s while posting (for example sleep-and-post reports after a revoke).
A member that has not yet seen a newer-epoch post holds nothing, so its first post after waking
can be refused with no note; and the behind hold arms once per epoch the member holds, so a
forged envelope that armed it earlier leaves a real miss at that epoch unheld. Kept: re-arming
would let a forger pause a member indefinitely. Both are the #5192 class (noted there).

Second premise (challenge round 1): the grace is the owner's rotation time judged on the
member's clock, so a member clock running ahead shortens it, to nothing at 90 s ahead. Fails
closed (in-flight posts refused on that board, a revoked member's never shown). Stated in
fedseal.js NOT CLAIMED. The grace is measured from the owner's rotation time clamped to the
member's clock (#3728), so a member catching up late does not reopen the old key, EXCEPT when its
clock runs behind the owner's: then it runs from receipt, lengthening the grace by up to the skew
(also in NOT CLAIMED). A clock reference to close that is out of scope.

A member refusing an older epoch's post it held now gets a 'key was retired' note instead of
'could not open'. That note (shared with the owner, reworded here) names both causes, someone
removed or a computer still catching up; a member's also names its own clock running ahead.
A member past its 3 minute behind hold is told once that a post may not be shown.

## Control
engine/fedseats.test.js '#5197': rotate at R; an old-key post at R+89 s shows, one at R+91 s
does not, and is refused with the 'retired' note. Clock skew both ways; a member that joined
after a rotation is not told a key was retired. Perturbed: a 10 minute member grace in graceAfter turns it red.
