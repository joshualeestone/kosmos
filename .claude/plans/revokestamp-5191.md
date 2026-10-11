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
   answer, however old (the 60 s pass, the 15 s shared cache), can add or remove one; it survives a
   restart; and a forgotten or recreated room starts without it.
2. The member's account is recorded on its peer at the pin (ownerHello already holds it), so the
   rotation names it without relying on the revoke's answer; a peer pinned before this change
   falls back to that answer by its edge id.
3. An account that a KEPT peer also has (one account on two edges) is not recorded.
4. handleEvent (owner, sealed): a post whose relay stamp `ev.member` equals a recorded account and
   whose envelope epoch is <= the recorded epoch is refused with one note, before holdForCheck, so
   it never takes a held place or asks Kosmos+. The envelope epoch is not yet authenticated, but
   the stamp is the relay's, so a wrong epoch can only refuse its own sender's post.
5. server.js /api/federation/remove: on success, `fedseats.afterRemove(project)` records the
   moment (wall and monotonic) and runs the room's check (checkRoom) with a fresh answer, so the
   room rotates and records now, and held posts are judged on an answer asked after the remove.
   Until such a check succeeds, a room check or shared answer asked before the remove does not
   count: holdForCheck holds the next post and asks sharedEdges for a newer answer, and checkRoom
   releases only posts that arrived before the remove under an older answer. The order is judged
   on the monotonic clock where the moment is known there (a remove and its own check share a
   millisecond; a held post records its arrival there too), and by wall time otherwise, the same
   millisecond counting as before the remove for a check and after it for a post.

## Not covered (stated)
- An older relay sends no stamp: unchanged, #5228's grace is the bound.
- A revoke made from the owner's OTHER computer is known here only at this board's next edge check.
- Unsealed rooms: the relay's ticket is the bound, as today.
- A remaining MEMBER's board: it does not refuse by stamp, so it still shows a revoked member's
  old-key posts for its own #5197 grace.
- A room pinned before this change, whose revoke answer also lacks the account, cannot name the
  member: the 90 s grace stays the bound there.
- A rotation that keeps a peer whose account it cannot name (pinned before this change, missing
  from the revoke's answer) records nothing, so that one revoke falls back to the 90 s grace:
  that peer might share a dropped account, and refusing its in-flight posts would be worse.
- The stamp is the relay's word. A relay that stamped a kept member's post with a revoked account
  could have that post refused (only on a key the revoked account held); it can already drop any
  post, so this adds no power over delivery. A stamp that does not equal the edge's
  member_account_id matches nothing and falls back to the grace (coordinator fed.rs: an outside
  member's ticket member is its account id).
- `revokedAccounts` is never pruned: one entry per account ever revoked from the room, so it is
  bounded by the room's invites, and it goes when the room is forgotten.
- Between the remove and its own check answering (the room's sealing steps already queued, plus
  one request), the revoked member is still pinned and nothing is recorded yet. If its own check
  fails, the next post is held and its check asks for an answer newer than the remove.
- A post held after a remove while a check asked before it is still out waits for the remove's
  own check; if that check also fails, it waits for the next post's check or the 60 s pass, and
  the pass, when Kosmos+ cannot answer, shows held posts unchecked, as before this change.
- The remove's moment lives on the room's seat: with no seat at the remove, or a seat replaced
  after a remove whose own check failed, it is not kept, and its first post's check may use a shared answer up to 15 s old from before
  the remove (the 90 s grace still bounds it).

## Tests (engine/fedseats.test.js, server.fedmembers-4649.test.js)
Each run against a perturbation that turns it red (recorded in the commit messages):
- the card's control in a room of TWO, with a no-stamp control arm;
- remove-from-screen vs a post whose check reuses a pre-remove cached answer (both arms);
- stale answers before a re-invite / before a revoke change nothing;
- one account on two edges; exact stamp and epoch rule;
- the account from the pin vs from the answer (both arms); a restarted board still refuses;
- a remove whose own check fails still makes the next post ask fresh; a prototype-name account id;
- the route calls afterRemove(project).
