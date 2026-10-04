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
- engine/fedmembers.js: each Members row carries `member` = the edge's `member_account_id`, so the screen (Pete) can put
  a post whose `member` matches under that row's label ('Scout' under 'Dana Ruiz').

## Weakest premise
An owner's own other computers post as `<account>:<mac>`, never matching a guest edge; they are the owner's, and the
screen shows them as the owner's (the #4657 `same_account` flag), not under any invitee.

## Tests
engine/fedseats.test.js (slice 3), engine/messages.external-3311.test.js (slice 3), engine/fedmembers.test.js
(Members `member`), plus the slice 1 / 1b files: 192/192. Mutations, each red: take `member` from `data`; store any
`member`; no `member` on Members rows.
