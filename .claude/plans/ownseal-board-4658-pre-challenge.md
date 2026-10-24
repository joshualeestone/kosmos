---
pre_challenge: true
method: challenge-loop
branch: ownseal-board-4658
diff_hash: a3cc1c83de34374eb2b40e384218d4db72e74d47746f399b08dcdb80c659fbd7
validation: passed (Mortals full suite, entry 2026-10-24T08:58:40Z, same hash)
subdir_audit: passed (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-10-24T09:07:14Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10
**Converged:** Yes (iteration 10: no new BLOCKER, WARNING or CONVENTION after deduplication; no ASKED findings)
**Total findings (new, across iterations):** 1 BLOCKER, 27 WARNINGs, 2 CONVENTIONs, about 15 NITs
**Fixed:** 1 BLOCKER, 21 WARNINGs, 2 CONVENTIONs | **Deferred:** 6 WARNINGs (reasons below) | **Asked:** 0

Origin / Self-generated: the 6c-bis blame lookup was NOT run per finding in this loop, so neither field is
recorded here, rather than filled in by judgement. Observed by reading: four findings (iterations 6 and 9) were
defects in this loop's own earlier fixes (code, fixed normally); one prose claim written by the loop
("cannot grind", iteration 3) was deleted, not rewritten.

Reviewer models alternated: opus on odd iterations, sonnet on even (Agent tool model override).
Mutation controls: about 40 run across the loop, every one red except the HKDF purpose label, which stays green
because the associated data alone separates the frames (stated in the tests).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 5 WARNINGs, 2 NITs
**Self-generated:** not measured
- [BLOCKER] engine/fedseats.js onKeyFrame / fedseal.js openOwnShare: nothing authenticated key-own-share, so a coordinator could choose the room key the new computer adopted and read its posts --> FIXED (e7cb43ff, df685e57): redesign as a two-way numeric comparison with a commitment (card comment 6381388572)
- [WARNING] engine/fedseal.js compareCode: all inputs public before any Allow, so a matching key could be ground offline --> FIXED (e7cb43ff): hello commits to nW, owner nonce nO, reveal; code covers both keys and nonces
- [WARNING] engine/fedseats.js: an own computer posts in the clear until it first sees a sealed message --> DEFERRED: unreachable while the two 409s stand; hard requirement for part B in the plan
- [WARNING] engine/fedseats.js noteOwnSealed: one forged envelope locks an unsealed own room --> DEFERRED to kosmos#7028 (only our server or the owner's own computers can inject there; must land before the 409s lift)
- [WARNING] engine/fedseats.js: a pinned own computer under a new mac id is stuck; no removal from st.own --> mac part FIXED (e7cb43ff); removal DEFERRED to kosmos#7028
- [WARNING] server.js own-allow: the code check is only as strong as the UI --> DEFERRED as a part-B UI requirement (plan)
- [NIT] macId call unguarded --> FIXED (myMacId); [NIT] export order

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 7 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** not measured
- [WARNING] any guest could take part in the own exchange --> FIXED (87d50ec0): same_account stamp required; guest keys refused
- [WARNING] waiting-list eviction by flooding --> DEFERRED: with the stamp required, only the owner's own computers or our relay can flood (relay DoS is out of scope; it can drop traffic)
- [WARNING] a stalled exchange never recovered (dropped reveal, owner restart) --> FIXED (87d50ec0): same offer re-sends the reveal; a different offer starts a new run; the claiming comment replaced
- [WARNING] allowOwn reported success when the share was not sent --> FIXED (87d50ec0)
- [WARNING] a reveal stopped at the first entry it opened --> FIXED (87d50ec0)
- [WARNING] st.own had two shapes --> FIXED (87d50ec0): member flag ownComputer
- [WARNING] follow-up card should exist --> resolved by kosmos#7028 (plan cites it, e5750e3d)
- [CONVENTION] new record fields undocumented --> FIXED (87d50ec0, fedseal.js rooms comment)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 4 NITs (1 WARNING duplicate of #7028)
**Self-generated:** not measured
- [WARNING] a confirmed run whose share never came was stuck --> FIXED (43a4b2a2)
- [WARNING] "cannot grind" over-claimed --> FIXED (43a4b2a2): claim deleted
- [WARNING] with all guests revoked, own computers lost the old key's grace --> FIXED (43a4b2a2): graceAfter and revokeCheck count st.own
- [CONVENTION] GET own-code collided with POST own-code --> FIXED (43a4b2a2): renamed own-compare
- [NIT] two inaccurate comments, allowOwn guest re-check --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 3 NITs (3 WARNINGs duplicates of deferred entries)
**Self-generated:** not measured
- [WARNING] a forged first offer can loop resets --> DEFERRED: relay denial of service, documented in waitingOffer
- [NIT] plan named GET own-code --> FIXED (ff4372ae)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 3 NITs (1 WARNING duplicate)
**Self-generated:** not measured
- [WARNING] a rotation between Allow and confirm was dropped and held posts went out under the retired key --> FIXED (3ace5049)
- [WARNING] all-guests-revoked grace relies on the relay's member stamp --> DEFERRED: stated residual in the plan; the stamp is already the only per-post refusal when guests remain
- [NIT] a contradicting test name; UI must tell rows apart --> FIXED / plan

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 1 NIT (4 WARNINGs duplicates)
**Self-generated:** not measured (a defect in iteration 5's fix)
- [WARNING] junk rotations could push out the genuine one kept for adoption --> FIXED (7057c270)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 5 NITs (1 WARNING duplicate)
**Self-generated:** not measured
- [WARNING] "one guess per run" ignored free abandoned runs --> FIXED (483125bf): OWN_RUNS_PER_HOUR on both sides
- [WARNING] the owner's own key could be listed --> FIXED (483125bf)
- [WARNING] a confirmed run reset silently --> FIXED (483125bf)
- [WARNING] no route test reached a 200 --> FIXED (483125bf)
- [NIT] guest advice to an own computer; no-id note --> FIXED

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 2 NITs (2 WARNINGs duplicates)
**Self-generated:** not measured
- [WARNING] the hourly restart limit froze the code silently --> FIXED (58326152)
- [WARNING] rotations kept before adoption unbounded --> FIXED (58326152)
- budget burn --> stated residual (plan)

#### Iteration 9
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 3 NITs
**Self-generated:** not measured (one defect in iteration 5's fix)
- [WARNING] replay flushed held posts after each epoch, so they went out under a middle key --> FIXED (45e1ab0f)
- [WARNING] an offer did not name the hello it answered --> FIXED (45e1ab0f): offers and reveals carry the waiting key
- [WARNING] a repeated key with a fresh commitment wipes a revealed row --> DEFERRED: stated residual (keeping the row would block the computer's own genuine new run)

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs (4 WARNINGs, all duplicates of deferred entries)
**Self-generated:** not measured
**Converged** — no new actionable findings.

### Outstanding questions
None.

### NITs left for part B
- [NIT] engine/fedseats.js waitingOffer: the doc comment says a different offer ends an unconfirmed run; the code also ends a confirmed one with no share (iteration 10)
- [NIT] engine/fedseal.js: the guess-count sentence runs past the block's width, and ownStartOver (a person's press) is not counted (iteration 10)
- [NIT] engine/fedseats.js ownerOwnReveal: the pub argument to checkOwnReveal is the frame's own; the binding is the map lookup (iteration 10)
- [NIT] noteOwnSealed runs outside sealStep (iteration 3); adoptOwnShare's failure leaves only a re-press (iteration 9); hellos repeat each ensureAll pass (iteration 5)

### Strengths (across all iterations)
- The commit-then-reveal comparison held against a man in the middle in every round from 2 on
- ownShareFrame refuses unless the confirmed code is that run's, closing the display-to-press gap
- Own computers kept in st.own, so guest-only readers are untouched; the #5191 writer guard re-decided explicitly
- Attack-shaped tests: the coordinator picking the key, relabelled forgeries, copied commitments, junk rotations, missing stamps
