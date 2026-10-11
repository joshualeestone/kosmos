# revokestamp-5191: refuse a revoked member's post at once, even with members left

Card: kosmos#5191 (decision comment 6110214161). Owner: Angel (handed over by Ice Cream Kitty 2026-10-11 09:44).

## Finished looks like
With other members left in a sealed room, a post the relay stamps as a revoked member's is not shown
on the owner's board, from the moment the owner's board knows of the revoke, while a remaining
member's old-key post in flight still shows inside the 90 s grace, and a re-invited member's
new-key posts show.

## Change (engine/fedseats.js, server.js; owner side only)
1. The owner room's record (rooms file) gains `revokedAccounts`: account -> the newest epoch it
   held. Written ONLY in the same save as a rotation, from the pinned peers it dropped. So no edges
   answer, however old (the 60 s pass, the 15 s shared cache), can add or remove one (challenge
   iteration 1 found the first design, which re-read every answer, did both); it survives a
   restart; and a forgotten or recreated room starts without it (iteration 2: in-memory notes
   could be re-written by a check queued before a stop).
2. The member's account is recorded on its peer at the pin (ownerHello already holds it), so the
   rotation names it without relying on the revoke's answer; a peer pinned before this change
   falls back to that answer by its edge id.
3. An account that a KEPT peer also has (one account on two edges) is not recorded.
4. handleEvent (owner, sealed, opened): a post whose relay stamp `ev.member` equals a recorded
   account and whose authenticated epoch is <= the recorded epoch is refused with one note.
5. server.js /api/federation/remove: on success, `fedseats.afterRemove(project)` runs the revoke
   check at once with a fresh answer, so the room rotates (and records) now.

## Not covered (stated)
- An older relay sends no stamp: unchanged, #5228's grace is the bound.
- A revoke made from the owner's OTHER computer is known here only at this board's next edge check.
- Unsealed rooms: the relay's ticket is the bound, as today.
- A room pinned before this change, whose revoke answer also lacks the account, cannot name the
  member: the 90 s grace stays the bound there.
- Between the remove and its own check answering (one request), the revoked member is still
  pinned and nothing is noted yet.

## Tests (engine/fedseats.test.js, server.fedmembers-4649.test.js)
Each run against a perturbation that turns it red (recorded in the commit messages):
- the card's control in a room of TWO, with a no-stamp control arm;
- remove-from-screen vs a post whose check reuses a pre-remove cached answer (both arms);
- stale answers before a re-invite / before a revoke change nothing;
- one account on two edges; exact stamp and epoch rule;
- the account from the pin vs from the answer (both arms); a restarted board still refuses;
- the route calls afterRemove(project).
