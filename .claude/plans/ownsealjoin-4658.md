# ownsealjoin-4658: an own computer learns its room is sealed before its first post (kosmos#4658)

The 4658 board plan (ownseal-board-4658-20261024-0216.md) lists a HARD REQUIREMENT before either 409 is lifted:
"an own computer must learn its room is sealed before its first post (today it posts in the clear until it sees a
sealed message)". #7028 and the relay PR have landed (coordinator live 10-24 11:38), so it is now buildable. Mine
(agreed with Angel).

## What main does (read 10-25 01:3x at 56cae8f546)
- An own code is `kosmos-own:` + base64url `{ v: 1, ref, from, name }` (federation.ownCode); it says nothing about
  sealing. parseOwnCode refuses any v other than 1.
- Joining by own code records `{ role: 'self', ... }` and NO seal record (server.js own join), and posts the note
  "Messages in this room are not sealed end to end."
- sendPost: isSealedRoom(null, { role: 'self' }) is false, so a self computer's posts go out in the clear until a
  sealed-looking frame from someone else reaches it (noteOwnSealed then writes { role: 'member', ownComputer: true,
  keys: {} } and posts are held until the owner shares its key, the #7028 key-own-* exchange).
- Two refusals keep guests and own computers apart: ownCodeRefusal 'sealed' (no own code for a guest-sealed owner
  room) and invite / fedmembers 409 'self-shared' (no guest invite for a self-shared room).

## Decided (slice 1 of 2)
1. **A code made for a sealed room is version 2 and says so**: `{ v: 2, ref, from, name, sealed: true }`. An unsealed
   room still gets v 1, unchanged. A Kosmos older than this refuses a v 2 code ("not recognised") rather than joining
   and posting in the clear: fail closed, by the parser it already has.
2. **Joining by a v 2 code records the room as sealed at the join**: the same keyless record noteOwnSealed writes
   ({ role: 'member', ownComputer: true, keys: {} }), written before the seat starts. From the first post, sendPost
   holds (the owner has not shared its key yet), and the existing key-own-hello / offer / reveal / Allow exchange
   gives it the key. The join note says the room is sealed and the computer can read and post once the other
   computer lets it in.
3. **Lift ownCodeRefusal 'sealed' for the OWNER only.** A sealed owner room now makes a v 2 code.
4. **A self computer makes a v 2 code when its own record says sealed**; an unreadable record refuses (no code).
   A self computer in an unsealed room makes v 1, as today.
5. **The self-shared invite refusal stays, narrowed by one fact the owner knows**: a room whose own computers all came
   in by a sealed code. ownCode on a sealed owner room records `sealedOwn: true` on the link (with selfShared). The
   invite (both checks) and fedmembers refuse only `selfShared && sealedOwn !== true`. Why this is exact: a v 1 code is
   only ever made for an unsealed room, which makes it selfShared without sealedOwn, and such a room can never become
   sealed while this refusal stands. So every own computer in a sealedOwn room joined knowing.
6. The owner's first own-code note in a sealed room does not say "not sealed".

## Not in this slice (slice 2)
Guest invites for a room that already has own computers that joined by a v 1 code. Those computers cannot learn from
a code; it needs a signal the owner's key signs (the #7028 plan's Part 3 "what would change it"). The self-shared 409
stays for them.

## Rejected
- A flag inside a v 1 code: an older board ignores fields it does not know (parseOwnCode's own comment), joins and
  posts in the clear. The version bump is what makes it fail closed.
- The coordinator saying "sealed": only on a relay branch, and the #7028 rule is never to trust it to clear a seal;
  a code the person carries needs nothing new.
- Default-sealed for every self join (hold until an owner-signed "unsealed"): nothing signs that today, and it would
  hold every unsealed own room forever.
- Lifting the self-shared 409 outright: computers already in the room would keep posting in the clear (research 4B).

## Weakest premise
That a v 1 code can never exist for a room that is sealed when the code is pasted. It holds because sealing a
self-shared room is refused, and decision 5 only allows it for a room whose every code was v 2. A code that is
pasted long after it was made is fine either way: its room's version was fixed when it was made. What would change
it: any path that seals an existing self-shared room (slice 2), which must then retire v 1 codes for that ref.

## Tests (planned)
engine: v 2 made for a sealed owner room and v 1 otherwise; parse v 2; an older parser refuses v 2 (the v-guard);
self computer v 2 on a sealed record, refusal on an unreadable record; sealedOwn recorded; invite allowed for a
sealedOwn room and still refused for a v 1 self-shared room (both checks and fedmembers); a v 2 join writes the keyless
record before the seat; sendPost on that record holds the first post (never in the clear). server: the join and note.
Mutants for each.
