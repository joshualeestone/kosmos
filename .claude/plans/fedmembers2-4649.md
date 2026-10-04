# #4649 slice 1b: what Pete's member-side screens need (answers to Q-K1, Q-K4, Q-K6)

Stacked on fedmembers-4649 (#5266). Answers posted on #4649, comment 5982827679.

## Call
- **Q-K4: Members for a project this board JOINED** answers `{ owner: false, owner_name, sealed, ended, removed, invites: [], checked_at: null }` (no raw `ended_reason`: the connector's words carry an HTTP path; review round 1). `sealed` is `null` when the seal record cannot be read. `owner_name` is the handle the coordinator gave at verify (federation.externalName cleaned and cut it there). `sealed` = a member room record exists (joined with a sealing code, key arrived or not). `ended` = fedseats' ended mark on the link; `removed` = that mark is the owner's revoke (matched on "revoked" or "removed this computer", #5193's reason). Shot 11 turns the composer off on `removed`.
- **Q-K6: a project shared only with this account's other computers** answers `200 { owner: true, self_shared: true, sealed: false, invites: [], checked_at: null }` instead of the 409, so the screen leaves out "Invite someone outside" (#4658).
- **Q-K1: join lines, written by the board as room notes:**
  - owner: "<label> joined." (or "Someone joined from outside." with no label) when fedseats.ownerHello PINS a new member's computer, the moment someone has really joined. A repeated hello from the same member writes nothing.
  - member: "You joined this project from outside. Only its owner can invite people to it." from the join route.
    The owner's handle is NOT in it (review round 1): agents read a room note as Kosmos's own voice ("[kosmos] ..."),
    and the handle is a name the owner chose freely, so it could speak as Kosmos. The screen shows `owner_name` from
    Members, which the page escapes and agents never read.

## Rejected
- Writing the owner's join line from GET /members (when someone looks): it would only appear when the owner opened the list.
- A `revoked` verify reason for withdrawn codes (Q-K3): the coordinator answers a withdrawn code as an unknown one on purpose.

## Weakest premise
`removed` is read from the ended reason's words. #5193 (#5253, not merged yet) rewords what the room SAYS but keeps the connector's reason in the link; if a later change rewrites the stored reason, `removed` reads false while `ended` stays true (the screen then shows a generic ended state, not a wrong one).

## Review round 1 (opus): 2 warnings, fixed
- The owner's handle in a `[kosmos]` note agents read: removed from the note (above). Tested: the note never
  contains the handle; a mutation putting it back reds the test.
- An unreadable seal record answered `sealed: false`: now `null`. Tested.
- NITs: raw `ended_reason` dropped; the fedseats test restores the record it writes.

## Tests
engine/fedmembers.test.js, engine/fedseats.test.js, server.fedmembers-4649.test.js, engine/federation.test.js, server.federation-3311.test.js: 175/175. Mutations, each red on its own test: no owner join line; no member join note; self_shared back to a 409.
