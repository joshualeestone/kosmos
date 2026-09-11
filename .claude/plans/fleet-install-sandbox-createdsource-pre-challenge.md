---
pre_challenge: true
method: challenge-loop
branch: fleet-install-sandbox-createdsource
diff_hash: 92733eccd65afcd3527e9dd376c131f7bbf938f0da4bd1225b728e60d1299747
validation: passed
subdir_audit: passed
timestamp: 2026-09-10T21:34:08Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Fixed:** 1 | **Deferred:** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0
- [NIT] engine/status.created-roster-1078.test.js:131 -- a comment ("createdSource is null here")
  made stale by this change: fleet.install now wires setCreatedSource(() => []), so createdSource is
  a truthy empty source during that install, not null (the assertion still holds) --> FIXED (d0c35c3a):
  corrected the comment to describe the actual state.
- Five STRENGTHs: () => [] is the correct empty value (can't throw/mis-shape); placement is hermetic
  (before the fixture's own snapshot()); restore() nulling createdSource is safe (the only other
  setCreatedSource caller manages its own seam in a finally before restore); completeness is right
  (paneSource/paneCapture/createdSource all sandboxed, sessionSource correctly NOT -- it is not
  consumed by snapshot()); the 7->1 reproduction is supported by the code.

#### Iteration 2
**Reviewer model:** sonnet (different model from iteration 1, per 6a rotation)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0
**Converged** -- no new actionable findings. The sonnet pass INDEPENDENTLY reproduced the leak (a
wired createdSource returning ['zzimported1','zzimported2'] leaks 3 agents pre-fix, 1 post-fix),
confirmed empirically that node --test isolates each file in its own subprocess (distinct PIDs, no
cross-file module-state leak, so restore()'s null is safe), confirmed () => [] is behaviorally
identical to null for every consumer, confirmed sessionSource is out of scope, and confirmed the
createdSource === null branch is still exercised by engine/status.test.js (which never wires the
seam). It also surfaced a pre-existing, env-dependent failure in tools/test-pending-entry-1455.sh
(a /var vs /private/var mktemp path quirk in that script's own harness) -- unrelated to this diff,
NOT changed by it, and verified to PASS in this worktree (all arms, exit 0); a run-env artifact.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | NIT | engine/status.created-roster-1078.test.js:131 | BRANCH | comment made stale by the fix | FIXED | d0c35c3a |

### Outstanding questions (ASKED)
None.

### NITs
- engine/status.created-roster-1078.test.js:131 (iteration 1) -- FIXED in d0c35c3a.

### Strengths (across all iterations)
- Correctly identifies and closes the real gap: install()/blind/unreadable/refuses sandbox
  setCreatedSource, restore() nulls it; independently reproduced 7->1 (opus) and 3->1 (sonnet).
- () => [] is the correct, non-throwing empty value; placement before snapshot() is hermetic.
- restore() nulling createdSource is safe (node --test per-file isolation; the only other caller
  self-manages its seam).
- Completeness is right: sessionSource correctly excluded (not consumed by snapshot); no other
  fleet.js entry point sets pane seams without the created seam.
- Full node suite 5808/5808 with the fix; the previously-failing engine/heartbeat.test.js passes.

### Validation note
6j final validation flaked once on the known-slow codex-report-bridge.test.js (#1968, ~6s, a
process-spawning test that flakes under a busy fleet box's baseline load), then passed clean on
re-run (hash 92733eccd65a). Not related to this diff (which does not touch codex-report-bridge).
