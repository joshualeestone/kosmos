---
pre_challenge: true
method: challenge-loop
branch: team-route-1279
diff_hash: 1a133b855c0097972ee8f5ace54b9e9b9c0bdee9163d60484a83f785f8bc2c9c
validation: passed
subdir_audit: passed
timestamp: 2026-09-06T02:55:08Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5 (fresh blind reviewer each round, model varied: Sonnet / Opus / Sonnet / Opus / Sonnet)
**Converged:** Yes (iteration 5 returned zero BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 1 BLOCKER, 6 WARNINGs, 5 NITs (1 CONVENTION confirmed-OK)
**Fixed:** 1 BLOCKER + 6 WARNINGs + 3 NITs | **Deferred:** 3 NITs + 1 WARNING (false alarm) | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1 (Sonnet)
**New findings:** 1 BLOCKER, 3 WARNINGs
- [BLOCKER] server.js - the liveness/merge block clobbered createTeam's whole-request refusal reason (cap/shape) with the "X of Y created" line whenever liveness also filtered a dead member, discarding the true reason and misreporting the accounting --> FIXED (46be8793): cap gate moved before the liveness sweep (over-cap skips the sweep, honest original count); merge/recompute gated on createTeam having produced per-member results.
- [WARNING] server.js - liveness sweep ran on the full unbounded member array before the cap check (subprocess fan-out DoS) --> FIXED (46be8793): over-cap skip bounds the sweep to <= cap.
- [WARNING] server.js - no test for the combined cap/shape + dead-member case --> FIXED (46be8793): new over-cap+dead and missing-purpose+dead tests.
- [WARNING] server.js - docblock "safe by construction" overstated (true only on an enforcing board) --> FIXED (46be8793): softened, non-enforcing-board residual named as #1946's, not new.

#### Iteration 2 (Opus)
**New findings:** 1 WARNING (+ 1 WARNING dismissed as a false alarm)
- [WARNING] server.js - OpenAI per-model validation (#2140/#2191) was in /api/agents but not the team route, so an OpenAI member with an unrunnable model is born broken (same class as the #1903 rail that WAS ported) --> FIXED (859ee6eb): ported into the per-member liveness sweep at parity; new model-validation test via openai.setFetcher.
- [WARNING] (branch scope) commit 128e24eb looked out-of-scope --> DEFERRED (verified false): it is an ancestor of origin/main (branch base); a stale-local-main artifact of `git diff main...HEAD`. My work is 4 files; the PR diff vs origin/main shows only those.
- NITs: cap field on all-dead response --> FIXED; concurrency-ceiling comment --> FIXED; parse-fail style --> DEFERRED (equivalent).

#### Iteration 3 (Sonnet)
**New findings:** 1 WARNING, 1 NIT
- [WARNING] server.js - the all-dead early-return bypassed createTeam's refusal priority (missing creator/purpose is more fundamental than "all dead") --> FIXED (4df2c686): early-return gated on shapeOk (creator+purpose present); otherwise falls through to createTeam. New all-dead+missing-purpose test.
- [NIT] server.js - single shared try vs the sibling's two try blocks (an accountConnectable crash silently skipped the model check) --> FIXED (4df2c686): split into two try blocks, byte-for-byte with the sibling.

#### Iteration 4 (Opus)
**New findings:** 1 WARNING, 2 NITs
- [WARNING] server.js - the all-dead `because` hardcoded "could not sign in", but since the iter-2 model port a member can be dead for a MODEL reason on a live account, misnaming the remedy --> FIXED (f67a7d49): neutral summary "no member could be created; see refused[]"; per-member remedy stays in refused[]. New all-dead-via-model test.
- [NIT] deps.cap operator-config unreachable over HTTP (only env override works) --> FIXED (f67a7d49): documented as deliberate for this slice.
- [NIT] shape refusal drops the filtered-dead-member detail --> DEFERRED (by design, reviewer agreed): higher-priority reason wins; recorded in the plan's "By design" section.

#### Iteration 5 (Sonnet)
**New findings:** 0 BLOCKER / 0 WARNING / 0 CONVENTION, 2 NITs
**Converged** -- reviewer: "No BLOCKER or WARNING-level issues found. After four prior challenge-loop rounds, the remaining findings are stylistic/maintenance nits rather than defects."
- [NIT] OpenAI model-validation block duplicated verbatim across the two routes (not factored to a helper) --> DEFERRED: deliberate, follows the pre-existing #1903 liveness duplication pattern across the same two routes; factoring both is a separate refactor beyond this slice.
- [NIT] shapeOk re-implements createTeam's creator/purpose priority (could drift) --> DEFERRED: current correctness verified by trace + tests; a shared priority helper is the same cross-route refactor.

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | BLOCKER | server.js | merge clobbered whole-request refusal reason | FIXED | 46be8793 |
| 2 | 1 | WARNING | server.js | unbounded liveness sweep before cap | FIXED | 46be8793 |
| 3 | 1 | WARNING | server.js | combined cap/shape + dead-member uncovered | FIXED | 46be8793 |
| 4 | 1 | WARNING | server.js | docblock auth "safe by construction" overstated | FIXED | 46be8793 |
| 5 | 2 | WARNING | server.js | OpenAI per-model validation not ported | FIXED | 859ee6eb |
| 6 | 2 | WARNING | (scope) | 128e24eb looked out-of-scope | DEFERRED | false alarm (stale local main); verified ancestor of origin/main |
| 7 | 2 | NIT | server.js | all-dead response missing cap field | FIXED | 859ee6eb |
| 8 | 2 | NIT | server.js | concurrency ceiling uncommented | FIXED | 859ee6eb |
| 9 | 2 | NIT | server.js | parse-fail style inline vs throw/catch | DEFERRED | equivalent outcome |
| 10 | 3 | WARNING | server.js | all-dead early-return bypassed refusal priority | FIXED | 4df2c686 |
| 11 | 3 | NIT | server.js | single try vs sibling's two | FIXED | 4df2c686 |
| 12 | 4 | WARNING | server.js | all-dead because misnamed model deaths | FIXED | f67a7d49 |
| 13 | 4 | NIT | server.js | deps.cap unreachable over HTTP | FIXED (documented) | f67a7d49 |
| 14 | 4 | NIT | server.js | shape refusal drops liveness detail | DEFERRED | by design (refusal priority) |
| 15 | 5 | NIT | server.js | model-validation duplicated across routes | DEFERRED | deliberate, matches existing #1903 pattern |
| 16 | 5 | NIT | server.js | shapeOk re-implements createTeam priority | DEFERRED | verified correct; shared helper is a separate refactor |

### CONVENTION (confirmed OK)
- Iteration 1's plan-file check + later iterations confirmed the plan (.claude/plans/team-route-1279.md) exists and agrees with the code (default cap 12, MAX 50, 400/200 split, deferred project-attach/home-seed, OpenAI model port).

### NITs (deferred, non-blocking)
- Model-validation and shapeOk duplication across /api/team and /api/agents (iter 5): a shared-helper refactor spanning both routes, out of this slice.
- Shape refusal drops filtered-dead-member detail (iter 4): by design, refusal priority.
- Parse-fail style inline vs throw/catch (iter 2): equivalent.

### Strengths (across all iterations)
- Cap gate before the liveness sweep: bounds subprocess fan-out AND keeps the over-cap refusal honest on the original count; reads the effective cap from createTeam's own resolveCap so route and engine cannot drift.
- The wholeRequestRefusal merge-guard correctly distinguishes a per-member run from createTeam's refuseAll, preserving the true reason and the correct outcome/HTTP-code across every traced combination.
- Provenance cannot be forged by a member (asserted by test); auth posture correctly scoped and honestly documented (board-token gate inherited, non-enforcing-board residual named as pre-existing).
- 14 non-vacuous tests through the real HTTP route, binding to birth-record content and per-member because text, with negative assertions guarding the merge-guard priority.
