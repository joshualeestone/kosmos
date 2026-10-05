---
pre_challenge: true
method: challenge-loop
branch: heldsend-5192
diff_hash: 5bdda9dc8ed6dd696a87947db4a3e5552a67fbc9c674fd8ab19fcc34967d822a
validation: engine/fedseats.test.js 157/157, engine/fedseal.test.js 12/12, server.fedmsg-3311.test.js 22/22 at the final code; every new control perturbed red (cap pin, clock-step edges 4:59/5:01 both ways, behind mark removed); full suite to run on Mortals before the PR (Agent1s queue is day-one only until 07:00)
subdir_audit: passed (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-10-04T04:14:34Z
iterations: 30
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 30 blind subagent rounds (opus and sonnet alternating) plus one cross-agent review (Angel, card #5192). Rounds 26 to 30 ran after the restack onto #5197's final head. **Converged:** Yes, at iteration 30: 0 BLOCKER, 0 WARNING, 2 NIT, both fixed in prose afterwards (no behaviour change). **Disclosed against this work:** two BLOCKERs in earlier rounds were introduced by my own fixes (round 12 invite filter, round 2 re-hold reset), and round 28 found a reproduced old-key path (a post written during a behind hold but held first for an unreadable record), fixed with a control that reds when the mark is removed.
**Tallied from the ledger:** 2 BLOCKER, 67 WARNING, 18 CONVENTION rows; 79 fixed, 10 deferred with a stated reason (each in .claude/plans/heldsend-5192.md).
**Stacked:** the hash covers the diff against origin/main, so it includes the branches below this one; rebasing onto a new main needs a fresh proof.

### Per-Iteration Breakdown
#### Iteration 1 (opus): 0 B, 5 W, 2 C, 2 N. Self-generated: 0
- [WARNING] engine/fedseats.js:1000: permanent refusal strands later held posts --> FIXED + test (5527b2c6)
- [WARNING] server.js:19415: held post with a file loses the file note --> FIXED (server passes files; flush note) + 2 tests (5527b2c6)
- [WARNING] engine/fedseats.js:1043: nothing flushes when a behind hold runs out --> FIXED (pass flush) + test (5527b2c6)
- [WARNING] engine/fedseats.js:977: stale posts count against the cap --> FIXED + test updated (5527b2c6)
- [WARNING] engine/fedseats.test.js: connect flush + stopped seat untested --> FIXED (2 tests) (5527b2c6)
- [CONVENTION] engine/fedseats.js:984: hold note overclaims "sent when the key arrives" --> FIXED (per-reason 'when') (5527b2c6)
- [CONVENTION] plan: plan vs code on refusal handling --> FIXED (5527b2c6)
- [NIT] edited/deleted row's old text still sent (DEFERRED: rows are not edited in the room today); sent note timing (DEFERRED).

#### Iteration 2 (sonnet): 1 B, 3 W, 1 C, 2 N. Self-generated: 1
- [BLOCKER] engine/fedseats.js:1006/990: re-hold re-stamps age: hour bound defeated --> FIXED + test (755f8a45)
- [WARNING] engine/fedseats.js:997: flush while not connected drops held posts; write failure loses a post --> FIXED + 2 tests (755f8a45)
- [WARNING] engine/fedseats.js:777: stale seat in async ownerHello flush --> FIXED (live-seat guard; covered by the not-connected test's guard, the identity half untested) (755f8a45)
- [WARNING] engine/fedseats.js:1062: owner's pre-member posts go to the first member --> DEFERRED: the card's ask; note discloses; plan records
- [CONVENTION] test: stopped-seat test passes without its guard --> FIXED (guard now in flushHeld; new tests for age + down) (755f8a45)
- [NIT] hadFiles scan per post (DEFERRED, cheap); stale note may come late (DEFERRED).

#### Iteration 3 (opus): 0 B, 2 W, 0 C, 6 N. Self-generated: 1
- [WARNING] engine/fedseats.js:1002: flush burst exceeds the receiver's minute byte budget --> FIXED (byte cap) + test (3d1f6e63)
- [WARNING] test: stopped-seat test cannot fail; replaced-seat bound untested --> FIXED (race test, perturbed red) (3d1f6e63)
- [NIT] file clause wording (FIXED); "within an hour" (FIXED); missing-room wording (FIXED); oversize held then refused (DEFERRED: exact check at send kept); EPIPE comment (FIXED); ended seat in plan (FIXED).

#### Iteration 4 (sonnet): 0 B, 3 W (1 re-raise), 1 C, 2 N. Self-generated: 2
- [WARNING] engine/fedseats.js:1038: unreadable record mid-flush drops held posts --> FIXED + test (101eb17a)
- [WARNING] engine/fedseats.js (owner): re-raise of #11: owner note does not name the recipient --> FIXED (owner note says first computer that joins) + test (101eb17a)
- [WARNING] engine/fedseats.js:962: byte cap comment overclaims --> FIXED (prose) (101eb17a)
- [CONVENTION] engine/fedseats.js:1049: 'few minutes' vague --> FIXED (101eb17a)
- [NIT] stale unreported without a key (FIXED, pass reports); re-held + write-throw order (DEFERRED, covered structurally).

#### Iteration 5 (opus): 0 B, 1 W, 2 C (1 plan-match), 4 N. Self-generated: 1
- [WARNING] engine/fedseats.js:1069: unsendable (too long) post held and promised; eats byte cap --> FIXED (fitsSealed before hold) + test (4584b72f)
- [CONVENTION] fedseats.js:517, fedseal.js:39: comments imply #5192 resends refused posts --> FIXED (4584b72f)
- [NIT] one held note per post (DEFERRED: bounded, each post is visible); transient read overtake (DEFERRED: needs two results within microseconds); replaced-seat test can't separate the two guards (DEFERRED: stop sets both; the race is what matters); server rows scan (DEFERRED, cheap).

#### Iteration 6 (sonnet): 0 B, 3 W, 2 C, 2 N. Self-generated: 3
- [WARNING] engine/fedseats.js:1112: new post overtakes held ones when a flush stops partway --> FIXED + test (839142a5)
- [WARNING] engine/fedseats.js:1019: a throw mid-flush loses unhandled posts --> FIXED (catch restores; untested: nothing reachable throws) (839142a5)
- [WARNING] engine/fedseats.js:1074: direct re-push bypasses holdPost bounds --> FIXED (all re-holds via holdPost) (839142a5)
- [CONVENTION] fedseats.js:198, fedseal.js:39: stale #5192 comment; long line --> FIXED (839142a5)
- [NIT] server rows scan (DEFERRED); silent drop if a re-hold is refused (DEFERRED: unreachable, outbox empty during a re-hold and fitsSealed already passed).

#### Iteration 7 (opus): 0 B, 2 W, 3 C, 5 N. Self-generated: 2
- [WARNING] engine/fedseats.js:781: owner's held post reaches someone invited after it was written (seat survives an edge revoke) --> FIXED (edge per held post) + test (52a35873)
- [WARNING] engine/fedseats.js:1086: old-key flush says plainly "were sent" --> FIXED (wording) + assert (52a35873)
- [CONVENTION] fedseats.js:1079: duplicate comment --> FIXED (52a35873)
- [CONVENTION] plan:3: "fedseats.js only" --> FIXED (52a35873)
- [CONVENTION] notes: lost-on-restart held posts never reported --> DEFERRED: plan discloses; no process survives a restart to say so
- [NIT] fitsSealed on a possibly-unsealed room (DEFERRED: a 12.5-16 KiB post on a transient EIO; conservative); behindSent spent on a diverted post (DEFERRED, cosmetic); catch double-hold (DEFERRED: unreachable); server scan (DEFERRED).

#### Iteration 8 (sonnet): 0 B, 2 W, 0 C, 4 N. Self-generated: 2
- [WARNING] engine/fedseats.js:1123: behindSent note spent on a post that waits (re-raise of iter-7 NIT) --> FIXED (note after a successful write) + test (red before the fix) (a3c4f5d8)
- [WARNING] engine/fedseats.js:1000: stale pruned mid-flush reported a flush late --> FIXED (no test: count timing only) (a3c4f5d8)
- [NIT] fitsSealed on unsealed branch (dup, DEFERRED); outbox init before guard (harmless); server scan (dup); byte-cap test double assertion (adequate).

#### Iteration 9 (opus): 0 B, 2 W, 0 C, 4 N. Self-generated: 2
- [WARNING] engine/fedseats.js:1008: edge check claimed as a reader list; same-edge later joiner gets the post --> FIXED (prose: comment, plan, test title; membership-at-hold rejected: an owner holding has no pinned member) (6a211911)
- [WARNING] engine/fedseats.js:1031: old-key suffix triggered by a forged epoch --> FIXED + test (6a211911)
- [NIT] room-name when clause (FIXED); stdin gate (FIXED); fitsSealed unsealed (dup DEFERRED); heldSize raw from (DEFERRED, over-counts safely).

#### Iteration 10 (sonnet): 0 B, 2 W, 1 C, 3 N. Self-generated: 1
- [WARNING] engine/fedseats.js:914/1019: re-raise of #29: stop/ended lose held posts silently --> FIXED (dropHeld note on stop and ended; restart still silent) + test (d08f3070)
- [WARNING] engine/fedseats.js:1039: own-room (null edge) held post dropped as moved --> FIXED + test (d08f3070)
- [CONVENTION] engine/fedseats.js:1010: comment looser than code --> DEFERRED: reviewer agrees it matches; plan is exact
- [NIT] server scan (dup); catch duplicate-resend (dup, unreachable); fitsSealed stand-in (DEFERRED: room id is AAD only).

#### Iteration 11 (opus): 0 B, 1 W, 1 C, 4 N. Self-generated: 2
- [WARNING] engine/fedseats.js:918: stop() note lands in another project of the same id --> FIXED (stop silent) + test arm (a1fcf781)
- [CONVENTION] plan Not covered: contradicts the ended note --> FIXED (a1fcf781)
- [NIT] fitsSealed unsealed (dup); owner note vs moved (DEFERRED: the drop is reported); staleHeld zeroed in drop (FIXED, counted); double notes on old-key flush (DEFERRED, cosmetic).

#### Iteration 12 (sonnet): 0 B, 2 W, 1 C, 4 N. Self-generated: 1
- [WARNING] engine/fedseats.js:1017: owner's pre-guest held post goes to someone invited later (re-raise of #11/#16/#25 with a precise remedy) --> FIXED (invites at hold time) + test (d11c3e02)
- [WARNING] engine/fedseats.js:1034: held post could go in the clear if the record later reads unsealed --> FIXED + test (d11c3e02)
- [CONVENTION] plan: throw path claimed, untested --> FIXED (marked untested) (d11c3e02)
- [NIT] fitsSealed (dup); say() re-entry ordering assumption (DEFERRED: notes never federate); refused-vs-capped inference (dup, unreachable); flush inside onKeyFrame try (DEFERRED: flushHeld catches its own).

#### Iteration 13 (opus): 1 B, 5 W, 1 C, 2 N. Self-generated: 4
- [BLOCKER] engine/fedseats.js:1019: round-12 invite filter drops every held post in a room with members --> FIXED + test (a1b9156e)
- [WARNING] engine/fedseats.js:1129: unsealed room's held post dropped with a false 'no longer sealed' --> FIXED (sealedHeld) + test (a1b9156e)
- [WARNING] engine/fedseats.js:1020: link unreadable at hold: invite filter fails open --> FIXED (fail closed, true note) + test (a1b9156e)
- [WARNING] plan + 1172: async EPIPE not caught; plan overclaims --> FIXED (plan states it) (a1b9156e)
- [WARNING] test: replaced-seat identity guard untestable (stop clears outbox first) --> DEFERRED: guard is belt-and-braces; stop() is what protects
- [WARNING] engine/fedseats.js:1113: waiting seat keeps held posts forever unreported --> FIXED (ageHeld at pass) + test (a1b9156e)
- [NIT] fitsSealed throw silent on re-hold (DEFERRED, unreachable); unreadable-link wording (DEFERRED).

#### Iteration 14 (sonnet): 0 B, 4 W (1 design dup), 2 C, 3 N. Self-generated: 3
- [WARNING] engine/fedseats.js:918 + plan: plan says a stop reports; it does not; hold note silent on memory --> FIXED (plan; note says 'while Kosmos keeps running') (9a894356)
- [WARNING] engine/fedseats.js:1087: held-again inferred from outbox length (re-raised 3x) --> FIXED (s.reheld) + new seal-failure test (9a894356)
- [WARNING] engine/fedseats.js:1190: post during a flush could overtake --> FIXED (s.flushing guard; untested: unreachable today) (9a894356)

#### Iteration 15 (opus): 0 B, 2 W, 0 C, 4 N. Self-generated: 2
- [WARNING] engine/fedseats.js:1116: pinnedFrom 'any': later invitee reads after a delayed flush --> FIXED ('every') + test (cd672f4a)
- [WARNING] engine/fedseats.js:1027: owner hold on unreadable records promised then always dropped --> FIXED (refused at once) + test (cd672f4a)
- [NIT] post() internal fields (FIXED); mid-flush re-hold ordering (DEFERRED: s.flushing guard, unreachable); code-2 ended wording (dup DEFERRED); stop test (DEFERRED: the seat-gone guard covers it).

#### Iteration 16 (sonnet): 0 B, 5 W, 2 C, 3 N. Self-generated: 3
- [WARNING] engine/fedseats.js:1174: behind-held post sent under the old key at hold expiry (a removed member may read) --> FIXED (dropped at expiry, note) + tests updated (a16f44d1)
- [WARNING] engine/fedseats.js:1066: flush between unshare and stop --> FIXED (link required) + test (a16f44d1)
- [WARNING] engine/fedseats.js:1198: write after flush without re-checking the seat --> FIXED (no test: needs a note handler that stops the seat) (a16f44d1)
- [WARNING] member edge rewrite: speculative --> DEFERRED: could not be confirmed; edge check covers a changed edge
- [WARNING] server scan: dup --> DEFERRED

#### Iteration 17 (opus): 0 B, 2 W, 2 C, 4 N. Self-generated: 4
- [WARNING] engine/fedseats.js:1020: member's held post reaches later-pinned guests --> DEFERRED with statement (comment + plan): a member cannot see the room; same as a live post
- [WARNING] engine/fedseats.js:1001: sealed-size check on unknown-seal hold refuses a post that fits (re-raised NIT) --> FIXED + test (53eb019f)
- [CONVENTION] comment/plan/note: 'not a reader list' contradicts invite limit; note overpromises --> FIXED (53eb019f)
- [CONVENTION] plan controls: stale vs round 16 --> FIXED (53eb019f)
- [NIT] code-2 wording (dup); unknownWho untested (DEFERRED: inv=[] blocks either way); silent return after flush (DEFERRED: unreachable).

#### Iteration 18 (sonnet): 0 B, 2 W, 0 C, 3 N. Self-generated: 2
- [WARNING] engine/fedseats.js:1044: re-hold restamps the edge --> FIXED (heldEdge travels) + test (c52bcb54)
- [WARNING] engine/fedseats.js:1039: owner hold with members: no invite limit; later invitee before flush --> FIXED (members' + pending invites) + test (c52bcb54)
- [NIT] server scan (dup); reheld never reset after last (DEFERRED, only read after reset); new-post write throw (FIXED in plan Not covered).

#### Iteration 19 (opus): 0 B, 2 W, 1 C, 5 N. Self-generated: 3
- [WARNING] engine/fedseats.js:1000: refused re-hold lost silently after a promise --> FIXED (lostHeld note) + test (3d208bc4)
- [WARNING] engine/fedseats.js:1043: pendingInvites throw: promise then drop --> FIXED (refused now) + test (3d208bc4)
- [CONVENTION] plan:27: 'every re-hold goes through holdPost' / stop test --> FIXED (plan wording) (3d208bc4)

#### Iteration 20 (sonnet): 0 B, 2 W, 1 C, 3 N. Self-generated: 2
- [CONVENTION] engine/fedseats.js:1104 + test title: stale edge-check comment --> FIXED (000927a3)
- [WARNING] engine/fedseats.js:957: connected-but-unflushable seat never ages --> FIXED (age every seat) (000927a3)
- [WARNING] server.js:19415: rows scan per post (5th raise) --> DEFERRED: bounded by post rate; needed so a held post can say its file stayed

#### Iteration 21 (opus): 0 B, 2 W, 1 C(ok), 4 N. Self-generated: 2
- [WARNING] engine/fedseats.js:1105: old-key guard read once before the loop; a transient read lets one through --> FIXED (guard in sendPost) (d596fa54)
- [WARNING] engine/fedseats.js:965: comment claims flush-after-revoke for all triggers --> FIXED (narrowed) (d596fa54)
- [NIT] dead flushing branch (FIXED, marked defensive); forged-epoch drop wording (FIXED); fitsSealed 999999 (DEFERRED, <=5 bytes); server scan (dup).

#### Iteration 22 (sonnet): 0 B, 3 W, 1 C, 3 N. Self-generated: 2
- [WARNING] server.js:19411: rows scan per post (6th raise, cheap fix offered) --> FIXED (delivery fields first) (4bfc0236)
- [WARNING] engine/fedseats.js:1106: oldKey note from one read before the flush --> FIXED (counted per post) (4bfc0236)
- [WARNING] engine/fedseats.js:1042: peer with no recorded invite --> DEFERRED: unreachable, stashInvite refuses an invite with no id and every pin records it

#### Iteration 23 (opus): 0 B, 1 W, 0 C, 5 N. Self-generated: 1
- [WARNING] test 2054: flush's own hour check untested --> FIXED (test, perturbed red) (a724e99c)
- [NIT] replaced-seat identity guard untested (dup DEFERRED); oldKeySent before write (FIXED); double notes (DEFERRED, cosmetic); behind-note wording order (DEFERRED); server comment (FIXED).

#### Angel cross-review (card #5192 21:57): W1 wire exposure to connected-but-unpinned later invitee = PARITY with live posts (DEFERRED, say on card); W2 member note wording + NIT any held post behind past hold: TODO after restack.
- [NIT] sendPost behind guard: only behindHeld refused under old key --> FIXED (any held) + test (e2f6dc45)
- [WARNING] member hold note: does not say it reaches people who join later --> FIXED (wording) (e2f6dc45)
- [WARNING] owner flush wire: later invitee connected but unpinned can capture --> DEFERRED: parity with live posts

#### Iteration 24 (opus): 0 B, 1 W, 2 C, 3 N. Self-generated: 3
- [WARNING] engine/fedseats.js:1218: forged far-ahead epoch disables holding forever (drop-any from Angel NIT) --> FIXED (behindHeld only; others like live) + tests both ways (ea2b770d)
- [CONVENTION] msg.behindHeld unread: dead mark --> FIXED (read again) (ea2b770d)
- [CONVENTION] oldKeySent unreachable: dead note --> FIXED (reachable again, asserted) (ea2b770d)
- [NIT] test comment (FIXED); held refusal wording (FIXED); server scan (dup).

#### Iteration 25 (sonnet): 0 B, 4 W (3 dups), 0 C, 3 N. Processed 22:54 CDT.
- [WARNING] engine/fedseats.js HELD_POSTS_MAX: flush of 50 vs receiver 60/min shared budget --> FIXED: cap = INBOUND_PER_WINDOW/2 (30), pinned + perturbed (1f5cb02b7)
- [NIT] per-post 'no longer sealed' note (DEFERRED: one note per post is honest, counting is cosmetic); server scan (DUP); plan wording (FIXED with W2).

#### Iteration 26 (opus, after restack on 3a422d266): 0 B, 0 W, 0 C, 4 N. Converged on findings; one NIT fixed in code, so round 27 follows.
- [NIT] engine/fedseats.js heldStale: any backward clock step dropped every held post as 'over an hour' --> FIXED: tolerate < FUTURE_SKEW_MS; two-arm test, both arms perturbed red (7316ad314 (now 8848bb773))
- [NIT] owner with no live invite holds a post that can never go (DEFERRED: selfShared owner with every invite expired; dropped within the hour with a note); flushing-path re-hold ordering (DEFERRED: unreachable today, stated 'Defensive'); plan 'cap 50' (FIXED).

#### Iteration 27 (sonnet): 0 B, 3 W, 0 C, 2 N.
- [WARNING] plan Bounds: step back adds up to 5 min to the hour, unstated in the plan --> FIXED (plan) (27 commit)
- [WARNING] step test: 2 s / 6 min arms cannot catch a wrong threshold; pass unchecked --> FIXED: 4:59/5:01 arms + ageing pass asserted; both edges perturbed red (27 commit)
- [WARNING] ageHeld/flushHeld note: a clock step reported as 'held more than an hour' --> FIXED: note adds "or this computer's clock was set back" (27 commit)
- [NIT] hadFiles scan on every federated post (DEFERRED: needed at hold time; one linear scan per post); forward jump drops with a true 'hour' note (DEFERRED, true reason).

#### Iteration 28 (opus): 0 B, 2 W, 0 C, 3 N.
- [WARNING] engine/fedseats.js sendPost: post written during a behind hold but held for an unreadable record went under the OLD key after the hold --> FIXED + control; REPRODUCED by perturbation (mark removed -> 'went under the old key') (a5f228aa9)
- [WARNING] hold note / plan: drop happens at the next flush after expiry, not at expiry --> FIXED (note + plan wording; behaviour kept: a key in the gap sends under the NEW key) (a5f228aa9)
- [NIT] first flush on connect under a stale key (DEFERRED: a live post does the same; needs a missing room id + a missed rotation); room-wide minute budget across several members' flushes (DEFERRED, the general 'others share it' disclosure; per-seat cap halved); post lost silently after flush if a future say() stops the seat (DEFERRED, unreachable today).

#### Iteration 29 (sonnet): 0 B, 1 W, 0 C, 3 N. No route reaches the old key (traced).
- [WARNING] sendPost behind mark: caught-up member still marked while the hold runs --> FIXED (mark only when behind or record unreadable); caught-up arm UNTESTED (needs a missing room id), stated (29 commit)
- [NIT] in-flight re-mark at flush vs plan wording (FIXED, plan); stop() leaves keylessHeld/lostHeld/oldKeySent (DEFERRED: the seat is discarded); drops surface at the next connected flush (DISCLOSED).

#### Iteration 30 (opus): 0 B, 0 W, 0 C, 2 N. CONVERGED. 157/157; three perturbations of the narrowed mark (unreadable arm removed reds test 121; narrowing removed / undefined term removed stay green, as stated).
- [NIT] comment implied `sealed === undefined` was the unreadable arm (FIXED, prose: !hasKey covers it); plan flush re-mark claim too broad (FIXED, prose). Both after convergence, no behaviour change.
