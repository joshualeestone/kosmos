# #7028: a sealed room's own computers can be taken out, and a forged envelope cannot lock an unsealed own room

Stacked on Baron's `ownseal-board-4658` (45e1ab0f20, PR #7036, frozen). Rebased onto main once #7036 merges.

## What the card assumed, measured against main (04:2x 10-24)
The card names the coordinator's `own-seat-requests` (answers `sealed`) and a coordinator that "takes its seat when
retired". Both are on kosmos-relay branch `ownseal-4658` (09-30, 1693 behind main, no PR); `git grep` on relay
origin/main finds no fed_own_seats, own_room_sealed or own-seat route. So neither signal exists on the live
coordinator. What does:
- `POST /v1/mac/federation/edges` (Mac-signed): `as_owner` is EVERY edge of the account, revoked ones included
  (`federation_edges_for_owner` has no status filter). An own computer is on the same account, so it sees the
  owner's edges. The owner board seals a room only on a hello matched to an ACTIVE edge for `link.ref`
  (`ownerHello`), so an account with no edge of any status for that ref has never had a sealed room.
- `POST /v1/mac/account-computers` (Mac-signed): the account's unretired, unheld computers, by name. No mac id.

## Finished looks like
1. **Retired computer out of the key.** When the seal owner's periodic check (revokeCheck) learns from Kosmos+ that a
   computer pinned in `st.own` is no longer on the account (retired, held, moved), it drops it and rotates the room
   key in the same step a revoked guest is rotated out. Unreadable answer, or a coordinator too old to name its
   computers: nothing changes.
2. **Removed from the screen.** `GET /api/federation/own-allowed` lists the computers in `st.own`;
   `POST /api/federation/own-remove {pid, pub}` drops one and rotates (same guards as own-allow). The screen button
   itself waits for the own-computer screen, which #4658 has not built yet (routes only there too).
3. **Forged envelope.** After an own computer records keyless own seal state (noteOwnSealed), it asks the edges.
   If Kosmos+ answers and lists no edge of any status for this project, the room was never sealed: the keyless
   state is cleared, new posts go out, and sealed-looking frames are not shown for 10 minutes so one source cannot
   flap it. A post held meanwhile is told and NOT sent (decided 04:3x: sendPost's sealedHeld rule, a post written
   while the room read sealed never leaves in the clear). Any other answer keeps the state (held, as today).
4. Relay: `account-computers` rows carry `mac_id` (separate kosmos-relay PR). Not secret: the own-hello frame and
   the match code already expose it to the account's computers.

## Approach
- revokeCheck: proceed when peers OR own is non-empty. `gone` = guests whose edge is not active (as now) plus own
  pubs whose mac is absent from a complete computers answer, plus an explicit `dropOwn` list (the route). Edges are
  asked only with peers; computers only with own. One epoch advance, still inside revokeCheck (#5191 guard).
- Part 3 needs a writer that removes keyless own state: `forgetOwnSealed`, added to the #5191 WRITERS with the
  reason (changes no epoch, removes a state that holds no key).

## Rejected
- Waiting for the relay branch: stale for 24 days with no owner on it.
- Matching st.own to account-computers by NAME: names are not unique and change; a rename would revoke.
- Asking before recording (the card's first option): needs a second "held while asking" state; record then clear
  holds posts the same way and keeps one path.

## Weakest premise
Part 3 reads "no edge of any status" as "never sealed". Account deletion deletes edges where the deleted account is
the MEMBER (delete_account.sql), so a room sealed for a guest who later deleted their account can read as never
sealed. Then an own computer that never got the key clears its state and posts in the clear into a room with no
outside member left. What would change it: the coordinator keeping a seal fact that survives a member's deletion.

## Tests (planned)
engine/fedseats.ownremove-7028.test.js, server route test, guard update; mutants for each.

## Decided while building (04:2x-04:4x 10-24)
- **Held posts after a forged seal are told, not sent.** The plan said "held posts go out"; the existing rule says a
  post written for a sealed room never leaves in the clear. The person saw "this room is sealed" when they wrote it,
  so the rule wins. Rejected: sending them (privacy promise broken for the sake of one hour's delay).
  Would change it: a ruling that the own computer's seal note is not a privacy promise.
- **own-remove is not step-up gated.** The gated route list's own comment says removes are not gated (they only
  take access away), and no other remove is. Rejected: gating it like own-allow.
- **The never-sealed check asks fresh** (sharedEdges with notBeforeMono): a cached answer from before an edge was
  made would clear a real seal. Costs one request per sealed-looking frame outside the cooldown.
- **forgetRoom is now in the #5191 writer guard**, with fedmembers' two existing callers named, rather than
  leaving forgetOwnSealed outside it under another spelling.
- **Found by the tests:** revokeCheck read the edges answer for revoked accounts even with no guest pinned; that
  threw for an own-only room. Fixed.

## Tests (done)
engine/fedseats.ownremove-7028.test.js (17), server.ownremove-7028.test.js (4), the #5191 guard and the #4658
fixture updated. 14 mutants, all caught (mutant list: scratchpad mut7028.py, restated in the PR).

## Review round 1 (blind, 04:2x) and what changed
1. [SHOULD-FIX] The 10-minute cooldown ignored a real seal that came inside it, so posts went in the clear. FIXED:
   no cooldown. Every sealed-looking frame records the seal (the safe side); only the asking is limited (one per
   room per 10 s, a frame inside the window is checked when it ends).
2. [SHOULD-FIX] The weakest premise was worse than written: a room sealed for a guest who deleted their account
   looped forever (clear, re-record, clear) and killed every code exchange. FIXED: a same-account key-own offer
   (only this account's computers can send one) proves the owner holds the room sealed, and then it is never
   cleared; a "never sealed" answer clears only after 10 s more with no offer, and not at all if a sealed-looking
   frame arrived after the answer was asked (it asks again). Residual: that guest case with the owner's board
   offline clears until the owner's next sealed frame, which records it again.
3. [SHOULD-FIX] No test could see revokeCheck's `checked` (it decides whether guest posts are released).
   FIXED: fedseats.test.js "#7028: with an own computer pinned too, a failed account-computers answer does not
   hold a guest's post".
4. [DESIGN] A held computer is dropped for good and needs a new code compare. DECIDED, kept: a computer the account
   holds should not read the room, and losing access is the conservative side. Would change it: a hold meaning
   something routine (billing) rather than "not yet allowed" on the coordinator.
5. [LOW] A removed own computer's old-key posts open for the 90 s grace (no relay-stamped account to refuse).
   DECIDED, documented as NOT CLAIMED on ownRemove; it reads nothing after the remove.
