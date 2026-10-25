# ownclear-4658: an own computer never trusts a pasted code about sealing (kosmos#4658 slice 2)

Slice 1 (#7107) made a sealed room's own code version 2, so its joiner holds from the first post. Left under NOT CLAIMED:
the code is not authenticated, so an altered code (v2 to v1), a v1 code made by an older build inside a sealed room,
or a room shared by v1 and sealed later lets a joiner post in the clear. Design posted on the card 05:0x 10-25
(comment 6396198045), refined after mapping the #7028 exchange (05:2x).

## Decided
1. **Every own join holds its posts until the room's owner answers over the compare-bound channel.** A sealed room
   answers as today (key-own-offer, compare, Allow, key-own-share). An unsealed room answers with a new
   **key-own-clear** frame after the same compare and Allow, bound exactly like key-own-share
   (pairKey(owner X25519, waiting pub, room, both pubs, 'own-clear'), AAD over room, mac, nW, nO; a fixed plaintext,
   no epoch), opened only under the owner key the person confirmed (run.offer.ownerPub).
2. **The code says which kind of answer to expect, by version**: v2 sealed (#7107), **v3** unsealed ("hold until the
   owner's clear"). A new board makes v3 for an unsealed room and **refuses a v1 code** ("made by an older Kosmos:
   update Kosmos on the other computer, then make a new code there"). Fail closed: an altered code is either v1
   (refused) or v2/v3 (held until the owner answers). An older board refuses v3 as it refuses v2.
3. **The joiner's waiting record**: a v3 join writes `{ role: 'member', ownComputer: true, pendingClear: true, keys: {} }`
   (and the link `pendingClear: true`) so sayHello starts the own hello. While pendingClear:
   - posts are held WITHOUT `sealedHeld` (they flush in the clear once the room is verified clear);
   - unsealed messages from the room are SHOWN, not refused (the room is not known to be sealed);
   - the computer makes no own code (`sealed-not-in`-style refusal: 'not-in').
   A sealed-looking envelope while pendingClear changes NOTHING (review 1: the relay or a guest can send one, and a flip
   to sealed locked the computer out for good, since an unsealed owner never sends a share). It is noted and not shown;
   the owner's authenticated answer decides: a share means sealed (adoptOwnShare drops pendingClear from the record and
   the link and marks the link sealed), a clear means clear. A clear after a share changes nothing (it needs pendingClear).
4. **The owner answers a hello with or without a room key**: ownerOwnHello / ownWaiting / allowOwn accept an owner
   whose room reads clear (isSealedRoom false). allowOwn on a clear room sends key-own-clear and writes no st.own.
5. **The joiner adopts a clear** (adoptOwnClear, beside adoptOwnShare) only when its person confirmed the code, the
   clear opened under the confirmed owner key, its record is pendingClear, and its link is not sealed (a v2 joiner
   never accepts a clear). It rewrites the link first, then forgets the record, and says "let in" only once both
   wrote (review 1); a write that fails leaves it waiting and says so, and the kept clear is taken again at the next
   connect while the process is up (after a restart, the codes are compared again; review 3). A run holding a clear
   keeps it when the owner re-offers (the owner drops the computer from its list at Allow; review 3).
5b. **An unopenable envelope never proves a room sealed** (review 3): noteOwnSealed writes the sealed record only when
   the link says the computer joined a sealed room (a v2 code); otherwise it writes the pendingClear record, so the
   owner's authenticated answer decides for every own computer, not only for one that joined by a v3 code.
6. Screens: the own-computer card and the owner's waiting list stop saying "sealed" when the room is clear.

## Rejected
- A signed code: the joiner trusts no key before the compare, and whoever alters the code can swap the key inside it.
- Holding only v1 joins: a downgraded code is a v1 join; refusing v1 is the same rule stated once.
- Trusting the coordinator to say sealed or clear (#7028's rule).

## Weakest premise
That refusing v1 codes is acceptable: a person with one computer on an older Kosmos must update it before adding
another. It is a beta with auto-update; the refusal says exactly what to do. What would change it: a ruling that
mixed-version own rooms must keep working, in which case v1 joins stay as today (NOT CLAIMED) and only v3 holds.

## NOT CLAIMED
- **An older owner board** (review 1): a computer let into an own room before this slice can, once updated, make a v3
  code while the room's first computer still runs an older Kosmos. That owner never answers, so the new computer holds
  its posts (each dropped after the hour). Its waiting note says to update Kosmos on the other computer if no code
  appears there. Auto-update makes this short-lived; nothing detects the owner's version.

- **Messages shown while waiting are unauthenticated** (review 2): a waiting computer shows the room's unsealed
  messages (it cannot know the room is sealed), so if a v2 code was altered to v3, plaintext the relay or a guest injects
  shows as a room message until the owner's share arrives. That is message integrity, not secrecy, and every unsealed
  room has it; nothing this computer writes leaves meanwhile. Agents reading the room read those rows too (review 4),
  so injected text reaches them as it would in any unsealed room; a "not yet verified" mark on such rows is a later card.
- **A computer let in by a clear** is marked `letIn` on its link; an unopenable envelope afterwards is only noted
  (review 4). A computer let in before this slice has no mark: such an envelope makes it wait for the owner's answer
  (recoverable by a compare), where before it was sealed for good.
- **Guests cannot add to the owner's waiting list** (review 4 asked): every key-own-* frame needs the relay's
  same_account stamp (onKeyFrame), which a guest's frames never carry.
- **A v3 code made by a computer that was itself let in** is answered only by the room's first computer (the owner
  link), so that computer must be on and on a current Kosmos (review 2): intended, the owner is the only one who can
  vouch for the room's state.

- **A computer let in by a clear is not listed on the owner** (review 3): there is no key to take back, so it is not
  pinned and does not appear under "Your other computers in this room", as unsealed own computers never did.
- **The owner sealing the room between Allow and the joiner's confirm** (review 3) cannot happen while the self-shared
  invite refusal stands: a room shared by a v3 code is selfShared without sealedOwn, so a sealing invite is refused.
  Lifting that refusal (below) must re-decide this.

## Not in this slice
Lifting the self-shared invite refusal entirely (decision 5 of #7107): once every own computer holds until answered,
a v1-shared room has only computers that joined before this slice; they still post in the clear. Lift it when no
pre-slice own computer can remain (a later card).
