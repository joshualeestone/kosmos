---
pre_challenge: true
method: challenge-loop
branch: machinetest-hermetic-1794
diff_hash: 39845dc92a619e9b67b92c6184fcdd17689c901aef0f09be86fca507948577d1
validation: passed
subdir_audit: passed
timestamp: 2026-09-08T15:24:42Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 (6.0 baseline passed clean, so the first blind reviewer is iteration 1)
**Converged:** Yes (iteration 1, zero BLOCKER/WARNING/CONVENTION)
**Total findings:** 1 (0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT)
**Fixed:** 0 | **Deferred:** 0 | **Asked:** 0

Change under review: test-only, 13-line additive. Sandboxes AGENT_WORKFORCE_LAUNCH around the second
machine.check() call (the `mixed` call) in engine/machine.test.js so the `labels` check reads a
controlled empty temp dir instead of the operator's real ~/Library/LaunchAgents (#1794 hermeticity).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above (ITER_COMMITS empty — no loop-fix commits; the fix under review is the branch's own commit, BRANCH origin)
**Converged** — no new actionable findings. The reviewer confirmed the mechanism (okRunner + empty
sandbox -> labelTruthCheck OK deterministically; on a clean runner without the sandbox
readdirSync(realDir) throws -> UNKNOWN -> the 2==1 failure), that the fix does not change what the
test measures, and that restore ordering is safe (mirrors the `got` block, cleans up the temp dir).
- [NIT] engine/machine.test.js:740 — PRE-EXISTING (outside this diff): the `got` block sets AGENT_WORKFORCE_LAUNCH to a mkdtemp dir but never rmSyncs it, so that first launch sandbox leaks. My new `mixed` block does clean up. Recorded for follow-up; not introduced by this change, not blocking.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | NIT | engine/machine.test.js:740 | BRANCH | pre-existing got-block launch-sandbox leak (out of this diff) | DEFERRED | Follow-up; my mixed block already cleans up; not this PR's scope |

### Outstanding questions (ASKED, still unresolved)
None.

### NITs (non-blocking)
- [NIT] engine/machine.test.js:740 — pre-existing got-block leak; follow-up, out of this diff's scope.

### Strengths (across all iterations)
- Fix is correct and genuinely hermetic: sandboxing AGENT_WORKFORCE_LAUNCH makes labelTruthCheck OK deterministically on any runner, without changing the test's asserted values.
- Restore ordering is safe (before the assertions, mirroring `got`); undefined-vs-value restore handled; temp launch dir cleaned up (more careful than the pre-existing got block).
- Conventions clean: no em dashes, comment accurately describes the seam + failure mode, naming mirrors the existing pattern, engine/machine.js untouched, matches the plan exactly.
- Verified independently before the loop: 65/65 machine.test.js on Agent1s, and proven RED->GREEN on the clean runner (fails on mortals unfixed, passes on mortals fixed).
