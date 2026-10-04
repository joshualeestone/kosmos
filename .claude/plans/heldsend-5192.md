# #5192: a post held for the room key is sent when the key arrives

Stacked on #5197 (membergrace-5197), itself on #5191. engine/fedseats.js only.

## Call
post() still refuses a post it cannot seal yet (returns false, so the server's "the file stayed
here" note keeps keying on posts that went now), but instead of dropping it, it keeps it on the
seat (s.outbox) and says "That message is held on this computer: <why>. It is sent when the key
arrives." Held when:
- the room has no key yet (a member before the owner's share; an owner before its first member),
  or no room id yet;
- a member is inside its behind hold (#3728).

Sent, oldest first, by flushHeld when the key may have arrived: a member's accepted key-share, an
accepted key-rotate, an owner pinning a member (after the share frame), a seat's `connected`, and
before any post that goes out now (so a new post never overtakes a held one, for example when a
behind hold runs out with no new key). One that still cannot go is held again with everything after
it, in order. The room says how many were sent.

## Bounds
At most 50 held per seat (past that: "stayed on this computer ... 50 messages are already waiting");
one held more than an hour is not sent, and the room says how many. Sealed at send time, so the
receivers' freshness checks see a fresh time.

## Rejected
"Send now" per post (the card's alternative): a button on a room row is a web change across
web/index.html and the browser checks for a case that resolves itself within seconds once the key
arrives.

## Weakest premise
Held posts live in the seat's memory: a board restart, or the seat being stopped, loses them (the
room's own copy of each stays). A post held more than an hour is treated as no longer wanted. What
would change my mind: evidence that keys routinely take more than an hour to arrive, or that boards
restart while posts wait.

## Not covered
A post refused because the seat is not connected at all ("the connection ... is not up") is not
held: that is not this card (the key), and a seat can be down for days.
A member posting under the old key after its behind hold ran out, past the 90 s grace (#5197), still
goes out and is refused on the other boards; holding past the hold would let a forger pause a member
indefinitely.

## Controls (engine/fedseats.test.js '#5192', each perturbed red)
member post before the share is sent sealed, in order, on the share; owner post before the first
pin follows the share frame; behind-held posts go out on the rotate, before a later post; a post
after a hold ran out with no key sends the held one first; over an hour not sent + note; cap 50.
