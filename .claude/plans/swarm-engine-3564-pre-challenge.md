---
pre_challenge: true
method: challenge-loop
branch: swarm-engine-3564
diff_hash: 159d003707d004f5d87ea293307007c05a3d8ab722f2dd3f0080cc6a49e31803
validation: passed
subdir_audit: passed
timestamp: 2026-09-25T11:02:06Z
iterations: 19
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 19
**Converged:** Yes (iteration 19: no new BLOCKER, WARNING or CONVENTION after deduplication; no ASKED findings)
**Total findings, rounds 11 to 19:** 2 BLOCKERs, 20 WARNINGs, 0 CONVENTIONs, 20 NITs
**Fixed (rounds 11 to 19):** 18 | **Deferred:** 6 | **Asked (awaiting user):** 0

The loop first converged at iteration 15 (proof committed 533efb5e). Before the PR could be opened, origin/main
had moved and conflicted in engine/projects.js; it was merged (7528a833, the exports line, both sides kept) and
the loop re-run from iteration 16 on the merged code until it converged again at 19.

The session running this loop was restarted on another account after iteration 10 (02:48 CDT). The ledger for
iterations 1 to 10 did not survive the restart; their fixes are recorded in the iteration commit messages
(d3b6557b through 4b6f367e) and summarised below from those messages. Iterations 11 to 15 are recorded in full.
Before iteration 11, origin/main (56 commits ahead) was merged in (d8e64d17); two conflicts, both independent
additions, both sides kept; full suite after the merge 9,185 tests, 0 failed.

### Per-Iteration Breakdown

#### Iterations 1 to 10 (from the commit messages)
**Reviewer model:** Sonnet and Opus alternating (per the card comment of 02:12 CDT; per-iteration record lost)
**Self-generated:** not recorded
- [BLOCKER] engine/swarm.js meter: a message counted once per content-block line (2.23x overcount) --> FIXED 7c375cd6
- [WARNING] incremental reads, the limit override for the day, paused-swarm slash commands, leaving a project clears Off --> FIXED 7c375cd6, bb44805c
- [WARNING] task pages and the Assigner honour per-project Off --> FIXED 41268560
- [WARNING] the limit sweep stops helpers; the swarms flag on /api/status --> FIXED 3285c928, 98e44853
- [WARNING] measured: the stop-all chord, one Escape on the trust dialog ends a session; keysAllowed floor --> FIXED a0f4bb9c
- [WARNING] measured: chord first, then Escape; bounded chunked reads --> FIXED 293991da
- [WARNING] the room valve does not charge an Off swarm never sent the post --> FIXED 4b6f367e
- [WARNING] a post whose only recipients are Off swarms reports PLACED --> DEFERRED (3285c928): same as a post with no recipients

#### Iteration 11
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** not recorded (the blame lookup was not run after the restart)
- [WARNING] engine/messages.js:1268 - an Off swarm @-named into a post is sent it but not charged by the valve --> FIXED 7902a7d8
- [WARNING] server.test.js:497 - the card's swarm field and keys were unread and unlisted (hidden by test order) --> FIXED 7902a7d8

#### Iteration 12
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** not recorded
- [WARNING] engine/assigner.js:92 - a paused swarm reads idle and is handed tasks every tick --> FIXED af45c549
- [WARNING] engine/swarm.js:296 - the meter counts another agent's sessions in a shared flattened folder --> FIXED af45c549
- [WARNING] server.js swarm sweep - not gated on the live-execution opt-in --> FIXED af45c549
- [WARNING] engine/swarm.js - an unmeasured swarm reads as under its limit --> FIXED af45c549 (metered)
- [NIT] server.js:13415 route between a docblock and its route --> FIXED af45c549
- [NIT] server.js:15353 unused env seam --> FIXED af45c549
- [NIT] engine/chat.js:1165 constant between a docblock and deliver --> FIXED af45c549
- [NIT] engine/messages.js all-Off post returns PLACED --> same as the deferred item
- [NIT] cache reads in the limit need UI wording --> raised with the UI half on #3564

#### Iteration 13
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** not recorded (by reading, the BLOCKER sits in iteration 12's fix)
**Duplicates of prior findings:** 1 (all-Off post, DEFERRED)
- [BLOCKER] engine/swarm.js:291 - the owner cache was keyed by file, not by lead, so two leads sharing a folder read each other's answers --> FIXED b1b1dc7e
- [NIT] engine/chat.js:1212 lazy require unexplained --> FIXED b1b1dc7e
- [NIT] engine/messages.js:1463 recomputed charged --> FIXED b1b1dc7e
- [NIT] engine/swarm.js tellLead folds two cases into one reason

#### Iteration 14
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** not recorded (by reading, the first WARNING sits in iteration 12's fix)
- [WARNING] engine/swarm.js:319 - owner test run on every old session, null answers never cached --> FIXED be355335
- [WARNING] engine/swarm.js:118 - switching on with a new limit left the limit off for the day --> FIXED be355335
- [WARNING] server.js swarm/stop - a quick second press sends a second Escape --> FIXED be355335
- [WARNING] engine/swarm.js:199 - cache reads count at full weight --> DEFERRED: recorded decision; UI half asked to say so
- [NIT] status.js swarmField not lazy --> FIXED; [NIT] swarmOffIn per member --> FIXED; [NIT] key order in docs --> FIXED; [NIT] Windows sentence --> FIXED (all be355335)

#### Iteration 15
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
**Duplicates of prior findings:** 1 (all-Off post, DEFERRED)
- [NIT] server.js:14238 - the task-message route drops an Off swarm silently
- [NIT] server.test.js:500 - SWARM_CARD_UNREAD omits `active` (harmless: the page mentions the word)
**Converged** at the time; then main was merged in (7528a833) and the loop re-run.

#### Iteration 16 (on the merged code)
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** not recorded
- [WARNING] engine/swarm.js:239 - the read cap was per file, not per meter() call --> FIXED bab6861c
- [WARNING] engine/chat.js:1131 - a looking-after command could carry work in behind a newline --> FIXED bab6861c
- [WARNING] engine/chat.js:1087 - the Windows refusal in keysAllowed was untested --> FIXED bab6861c
- [WARNING] server.js swarm/stop - keys unmeasured on a permission prompt --> FIXED bab6861c (plan premise 6)

#### Iteration 17
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** not recorded
- [WARNING] engine/create.js:1575 - setProvider could move an existing swarm off Claude --> FIXED 84d143dd
- [WARNING] engine/swarm.js - several swarms catching up each read their budget in one poll --> DEFERRED: each is bounded, swarms are few (plan premise 4)

#### Iteration 18
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** not recorded (by reading, the BLOCKER sits in iteration 14's fix)
- [BLOCKER] engine/swarm.js:121 - limit raised in one request and switched on in the next still got the day's override --> FIXED 3d483429 (pausedAtLimit)
- [WARNING] engine/swarm.js:248 - a new day re-read every file from byte 0 --> FIXED 3d483429
- [WARNING] server.js task-message route - an Off swarm was dropped without a reason --> FIXED 3d483429
- [WARNING] projects.syncAgent - an Off swarm's tasks stay in its instructions --> DEFERRED: documented, plan premise 8
- [WARNING] engine/create.js - swarms on Windows cannot be stopped by keys --> DEFERRED: documented, plan premise 7
- [NIT] server.js swarm/stop - repeat guard missed the sweep's pause --> FIXED 3d483429

#### Iteration 19
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0
**Duplicates of prior findings:** 3 (`active` not listed as unread: DEFERRED, listing it trips the list's own
"drawn" check because the page already contains the word; the sweep acting on a partial count: plan premise 4;
the all-Off post)
**Converged** - no new actionable findings.

### Final Ledger (iterations 11 to 15)

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 11 | WARNING | engine/messages.js:1268 | BRANCH | @-named Off swarm uncharged by valve | FIXED | 7902a7d8 |
| 2 | 11 | WARNING | server.test.js:497 | BRANCH | swarm card keys unread, unlisted | FIXED | 7902a7d8 |
| 3 | 12 | WARNING | engine/assigner.js:92 | BRANCH | paused swarm handed tasks | FIXED | af45c549 |
| 4 | 12 | WARNING | engine/swarm.js:296 | BRANCH | meter counts another agent's sessions | FIXED | af45c549 |
| 5 | 12 | WARNING | server.js:15346 | BRANCH | sweep not live-execution gated | FIXED | af45c549 |
| 6 | 12 | WARNING | engine/swarm.js:296 | BRANCH | unmeasured swarm reads under limit | FIXED | af45c549 |
| 7 | 13 | BLOCKER | engine/swarm.js:291 | BRANCH | owner cache not keyed per lead | FIXED | b1b1dc7e |
| 8 | 14 | WARNING | engine/swarm.js:319 | BRANCH | owner test on old sessions, null uncached | FIXED | be355335 |
| 9 | 14 | WARNING | engine/swarm.js:118 | BRANCH | new limit did not hold after override | FIXED | be355335 |
| 10 | 14 | WARNING | server.js swarm/stop | BRANCH | double Escape on a quick second press | FIXED | be355335 |
| 11 | 14 | WARNING | engine/swarm.js:199 | BRANCH | cache reads in the limit | DEFERRED | recorded decision; UI wording asked |
| 12 | 5, 13, 15, 19 | WARNING | engine/messages.js:1463 | BRANCH | all-Off post returns PLACED | DEFERRED | same as an empty room; the post is recorded and caught up on @-name |
| 13 | 16 | WARNING | engine/swarm.js:239 | BRANCH | read cap per file, not per call | FIXED | bab6861c |
| 14 | 16 | WARNING | engine/chat.js:1131 | BRANCH | work behind a newline after /clear | FIXED | bab6861c |
| 15 | 16 | WARNING | engine/chat.js:1087 | BRANCH | Windows refusal untested | FIXED | bab6861c |
| 16 | 16 | WARNING | server.js swarm/stop | BRANCH | keys unmeasured on a permission prompt | FIXED | bab6861c (premise 6) |
| 17 | 17 | WARNING | engine/create.js:1575 | BRANCH | setProvider moves a swarm off Claude | FIXED | 84d143dd |
| 18 | 17 | WARNING | engine/swarm.js | BRANCH | several swarms each read their budget | DEFERRED | bounded per swarm; premise 4 |
| 19 | 18 | BLOCKER | engine/swarm.js:121 | BRANCH | two-request raise got the override | FIXED | 3d483429 |
| 20 | 18 | WARNING | engine/swarm.js:248 | BRANCH | new day re-read from byte 0 | FIXED | 3d483429 |
| 21 | 18 | WARNING | server.js task message | BRANCH | Off swarm dropped without a reason | FIXED | 3d483429 |
| 22 | 18 | WARNING | engine/projects.js | BRANCH | Off swarm's tasks in its instructions | DEFERRED | premise 8 |
| 23 | 18 | WARNING | engine/create.js | BRANCH | Windows swarm cannot be stopped by keys | DEFERRED | premise 7 |
| 24 | 15, 19 | WARNING | server.test.js:500 | BRANCH | `active` not listed as unread | DEFERRED | listing it trips the drawn check |

Origin is BRANCH throughout because the blame lookup was not run after the restart (the fail-safe value).

### NITs (non-blocking, not fixed)
- [NIT] engine/swarm.js tellLead folds "not editable" and "no file" into one default reason (iteration 13)
- [NIT] server.js:14238 task-message route drops an Off swarm silently (iteration 15)
- [NIT] server.js:2412 the limit notice is stored as the agent's own words (iterations 16, 18)
- [NIT] engine/swarm.js fileCache evicts only past 256 entries; a resumed helper reads finished until it replies (16)
- [NIT] server.js swarm routes have no screen-origin check, like many routes (18)
- [NIT] heardBy reads the project store twice; canonicalOnDisk runs twice per swarm card (17)

### Strengths (across iterations)
- Paused is enforced once, in chat.deliver, which every sender goes through (iterations 12 to 15)
- The stop keys and their order rest on dated measurements and are pinned by route-level tests (12, 14, 15)
- The meter dedupes per message id, reads incrementally in bounded chunks, and reports an incomplete read (11, 14)
- workdirBelongs is one derivation shared by byWorkdir and the meter (15)
- Every fix in rounds 11 to 18 was mutated and went RED on its own assertion
