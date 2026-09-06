---
pre_challenge: true
method: challenge-loop
branch: team-agent-token-1279
diff_hash: d8ed0c242548d04420f9fc4bf2f95d92b12ce7b64e0795977bf5cf6ae39f8721
validation: passed
subdir_audit: passed
timestamp: 2026-09-06T06:16:32Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (fresh blind reviewer each round, model alternated Sonnet / Opus)
**Converged:** Yes (iteration 8 returned zero BLOCKER/WARNING/CONVENTION findings; "the branch reads as converged")
**Total findings:** 3 BLOCKERs, 8 WARNINGs, 7 NITs (all in this security-sensitive slice; the count logic alone produced all 3 BLOCKERs)
**Fixed:** 3 BLOCKERs + 8 WARNINGs + 6 NITs | **Deferred:** 1 NIT (out-of-scope isRemoved hardening) | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1 (Sonnet)
**New findings:** 1 BLOCKER
- [BLOCKER] server.js activeAgentsCreatedBy/handler -- TOCTOU race: the cap read and the birth-writing create were separated by the async liveness sweep, so two concurrent same-creator requests each read a stale count and both passed --> FIXED (f033dcbd): enforce the cap ATOMICALLY with the create under a per-creator lock (withCreatorLock); AND the deeper roster-lag bug it surfaced (count keyed on the live roster, blind to a just-created agent) --> re-based the count on birth-MINUS-removed.

#### Iteration 2 (Opus)
**New findings:** 3 WARNINGs
- [WARNING] the concurrency test was vacuous as a lock proof (createTeam is synchronous, so the critical section is already atomic) --> FIXED (e5347bc4): exported withCreatorLock and added direct unit tests with a YIELDING fn; relabelled the route test as proving the OUTCOME.
- [WARNING] the lock's comments overstated a live race --> FIXED: reworded as forward-protection (today's atomicity is the adjacent sync check+create).
- [WARNING] denyPaneFallback on the agent path was inert and its comment misdescribed the mechanism --> FIXED: dropped the inert option; the no-credential refusal is the operator branch's board-token 403.
- [NIT] cleanName the gone set --> FIXED (superseded by the iter-4 slugFor fix).

#### Iteration 3 (Sonnet)
**New findings:** 1 BLOCKER
- [BLOCKER] activeAgentsCreatedBy deduped by FIRST occurrence, so a name removed and recreated by another creator kept counting the ORIGINAL creator and never the new owner --> FIXED (c58935fc): last-occurrence-wins (newest 'created' birth per name owns it). New reused-name tests.
- [CONVENTION/NITs] roster-unreadable 503 vs report/reply's 200 (kept 503 as retryable, documented); hasBoardToken moved to the operator branch; added the branch plan file.

#### Iteration 4 (Opus)
**New findings:** 1 BLOCKER
- [BLOCKER] the count normalized with cleanName (trim only), but the birth log stores the name AS TYPED while removedAgents stores the SLUG -- so a removed agent with a capital/space name (#740) was never excluded and consumed a cap slot forever (over-refuse) --> FIXED (26858e45): normalize BOTH sides with create.slugFor. New capital-name regression test + fixed the headroom test that masked it.

#### Iteration 5 (Sonnet)
**New findings:** 2 WARNINGs
- [WARNING] the cap is a COOPERATIVE-agent boundary, not adversarial (a compromised agent with the board token reaches the exempt operator branch, same as the already-uncapped /api/agents) --> FIXED (32202f21): documented honestly in the plan's "What the cap IS and IS NOT" + a scope note at the enforcement site.
- [WARNING] the safeRoster()===null -> 503 branch was untested --> FIXED: added a 503 test (forcing it via status.setPaneSource throwing).
- [NITs] trim the cap-refusal creator; corrected the "removedAgents stores the slug" comment (it stores cleanName); the slug tests now seed a capital removed name.

#### Iteration 6 (Opus)
**New findings:** 1 WARNING
- [WARNING] the route HEADER docblock still attributed the no-credential refusal to denyPaneFallback (removed earlier), contradicting the corrected inline comment --> FIXED (f9e5ae11): header now names the operator-branch board-token 403.

#### Iteration 7 (Sonnet)
**New findings:** 2 WARNINGs
- [WARNING] the catch->return null fail-open guards are dead against today's readers (createdLog/removedAgents swallow errors and return []) and the comment overstated the behavior --> FIXED (44cc4e74): documented honestly (defensive vs a future throwing reader; today an unreadable birth log reads as 0 = permissive, an unreadable removed list inflates = conservative).
- [WARNING] the last-occurrence-wins note overclaimed the refuse-while-removed invariant (isRemoved compares by cleanName) --> FIXED: softened to "robust for slug-addressed removals (the normal path), not proven airtight for a non-slug removal (pre-existing, out of scope)".

#### Iteration 8 (Opus)
**New findings:** 0 BLOCKER / 0 WARNING / 0 CONVENTION, 1 NIT
**Converged** -- "No blockers, warnings, or convention violations. The branch reads as converged."
- [NIT] a comment attributed isRemoved to create.js (the refusal SITE is there; isRemoved is defined in remove.js) --> FIXED (6e66dbf5).

### Final Ledger (BLOCKERs + WARNINGs; NITs summarized above)

| # | Iter | Category | Description | Status | Resolution |
|---|------|----------|-------------|--------|------------|
| 1 | 1 | BLOCKER | TOCTOU race on the cap (+ roster-lag count basis) | FIXED | f033dcbd |
| 2 | 2 | WARNING | vacuous lock test | FIXED | e5347bc4 |
| 3 | 2 | WARNING | lock comments overstated a live race | FIXED | e5347bc4 |
| 4 | 2 | WARNING | inert denyPaneFallback + wrong comment | FIXED | e5347bc4 |
| 5 | 3 | BLOCKER | first-occurrence dedup mis-attributed a reused name | FIXED | c58935fc |
| 6 | 4 | BLOCKER | cleanName vs slug: removed capital/space names never excluded | FIXED | 26858e45 |
| 7 | 5 | WARNING | cap framed as adversarial; is cooperative-only | FIXED (doc) | 32202f21 |
| 8 | 5 | WARNING | 503 branch untested | FIXED | 32202f21 |
| 9 | 6 | WARNING | header docblock stale (denyPaneFallback) | FIXED | f9e5ae11 |
| 10 | 7 | WARNING | dead fail-open guards + overstated comment | FIXED | 44cc4e74 |
| 11 | 7 | WARNING | last-occurrence invariant overclaimed | FIXED | 44cc4e74 |

### Deferred
- [NIT] hardening create.js isRemoved to compare by slugFor (not cleanName): pre-existing code, out of this slice's scope; would at worst UNDER-count here (permissive). Named on the record.

### Strengths (consistent across rounds, verified against the actual engine code)
- Network isolation: /api/team kept out of REMOTE_AGENT_ROUTES, so remoteWriteGuard refuses every network peer even with a valid agent token; only LOOPBACK_AGENT_ROUTES exempts the board-token gate. The two decisions are decoupled.
- Un-forgeable creator: effectiveCreator = the authenticated resolveAgentSender caller, never body.creator (forgery test proves it).
- Cap count on the right basis (birth-minus-removed, slug-matched, last-occurrence-wins), atomic under a lock whose serialization is unit-tested with a yielding fn.
- Failure directions chosen safely and documented; the threat-model boundary stated honestly.
- No regression to the operator (slice-1) path; all 14 seam tests + 19 agent-token tests pass.
