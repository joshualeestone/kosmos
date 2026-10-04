# #4649 slice 1b: what Pete's member-side screens need (answers to Q-K1, Q-K4, Q-K6)

Stacked on fedmembers-4649 (#5266). Answers posted on #4649, comment 5982827679.

## Call
- **Q-K4: Members for a project this board JOINED** answers `{ owner: false, owner_name, sealed, ended, ended_reason, removed, invites: [], checked_at: null }`. `owner_name` is the handle the coordinator gave at verify (federation.externalName cleaned and cut it there). `sealed` = a member room record exists (joined with a sealing code, key arrived or not). `ended` = fedseats' ended mark on the link; `removed` = that mark is the owner's revoke (matched on "revoked" or "removed this computer", #5193's reason). Shot 11 turns the composer off on `removed`.
- **Q-K6: a project shared only with this account's other computers** answers `200 { owner: true, self_shared: true, sealed: false, invites: [], checked_at: null }` instead of the 409, so the screen leaves out "Invite someone outside" (#4658).
- **Q-K1: join lines, written by the board as room notes:**
  - owner: "<label> joined." (or "Someone joined from outside." with no label) when fedseats.ownerHello PINS a new member's computer, the moment someone has really joined. A repeated hello from the same member writes nothing.
  - member: "You joined <owner>'s project." (or "You joined this project from outside." with no handle) from the join route.

## Rejected
- Writing the owner's join line from GET /members (when someone looks): it would only appear when the owner opened the list.
- A `revoked` verify reason for withdrawn codes (Q-K3): the coordinator answers a withdrawn code as an unknown one on purpose.

## Weakest premise
`removed` is read from the ended reason's words. #5193 (#5253, not merged yet) rewords what the room SAYS but keeps the connector's reason in the link; if a later change rewrites the stored reason, `removed` reads false while `ended` stays true (the screen then shows a generic ended state, not a wrong one).

## Tests
engine/fedmembers.test.js, engine/fedseats.test.js, server.fedmembers-4649.test.js, engine/federation.test.js, server.federation-3311.test.js: 175/175. Mutations, each red on its own test: no owner join line; no member join note; self_shared back to a 409.
