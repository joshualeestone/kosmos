---
pre_challenge: true
method: challenge-loop
branch: ownsealjoin-4658
diff_hash: 449b3c09aff8448ff0f0add1c2f7c1d84c6091ffdb9ce950c272ee60b205280f
validation: passed (Mortals)
subdir_audit: passed
timestamp: 2026-10-25T08:56:37Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** Yes (iteration 8: its four WARNINGs read against the code and deferred with reasons; nothing else new)
**Total findings:** 24 actionable (0 BLOCKERs, 22 WARNINGs, 0 CONVENTIONs, 2 final-validation BLOCKER-class) plus NITs
**Fixed:** 18 | **Deferred:** 6 | **Asked (awaiting user):** 0

Validation: full yarn test on Mortals at 84c6b58114 (hash 449b3c09aff8), status clean: 23889 tests, 23555 pass, 0 fail
(the rest skipped). The run before it (ea13fe2f07) failed one test, the #5191 key-state writer guard, which names every
writer of a room's key state and did not yet name sayHello's write-back: added with its reason (84c6b58114). 6j:
skipped on that clean entry, worktree clean. Subdir audit clean. Mutants, each committed first and restored with
git checkout: 15 in all (join writes no record; sealed room makes v1; no sealedOwn exception; self ignores its record;
no key rule; no downgrade guard; sealedOwn on an already-shared room; fedseats self clause; owner sealedOwn in
ownCodeSealed; self link sealed in ownCodeSealed; join drops link sealed; owner marks in isSealedRoom; no
markOwnerSealed; no write-back note; no write-back): every one red.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, NITs
**Self-generated:** 0
- [WARNING] engine/federation.js ownCodeSealed — an owner with an invite out but no guest yet has no key, so a v2 joiner could never be let in --> FIXED (f25d548ced: only a computer holding the room key makes a v2 code; 'sealed-waiting' / 'sealed-not-in')
- [WARNING] engine/federation-owncode-4649.test.js — the "older Kosmos refuses v2" test restated the old parser and could not fail --> FIXED (removed; the plan says what an older Kosmos actually does)
- [NIT] comments overstated "never in the clear"; invite comment; plan decision 5 text; join note wording --> taken (f25d548ced)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, NITs
**Self-generated:** 0
- [WARNING] engine/federation.js — a v2 code can be altered to v1 (unauthenticated) --> FIXED (4be68cbb2a: stated under NOT CLAIMED; the same exposure as main)
- [WARNING] no own code for a sealed room until a guest joins --> FIXED (named as a known gap)
- [WARNING] .claude/plans weakest premise (a dropped sealedOwn) --> FIXED (stated: fails closed)
- [NIT] sealedOwn in the schema comment; self record must be ownComputer --> taken

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, NITs
**Self-generated:** 2 (iteration 1's comment and test)
- [WARNING] engine/federation-owncode-4649.test.js — the sealedOwn test returned early through the new refusal --> FIXED (f2623c158a: a key, and the v2 code asserted)
- [WARNING] engine/federation.js — the comment claimed the code-maker's key guarantees the joiner can be let in (only the owner can) --> FIXED (claim deleted)
- [WARNING] engine/federation.js verify — a later v1 verify for the same room replaced a sealed snapshot --> FIXED (f2623c158a: never downgraded; tested; mutant red)
- [NIT] waiting sentence; split the dense line --> taken

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, NITs
**Self-generated:** 1 (iteration 3's guard)
- [WARNING] engine/federation.js verify — the sealed-snapshot guard read before the await (race) --> FIXED (87a72a3006: read after the await, unexpired only)
- [WARNING] the plan did not state what a downgraded join reaches now that a sealedOwn room may have guests --> FIXED (stated: nobody shows it; the relay can read it)
- [WARNING] server.js — the owner's note chose its text from a second read --> FIXED (the note follows the code made)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, NITs
**Self-generated:** 0
- [WARNING] engine/federation.js ownCodeSealed — a lost seal file read as never sealed, so a v1 code could be made for a sealedOwn room --> FIXED (ad9d0965de: owner sealedOwn and self link sealed count; isSealedRoom honours the self link)
- [WARNING] plan — an older-build own computer still makes v1 codes for a sealed room --> FIXED (named under NOT CLAIMED and the weakest premise)
- [NIT] the test list claimed tests that do not exist; 'sealed-not-in' wording --> taken

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, NITs
**Self-generated:** 1 (iteration 5's link clause)
- [WARNING] keep the guest-invite narrowing until slice 2 --> DEFERRED: the exposure comes from lifting 'sealed' (this slice's point; a guest-sealed room has guests before any own code); refusing further invites would not shrink it (plan, Deferred)
- [WARNING] engine/fedseats.js sayHello — a lost record held posts with nothing asked --> FIXED (ec8276050e: written back from the link at connect; mutant red)
- [WARNING] server.js — 'sealed-waiting' also fires for a lost key --> FIXED (sentence covers it)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, NITs
**Self-generated:** 1 (iteration 5's half-fix)
- [WARNING] engine/fedseats.js isSealedRoom — the owner side ignored the link's marks after a lost seal file --> FIXED (c83cbcb75a)
- [WARNING] engine/federation.js — a guest-sealed room with no own code yet had no link mark --> FIXED (c83cbcb75a: markOwnerSealed at the sealing invite)
- [WARNING] engine/fedseats.js sayHello — a failed write-back was silent --> FIXED (the ownSealUnsaved note)
- [NIT] the lost-record test could not fail without the self clause --> taken (a write-back that throws; mutant red)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs (all deferred), NITs
**Self-generated:** 0
- [WARNING] engine/federation.js invite — a race between an invite in flight and an own code --> DEFERRED: not an issue; invite re-reads selfSharedRef after the coordinator's answer with no await before stashInvite (the existing sharedNow check)
- [WARNING] the downgraded-code exposure on a beta --> DEFERRED: documented NOT CLAIMED; Kosmos is beta (Josh's merge ruling); no money or public wording; slice 2 signs codes
- [WARNING] the link marks are a one-way latch --> DEFERRED: by design; fedseal's sealedRefs is only ever set, never cleared, so the marks read exactly as the seal file does
- [WARNING] sayHello's write-back could discard a record moved aside --> DEFERRED: it writes only where roomSeal reads null (no record); fails closed; the cost is one code compare
**Converged** — no new actionable findings.

#### Final validation (6j)
- [BLOCKER] final-validation: engine/fedseats-rotation-5191.test.js writer guard (sayHello unnamed) --> FIXED (84c6b58114)

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/federation.js ownCodeSealed | BRANCH | joiner of a keyless owner never let in | FIXED | f25d548ced |
| 2 | 1 | WARNING | engine/federation-owncode-4649.test.js | SELF | vacuous older-parser test | FIXED | f25d548ced |
| 3 | 2 | WARNING | engine/federation.js parseOwnCode | BRANCH | unauthenticated code (downgrade) | FIXED | 4be68cbb2a (documented) |
| 4 | 2 | WARNING | engine/federation.js ownCodeRefusal | BRANCH | no code before a guest joins | FIXED | 4be68cbb2a (documented) |
| 5 | 2 | WARNING | .claude/plans | BRANCH | dropped sealedOwn | FIXED | 4be68cbb2a (documented) |
| 6 | 3 | WARNING | engine/federation-owncode-4649.test.js | SELF | sealedOwn test returned early | FIXED | f2623c158a |
| 7 | 3 | WARNING | engine/federation.js comment | SELF | overclaim about who lets in | FIXED | f2623c158a |
| 8 | 3 | WARNING | engine/federation.js verify | BRANCH | sealed snapshot replaced | FIXED | f2623c158a |
| 9 | 4 | WARNING | engine/federation.js verify | SELF | guard read before the await | FIXED | 87a72a3006 |
| 10 | 4 | WARNING | .claude/plans | BRANCH | downgrade reach with guests | FIXED | 87a72a3006 |
| 11 | 4 | WARNING | server.js own-code note | BRANCH | note from a second read | FIXED | 87a72a3006 |
| 12 | 5 | WARNING | engine/federation.js ownCodeSealed | BRANCH | lost seal file reads never sealed | FIXED | ad9d0965de |
| 13 | 5 | WARNING | .claude/plans | BRANCH | older-build v1 codes | FIXED | ad9d0965de |
| 14 | 6 | WARNING | engine/federation.js selfSharedRef | BRANCH | keep invite narrowing until slice 2 | DEFERRED | exposure is from decision 3 |
| 15 | 6 | WARNING | engine/fedseats.js sayHello | SELF | lost record, nothing asked | FIXED | ec8276050e |
| 16 | 6 | WARNING | server.js sealed-waiting | BRANCH | lost key not covered | FIXED | ec8276050e |
| 17 | 7 | WARNING | engine/fedseats.js isSealedRoom | SELF | owner ignores link marks | FIXED | c83cbcb75a |
| 18 | 7 | WARNING | engine/federation.js invite | BRANCH | no mark before the first own code | FIXED | c83cbcb75a |
| 19 | 7 | WARNING | engine/fedseats.js sayHello | SELF | silent failed write-back | FIXED | c83cbcb75a |
| 20 | 8 | WARNING | engine/federation.js invite | BRANCH | invite/own-code race | DEFERRED | sharedNow re-check closes it |
| 21 | 8 | WARNING | plan | BRANCH | beta exposure | DEFERRED | NOT CLAIMED; beta ruling |
| 22 | 8 | WARNING | engine/fedseats.js isSealedRoom | BRANCH | one-way latch | DEFERRED | sealedRefs never cleared |
| 23 | 8 | WARNING | engine/fedseats.js sayHello | BRANCH | moved-aside record overwritten | DEFERRED | only on null; fails closed |
| 24 | 6j | BLOCKER | engine/fedseats-rotation-5191.test.js | BRANCH | final-validation: writer guard | FIXED | 84c6b58114 |

### NITs (non-blocking, across all iterations)
- [NIT] ownCodeRefusal and ownCode read the seal state twice (iterations 4, 6)
- [NIT] roomKeyHeld duplicates fedseats' hasKey (iterations 6, 8; the pairing is named in a comment)
- [NIT] the sealed-waiting advice for a lost key (iterations 7, 8)
- [NIT] an unreadable links record still lets an invite through (main's choice; iteration 7)

### Strengths (across all iterations)
- a version bump, not a flag, makes an older Kosmos fail closed (every iteration)
- the join writes the keyless record before the seat starts and rolls back on failure; the first post is held, with a v1 control (every iteration)
- only a key holder makes a v2 code; unreadable records throw into the 500 path (iterations 3 to 8)
- the plan names its weakest premise and what it does not claim (iterations 6 to 8)
