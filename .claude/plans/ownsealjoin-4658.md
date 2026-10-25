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
   room still gets v 1, unchanged. A Kosmos older than this does not read a v 2 code as an own code (its parseOwnCode
   takes v 1 only), so it never joins by it: it treats the text as an invite code, and the coordinator refuses it
   (review 1: that path sends the code text, with the project and computer names, to the coordinator; NOT CLAIMED
   otherwise, and no test can run the old parser).
1b. **Only a computer that holds the room key makes a version 2 code** (review 1): an owner with no key yet (the first
   guest's hello makes it) could never let the joiner in, so it is refused with 'sealed-waiting'. A computer joined by
   own code that was not let in yet is refused with 'sealed-not-in'. The joiner is always let in by the OWNER (review
   3): a self computer holding the key is a sign the owner had one, not the guarantee.
1c. **A sealed snapshot is never replaced by an unsealed one** for the same room between verify and join (review 3),
   read after the account check's await so two verifies at once cannot interleave past it (review 4; the sequential
   case is tested, the interleaving is not: no seam orders the two awaits).
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
   invite's two checks (selfSharedRef) refuse only `selfShared && sealedOwn !== true`. fedmembers' refusal of a `self`
   link is unchanged: a computer joined by own code never invites people. Why this is exact: a v 1 code is
   only ever made for an unsealed room, which makes it selfShared without sealedOwn, and such a room can never become
   sealed while this refusal stands. So every own computer in a sealedOwn room joined knowing.
6. The owner's first own-code note in a sealed room does not say "not sealed".

## Not in this slice (slice 2)
Guest invites for a room that already has own computers that joined by a v 1 code. Those computers cannot learn from
a code; it needs a signal the owner's key signs (the #7028 plan's Part 3 "what would change it"). The self-shared 409
stays for them.

## NOT CLAIMED, and known gaps (review 2)
- **The code is not authenticated.** Anyone who can alter the pasted text can turn a version 2 code into a version 1
  one for the same room, and that computer joins with no seal record and posts in the clear until it sees a sealed
  frame. Main has the same exposure today, and the same person could already change the room the code names. What
  changes here (review 4): a sealedOwn room may now have guests, so such a post goes into a room with guests. Neither
  the owner nor a guest shows it (both refuse a clear post in a sealed room, the 'unsealed' note); the relay can read
  it. Closing it needs a code the owner's key signs (slice 2).
- **No own code for a sealed room until a guest has joined** ('sealed-waiting'): the owner's room key is made by the
  first guest's hello. Making the owner's key at the first own computer's hello instead is slice 2's to decide.
- **A rewrite of the owner link that drops sealedOwn** fails closed: guest invites are refused again for that room.
- **A computer in a sealed room that runs an older Kosmos still makes version 1 codes** (review 5), for example one
  that joined by a v 2 code and was later put back on an older build. A new Kosmos joining by that code posts in the
  clear into a room that may now have guests: the same exposure as an altered code (nobody shows it; the relay can
  read it), reached without anyone altering anything. Closing it needs the signed code of slice 2.
- **A lost seal file** (review 5) no longer reads as never sealed: the owner link's sealedOwn and a self link's
  sealed (written at a v 2 join) count as sealed, so no v 1 code is made and a self computer's posts stay held.
- **A room shared by a v 1 code and later sealed by some other path** (none exists while the self-shared refusal
  stands) would make v 2 codes from then on but keep its v 1 computers posting in the clear, unmarked: slice 2's
  to handle.

## Rejected
- A flag inside a v 1 code: an older board ignores fields it does not know (parseOwnCode's own comment), joins and
  posts in the clear. The version bump is what makes it fail closed.
- The coordinator saying "sealed": only on a relay branch, and the #7028 rule is never to trust it to clear a seal;
  a code the person carries needs nothing new.
- Default-sealed for every self join (hold until an owner-signed "unsealed"): nothing signs that today, and it would
  hold every unsealed own room forever.
- Lifting the self-shared 409 outright: computers already in the room would keep posting in the clear (research 4B).

## Weakest premise
That a v 1 code can never exist for a room that is sealed when the code is pasted (except one made by an older
Kosmos inside the room, or altered: both under NOT CLAIMED). It holds because sealing a
self-shared room is refused, and decision 5 only allows it for a room whose every code was v 2. A code that is
pasted long after it was made is fine either way: its room's version was fixed when it was made. What would change
it: any path that seals an existing self-shared room (slice 2), which must then retire v 1 codes for that ref.

## Tests
engine/federation-owncode-4649.test.js: v 2 made for a sealed keyed owner room, refused without a key
('sealed-waiting'); v 1 otherwise; parse v 2 and the refused shapes (v 2 without sealed:true, without from); a self
computer v 2 once let in, 'sealed-not-in' before, a throw on an unreadable record; sealedOwn recorded; a lost seal
file still reads sealed from the links; invite allowed for a sealedOwn room and refused for a v 1 self-shared one
(federation.invite's first check; fedmembers unchanged and untested here); a room shared by v 1 and sealed later is
not marked sealedOwn. engine/fedseats.ownseal-4658.test.js: a v 2 join's record holds the first post and says hello
(with a v 1 control that sends); a self link marked sealed with no record holds. server.federation-3311.test.js: the
v 2 verify and join (record, link, note; a page-sent sealed:false and a later v 1 verify change nothing); the owner's
own-code route, 'sealed-waiting' then v 2 with its note. NOT tested: two verifies interleaving; no test runs an older
parser. Mutants for each guard (plan Measured).
