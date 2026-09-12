---
pre_challenge: true
method: challenge-loop
branch: 2848-subproject-header
diff_hash: 3072cdb0eed8b9a06c8519b8f05efe04c8b0c73a0d0eb8907c35ee9fea820f32
validation: passed
subdir_audit: passed
timestamp: 2026-09-12T00:42:59Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 3 (0 BLOCKERs, 1 WARNING, 1 CONVENTION, 1 NIT)
**Fixed:** 2 | **Deferred:** 1 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 1 NIT
**Self-generated:** 0 of the above (ITER_COMMITS was empty; 6.0 passed, so this is the first reviewer pass)
- [WARNING] docs/browser-checks/render-subprojects-1994.js:224 -- Layer 1e drives placeSubProjects() directly and never through showTab, so the shipped wiring (the placeSubProjects(cons) call in showTab) is uncovered; a deleted call line would leave every direct-call assertion green. --> FIXED (commit 8f4905fa: added Layer 4, which drives showTab itself and asserts the strip lands in .pjmid under consolidated and is restored to #pj-one-view under the tab layout; proven red-capable)
- [CONVENTION] .claude/plans/2848-subproject-header.md:1 -- branch/plan name uses the issue number as a prefix; the repo idiom (e.g. disconnect-stop-2570, autohello-2686) uses a suffix. --> DEFERRED: cosmetic; the <branch>.md hook requirement is satisfied by the current name, and renaming mid-flow (branch + plan file + proof file + worktree dir + night-shift claim) risks breaking the gate for zero functional benefit.
- [NIT] docs/browser-checks/render-subprojects-1994.js:250 -- the "still lists its sub-project" assertion is content-only (not a placement guard), so the plan's "reddens exactly the six consolidated assertions" prose overstated which assertions redden. --> FIXED (commit 8f4905fa: tightened the plan prose to name the placement assertions precisely and note the content-sanity assertion + both controls stay green)

#### Iteration 2
**Reviewer model:** sonnet (a different model from iteration 1, per 6a)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings (confirmed resolved):** 0
**Converged** -- no new actionable findings. The sonnet pass independently verified the :has() specificity math, the delegate-preservation on the DOM move, and the wiring layer, and found nothing.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | docs/browser-checks/render-subprojects-1994.js:224 | BRANCH | Wiring uncovered: placeSubProjects tested directly, not via showTab | FIXED | 8f4905fa (Layer 4) |
| 2 | 1 | CONVENTION | .claude/plans/2848-subproject-header.md:1 | BRANCH | Branch name uses issue-number prefix vs the repo's suffix idiom | DEFERRED | Cosmetic; hook satisfied, renaming mid-flow costly |
| 3 | 1 | NIT | docs/browser-checks/render-subprojects-1994.js:250 | BRANCH | Proof prose overstated which assertions redden | FIXED | 8f4905fa (plan prose) |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] docs/browser-checks/render-subprojects-1994.js:250 -- content-only assertion is not a placement guard (iteration 1) --> addressed by tightening the plan prose.

### Strengths (across all iterations)
- The DOM move preserves the click delegate (bound directly to #pj-one-subprojects) and every consumer looks the element up by id, so no lookup breaks (iterations 1, 2).
- placeSubProjects is idempotent in both directions and keyed on the same cons flag that toggles body.consolidated, so DOM placement and the consolidated CSS never desync (iterations 1, 2).
- The :has() CSS is correctly scoped and conditional; a leaf-project control proves it cannot affect a project without sub-projects (iterations 1, 2).
- Tight scope discipline: consolidated view only, tab view provably restored by the control assertions (iterations 1, 2).
- No em dashes in any authored prose (iterations 1, 2).
