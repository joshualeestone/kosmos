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
3. **Forged envelope: DECIDED NOT BUILT (review round 2, 05:2x).** See "Part 3" below. noteOwnSealed is as on main.
4. Relay: `account-computers` rows carry `mac_id` (separate kosmos-relay PR). Not secret: the own-hello frame and
   the match code already expose it to the account's computers.

## Approach
- revokeCheck: proceed when peers OR own is non-empty. `gone` = guests whose edge is not active (as now) plus own
  pubs whose mac is absent from a complete computers answer, plus an explicit `dropOwn` list (the route). Edges are
  asked only with peers; computers only with own. One epoch advance, still inside revokeCheck (#5191 guard).
- (SUPERSEDED 05:2x: part 3 is not built, so there is no forgetOwnSealed. The writer added instead is ownRejoin,
  round 3 below.)

## Rejected
- Waiting for the relay branch: the 09-30 ownseal-4658 was stale. (Correction 05:04, Baron: it was revived as
  kosmos-relay ownseal-4658-v2 on current main, own-seat-requests included, PR to follow. #7028 still uses only what
  main has; Baron takes "learn sealed before the first post" after both land.)
- Matching st.own to account-computers by NAME: names are not unique and change; a rename would revoke.
- Asking before recording (the card's first option): needs a second "held while asking" state; record then clear
  holds posts the same way and keeps one path.

## Weakest premise (current, 05:3x)
That a computer the account-computers list stops naming should lose the room. A held computer, or one whose id
changed (a re-enrolment mints a new mac id), is taken out and must compare codes again (ownRejoin gives it the way
back, after 10 minutes behind). What would change it: a coordinator signal that separates "retired" from "held".
(The earlier weakest premise, about part 3 reading "no edge" as "never sealed", is moot: part 3 is not built.)

## Tests (planned)
engine/fedseats.ownremove-7028.test.js, server route test, guard update; mutants for each.

## Decided while building (04:2x-04:4x 10-24; the held-post, never-sealed and forgetOwnSealed bullets are
## SUPERSEDED by part 3 not being built)
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
   no cooldown. Every sealed-looking frame records the seal (the safe side). The asking is bounded by the wait
   itself: a room is asked only while it holds no record, and one is cleared only 10 s after its answer (an
   explicit per-room limit was written, found unreachable by mutants M19/M20, and removed).
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

## Part 3 (forged envelope): decided not built, 05:2x 10-24
**The call:** an own computer that sees a sealed-looking frame keeps holding its posts, as on main; nothing from
outside undoes it. The auto-clear built in rounds 0 and 1 is removed.
**Why:** on main a self-shared project refuses guest invites (federation.js invite, reason self-shared) and a
guest-sealed owner project refuses own codes (ownCodeRefusal 'sealed'). So in an own room the only senders are this
account's computers and the relay. Both can already deny service (the relay can drop every post), so a forged
frame gives them nothing new. Clearing a seal on a Kosmos+ answer (no edge, no offer within 10 s) rests on facts the
coordinator controls, and would let a dishonest coordinator downgrade a REAL seal so the own computer posts
readable words to the relay: the one party sealing exists to defend against. Round 2 also showed the clear was
either permanent on a blip or restart (a failed answer kept the record and nothing asked again) or defeatable by
any repeated frame, and silent when nothing was held.
**Rejected:** keeping the clear with more guards (each round found the next hole, and the trade is wrong at the
root); a manual "this room is not sealed" button (the same downgrade, by talking the person into it).
**Weakest premise:** that guests and own computers stay mutually exclusive in one room. #4658's later parts may lift
that (own computers in a guest-sealed room); then a guest could forge, and this should be re-decided, preferring a
signal the owner's key signs over anything the coordinator says.
**What would change it:** an owner-signed "this room is unsealed" statement own computers can verify.

## Review round 2 (blind, 05:1x)
1. [BLOCKER-class] the clear trusts the coordinator (above) --> part 3 removed.
2. [SHOULD-FIX] a failed answer or restart makes a forged seal permanent --> moot (no clear; holding is main's behaviour).
3. [SHOULD-FIX] a repeated frame keeps the lock --> moot.
4. [SHOULD-FIX] a computers list cached from before an Allow drops the new computer --> FIXED: only a list asked
   after the pin (own[pub].at < askedAt) can drop it. Test + mutant M23.
5. [SHOULD-FIX] the clear is silent --> moot.
Also since round 1: the owner trusts a list only if exactly one row is this computer and carries its own id
(M21, M22).

## Review round 3 (blind, 05:2x)
1. [SHOULD-FIX] A dropped own computer still holds the old key, so it never says hello again: it writes into a room
   nobody reads, forever, untold (this broke round 1 item 4's premise that it "needs a new code compare").
   FIXED: ownRejoin. An own computer still behind 10 minutes after it first saw a newer key goes back to the keyless
   record, tells the person to compare codes, and says hello; the owner answers any own hello with a new offer.
   Added to the #5191 WRITERS (removes a key, advances no epoch). A wrong rejoin costs a code compare and reveals
   nothing. Mutants R1 to R5.
2. [LOW] With an own computer pinned, a guest edge check also waits on the computers request inside the sealing
   step. RECORDED: guests and own computers do not share a room on main, and macRequest has a timeout.
3. [LOW] A pin stamped while the clock ran ahead cannot be dropped by the list until real time passes it.
   RECORDED: the screen remove still works, and the failure is on the safe side (keeps, never wrongly drops).
4. [LOW] The own-id check needs this board's id; the code comment already says "when this board knows its own id"
   (an unenrolled board cannot ask the route at all). Plan wording above was unconditional: corrected here.
5. [PROSE] Leftovers from part 3 in the test header and this plan: FIXED (header rewritten, plan lines marked
   SUPERSEDED).
