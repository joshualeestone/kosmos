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
accepted key-rotate, an owner pinning a member (after the share frame), a seat's `connected`, each
60 s pass, and before any post that goes out now (so a new post never overtakes a held one). One
that is held again keeps everything after it held, in order; one refused for good (too long, could
not seal) says why and the rest carry on. The room says how many were sent, and whether any had a
file (the server tells the seat: `files`), since files never leave this computer.
A post held because a member is behind goes, when that hold runs out with no new key, under the key
the member has; the hold note says so (the others may not accept it, #5197).

## Bounds
A post that meets an unreadable rooms record is held too (it goes once the record reads and says
whether the room is sealed). A new post that finds held posts a flush could not finish waits behind
them. Every re-hold goes through holdPost, so the age, count and byte bounds hold for it too. A flush
that throws keeps everything it had not handled.
A post that could never go (too long once sealed, measured by sealing it with a throwaway key) is
refused at once with the too-long note, not held.
A post re-held during a flush keeps the time it was first held, so passes never reset its hour. A
flush runs only through the project's live, connected seat (a key that arrives while the seat is down
keeps the posts held until it is up; a replaced seat never sends another's). A held post the write
loses stays held. A flush that meets an unreadable rooms record holds the posts again for
the next one. The byte cap keeps a flush well inside the receiver's minute but is not a guarantee:
other posts in that minute share it.
At most 50 held per seat, and at most 3/4 of the receiving board's minute byte budget (a flush sends them
in one go; past either: "stayed on this computer ... as many messages as Kosmos sends at once");
one held more than an hour is not sent, and no longer counts against the cap; the room says how many. Sealed at send time, so the
receivers' freshness checks see a fresh time.

## Rejected
"Send now" per post (the card's alternative): a button on a room row is a web change across
web/index.html and the browser checks for a case that resolves itself within seconds once the key
arrives.

## Owner side (asked in review, kept)
An owner's post held before its first member is pinned goes to that member when it joins (within the
hour). That is the card's ask (held, then sent), and the owner's hold note says exactly that: it
is sent to the first computer that joins with its key, if one joins within the hour.

## Weakest premise
Held posts live in the seat's memory: a board restart, or the seat being stopped, loses them (the
room's own copy of each stays). A post held more than an hour is treated as no longer wanted. What
would change my mind: evidence that keys routinely take more than an hour to arrive, or that boards
restart while posts wait.

## Not covered
A seat that has ended (this member removed) never flushes: its held posts are never sent and never
reported as expired; the room already says the connection ended.
A post refused because the seat is not connected at all ("the connection ... is not up") is not
held: that is not this card (the key), and a seat can be down for days.
A member posting under the old key after its behind hold ran out, past the 90 s grace (#5197), still
goes out and is refused on the other boards; holding past the hold would let a forger pause a member
indefinitely.

## Controls (engine/fedseats.test.js '#5192', each perturbed red)
member post before the share is sent sealed, in order, on the share; owner post before the first
pin follows the share frame; behind-held posts go out on the rotate, before a later post; a post
after a hold ran out with no key sends the held one first; over an hour not sent + note; cap 50
(a stale post takes no place); a refusal for good does not strand the rest; a held post with a file
says so when sent (and server.fedmsg: the server passes `files`); held for a missing room id goes on
connect, and the pass flushes after a behind hold ran out; a stopped seat sends nothing held.
