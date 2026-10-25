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
   A sealed-looking frame while pendingClear turns it into the ordinary keyless sealed record (pendingClear dropped):
   held posts are then re-held as sealedHeld (sendPost's sealed branch marks them) and go only under a share, and a
   clear is refused from then on (adoptOwnClear needs pendingClear). A forged sealed frame costs only availability.
4. **The owner answers a hello with or without a room key**: ownerOwnHello / ownWaiting / allowOwn accept an owner
   whose room reads clear (isSealedRoom false). allowOwn on a clear room sends key-own-clear and writes no st.own.
5. **The joiner adopts a clear** (adoptOwnClear, beside adoptOwnShare) only when its person confirmed the code, the
   clear opened under the confirmed owner key, its record is pendingClear, and its link is not sealed (a v2 joiner
   never accepts a clear). It forgets the record (fedseal.forgetRoom), drops pendingClear from the link, and flushes.
6. Screens: the own-computer card and the owner's waiting list stop saying "sealed" when the room is clear.

## Rejected
- A signed code: the joiner trusts no key before the compare, and whoever alters the code can swap the key inside it.
- Holding only v1 joins: a downgraded code is a v1 join; refusing v1 is the same rule stated once.
- Trusting the coordinator to say sealed or clear (#7028's rule).

## Weakest premise
That refusing v1 codes is acceptable: a person with one computer on an older Kosmos must update it before adding
another. It is a beta with auto-update; the refusal says exactly what to do. What would change it: a ruling that
mixed-version own rooms must keep working, in which case v1 joins stay as today (NOT CLAIMED) and only v3 holds.

## Not in this slice
Lifting the self-shared invite refusal entirely (decision 5 of #7107): once every own computer holds until answered,
a v1-shared room has only computers that joined before this slice; they still post in the clear. Lift it when no
pre-slice own computer can remain (a later card).
