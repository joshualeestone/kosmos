# fedcopy-5194: two federation room lines from the #3728 live check (#5194, #5195)

Cards: #5194, #5195 (Ice Cream Kitty + PigeonPete, #3728 live check, 2026-10-03). Splinter 18:54: build now, MERGE AFTER MONDAY.

## Done looks like
- **#5194:** an owner whose room had a member and has none now (revoked) is told, when a post stays local, "That message stayed on this computer: nobody else is in this shared project now." Before anyone has joined it still says "nobody outside has joined this shared project yet."
  - The signal is the room key. The owner's key is made when the first member joins (ownerHello), and kept, rotated, through a revoke (rotateForRevoked keeps keys and drops the revoked peers). So waiting + a key = someone was in it.
  - An owner only goes to "waiting" when no edge is active (ownerEdge got.none, or a refused edge). A member who joined and is merely offline does not cause it, so "now" is accurate.
- **#5195:** the owner's room says "This shared room is sealed: only the computers in it can read its messages." once, when the room first has its key (the first member's hello is accepted). It is the same sentence the member sees, now one constant (SEALED_LINE). It is not said again on a repeat hello, and never before a key exists.

## Measured
- engine/fedseats.test.js 72/72, with two new tests.
- Against main's fedseats.js both new tests are red.
- Related federation tests: engine/federation*, fedseal, remote-fed-live-refresh, server.federation-3311, server.fedmsg-3311 114/114; web.fed-plus-gate + web.federation-3312 23/23 (they must run from the repo root: they read web/index.html by a relative path).

## Weakest premise
- An owner whose room was keyed BEFORE this ships never gets the #5195 line: it is said at key creation, as on the member side. A one-time line for already-keyed owner rooms would need a flag in the room state; not done, named here.
