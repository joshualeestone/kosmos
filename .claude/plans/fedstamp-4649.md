# #4649 slice 3, the board's half: carry the relay's member stamp, and give Members the member to group by

Stacked on fedmembers-4649 (#5266). Baron builds the relay and connector half (kosmos-relay memberstamp-4649).
Shape, agreed with Baron (HEADS-UP 13:47): the connector's stdout event gains a top-level `member` beside `data`:
`{"event":"message","data":{...},"same_account":true?,"member":"<verified ticket member>"}`. It is a string
(a guest's account id; `<account>:<mac>` for an owner's computer) and ABSENT when unknown. It is never taken from
`data`.

## Call
- engine/fedseats.js: the outside row gets `member` only from the event's TOP level; a `member` the sender wrote inside
  `data` is ignored. No key at all when absent (an existing exact-shape test pins the row).
- engine/messages.js externalPost: keeps `member` only in the account shape (`^[A-Za-z0-9_-]{1,80}(:[A-Za-z0-9_-]{1,80})?$`);
  anything else is not stored.
- (Review round 1: the account id must not leave the board; it would let one guest recognise another across rooms,
  and GET /api/messages would have handed it to any local agent with the board token.) So the BOARD maps it:
  when fedseats pins a member (ownerHello), the coordinator's edge names its account; fedmembers.noteMember records
  it on that invite's row. The room route adds `invited_as: <the owner's label>` to an outside post whose stamp
  matches, and never the stamp. GET /api/messages strips `member` from outside rows. Members rows carry no `member`.
  Pete's screen shows 'Scout' under 'Dana Ruiz' from `invited_as` alone.

## Weakest premise
An owner's own other computers post as `<account>:<mac>`, never matching a guest edge; they are the owner's, and the
screen shows them as the owner's (the #4657 `same_account` flag), not under any invitee.

## Tests
engine/fedseats.test.js (slice 3), engine/messages.external-3311.test.js (slice 3), engine/fedmembers.test.js
(noteMember / labelForMember), server.fedmembers-4649.test.js (the room's invited_as; no id in the room or
/api/messages), plus the slice 1 / 1b files: 195/195. Mutations, each red: take `member` from `data`; store any
`member`; no strip in /api/messages; no invited_as; no noteMember at the pin.
