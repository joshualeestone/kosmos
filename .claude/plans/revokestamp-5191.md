# revokestamp-5191: refuse a revoked member's post at once, even with members left

Card: kosmos#5191 (decision comment 6110214161). Owner: Angel (handed over by Ice Cream Kitty 2026-10-11 09:44).

## Finished looks like
With other members left in a sealed room, a post the relay stamps as a revoked member's is not shown
on the owner's board, from the moment the owner's board knows of the revoke, while a remaining
member's old-key post in flight still shows inside the 90 s grace, and a re-invited member's
new-key posts show.

## Change (engine/fedseats.js, server.js; owner side only)
1. A per-room map of revoked member accounts: account -> the room epoch when it was noted.
   Filled from every edges answer revokeCheck reads (non-active edges of this project whose
   member_account_id has no active edge in it), and at once by `afterRemove` when this board's
   own screen removed the member. An account with an active edge again is dropped.
2. handleEvent (owner, sealed, opened): a post whose relay stamp `ev.member` equals a noted
   account and whose (authenticated) epoch is <= the noted epoch is refused with one note.
   Exact string match only. A re-invited member holds a newer epoch's key, so it is never refused.
3. server.js /api/federation/remove: on success, `fedseats.afterRemove(project, member_account_id)`
   notes the account and runs the revoke check at once (the room rotates now, not at the next check).
   fedmembers.remove returns the edge's member_account_id for this.

## Not covered (stated)
- An older relay sends no stamp: unchanged, #5228's grace is the bound.
- A revoke made from the owner's OTHER computer is known here only at this board's next edge check.
- Unsealed rooms: the relay's ticket is the bound, as today.

## Tests (engine/fedseats.test.js)
- the card's control in a room of TWO: revoke one, it posts 5 s later stamped -> not shown; the
  remaining member's in-flight old-key post -> shown; CONTROL: the same revoked post with no stamp
  shows (proves the stamp is what refuses).
- afterRemove rotates at once and refuses before any post-triggered check.
- a re-invited account (active edge again, newer epoch) is shown.
- a stamp of the owner's own computer (acct:mac) is never refused.
