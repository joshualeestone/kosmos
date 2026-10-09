---
pre_challenge: true
method: challenge-loop
branch: poolshown-5713
diff_hash: 40bb5e24ae68e9b84bd01dcaf17f25bdc74354afdf4761ae4f5e00a09e5c2e8f
validation: passed (rebased on origin/main after #5711 (PR #5728) merged; tools.whats-new-pool-sync-5713 (13), tools.whats-new-pool-5711, tools.release-gate (incl. the two new 1b-ii arms), plus the brand, name, fixture-discipline, 4796 sandbox and Windows guards: 152 tests, 0 fail; bash -n tools/release.sh and node --check tools/whats-new-pool.js clean; each review fix red by mutation)
subdir_audit: passed
timestamp: 2026-10-09T23:32:53Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (opus, sonnet, opus, sonnet; each blind)
**Converged:** Yes (iteration 4: nothing above NIT)
**Total findings:** 0 BLOCKERs, about 10 WARNINGs, about 12 NITs
**Fixed:** every WARNING | **Asked (awaiting user):** 0

The change (kosmos#5713): the What's New pool records what Mac prod has shown without a hand step. `build` first reads
prod's pointer and, when it is newer than the pool's lastProd, its manifest's app.commit, then marks that version's
highlights shown at that commit. `prod-check` (pointer only) runs at the cut's 1b-ii and refuses when prod is newer
than the pool records. `shown --promoted --none` records a prod version with no What's New.

### Per-Iteration Breakdown

#### Iteration 1 (opus)
- [WARNING] usage errors after the sync had already written --> FIXED (usage checked first).
- [WARNING] a refusal after the sync left a modified pool unexplained --> FIXED (says to commit the pool).
- [WARNING] a skipped prod version went unnoted --> FIXED. [WARNING] nothing at the cut checked the pool against prod --> FIXED (prod-check in 1b-ii).

#### Iteration 2 (sonnet)
- [WARNING] a prod version with no What's New could never be recorded --> FIXED (shown --none).
- [WARNING] the cut went on with a broken pool or tool --> FIXED (refuses on 1 and 2, notes on 4).
- [WARNING] the cut sandbox had no prod pointer --> FIXED. [NIT] the note ignored its env --> FIXED.

#### Iteration 3 (opus)
- [WARNING] prod-check fetched the manifest when the pointer alone answers --> FIXED (pointer only).
- [WARNING] also-files were not counted; a dirty build could record --> FIXED (counted; a dirty build is refused).
- [WARNING] flags accepted by every command --> FIXED (per command). [NIT] cut arms for prod newer and unreadable --> ADDED. [NIT] shallow clone --> skip with a note.

#### Iteration 4 (sonnet)
- Nothing above NIT. Converged.
