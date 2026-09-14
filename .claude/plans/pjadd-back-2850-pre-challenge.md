---
pre_challenge: true
method: challenge-loop
branch: pjadd-back-2850
diff_hash: 01d52d194c875c1ac45ce1e7c0c072f0c21cbbda6d1fbad07a12da5efa9250ee
validation: passed
subdir_audit: passed
timestamp: 2026-09-12T15:11:34Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Yes
**Total findings:** 2 (0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 1 NIT)
**Fixed:** 0 | **Deferred:** 1 | **Asked (awaiting user):** 0

The change is a single layout-scoped CSS rule plus a new hermetic browser-check and
its registration. Initial validation (6.0) ran the full pre-PR sequence and the
subdir-CLAUDE.md audit clean (VALIDATION_EXIT=0, AUDIT_EXIT=0). The first blind pass
found no actionable issues; its one CONVENTION was deferred as established repo
practice, so the loop converged on iteration 1. No code changed during the loop, so
the 6.0 validation doubles as the 6j final gate against current HEAD (green).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 1 NIT
**Self-generated:** 0 of the above (ITER_COMMITS empty on the first reviewer pass, and 6.0 passed so no pre-review commit exists)
- [CONVENTION] .claude/plans/pjadd-back-2850.md -- plan filename omits the `-<timestamp>` suffix --> DEFERRED: the repo's own plans overwhelmingly omit the timestamp, so this is established common practice, not a fresh deviation; the pre-challenge-gate requires only a plan file distinct from the proof, which exists.
- [NIT] .claude/plans/pjadd-back-2850.md -- the EXPECTED_SITES rationale could note that the per-problem FAIL loop is counted only because `console.error('  FAIL  ' + p)` sits on one line (helps whoever updates the constant next). Non-blocking.

**Converged** -- no new actionable findings after deduplication and deferral.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | CONVENTION | .claude/plans/pjadd-back-2850.md | BRANCH | Plan filename omits the timestamp suffix | DEFERRED | Established repo practice; gate needs only a distinct plan file, which exists |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] .claude/plans/pjadd-back-2850.md -- EXPECTED_SITES rationale could note the single-line FAIL loop detail (iteration 1).

### Strengths (across all iterations)
- CSS selector correctly scoped so only the consolidated layout is affected; the tab view keeps its back button (verified live by the browser-check) (iteration 1).
- `visibility: hidden` is the correct primitive for "remove the control, keep the space": box still reserves height, no other rule fights it, heading does not shift (iteration 1).
- The new browser-check drives the real `openAddProject`/`showTab` in both layouts against the shipped page (not a stub), asserts both positive and negative cases, and was independently re-run to 9/9 by the reviewer (iteration 1).
- The two emit-count constants were traced line-by-line and confirmed by running the actual registry tests, not taken on faith (iteration 1).
- No em dashes anywhere in the new or changed content (iteration 1).
