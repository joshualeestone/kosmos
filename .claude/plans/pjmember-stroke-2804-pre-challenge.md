---
pre_challenge: true
method: challenge-loop
branch: pjmember-stroke-2804
diff_hash: 79351783b66d6db1170dc482b65980002b778f470032e4637e4d0edd7d3d9f99
validation: passed
subdir_audit: passed
timestamp: 2026-09-11T18:10:21Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (blind, model-varied: opus, sonnet, opus, sonnet)
**Converged:** Yes (iteration 4 returned zero NEW BLOCKER/WARNING/CONVENTION, witnessed by both models)
**Total findings:** 1 WARNING, 4 NITs (plus 1 positive CONVENTION confirmation), many STRENGTHs
**Fixed:** 1 WARNING + 3 NITs | **Deferred:** 1 NIT (pre-existing, out of scope) | **Asked:** 0

Change under review: remove the 1px stroke on the three washed MEMBERS states
(`#pj-one-agents .pj-member.pjm-working|attn|idle`) via `border-color: transparent`, so
idle/working/needs-help are conveyed by colour alone (#2804). CSS-only, plus one unit test.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 actionable CONVENTIONs, 1 NIT
**Self-generated:** 0 (nothing had committed yet, ITER_COMMITS empty)
- [NIT] .claude/plans/pjmember-stroke-2804.md - plan prose used em dashes --> FIXED (6b420de)
- [CONVENTION] .claude/plans/ - plan file found and implementation matches (positive confirmation, no action)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs
**Self-generated:** 0 (the finding is about server.test.js written in the base branch commit, Origin BRANCH)
- [WARNING] server.test.js - the over-application control only guarded the base-stroke rule text; a state-unqualified `#pj-one-agents .pj-member { border-color: transparent }` (the exact over-application the plan warns against) would strip present-but-neutral members and pass every assertion --> FIXED (a7ecd0bf): added a `doesNotMatch` guard.

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 (the guard-form NIT is about the guard added in iteration 2's fix, Origin SELF; fixed as a test-completeness improvement, no prose-claim deletion involved)
- [NIT] web/index.html comment cited `#33408`, a fragile line-number reference --> FIXED (a59a2536 + 48d4d58c): cite the `.pj-member.unseen` rule instead, in the comment, plan, and test.
- [NIT] server.test.js over-application guard only caught the `transparent` form --> FIXED (a59a2536): broadened to any `border` property on the unqualified selector (catches border:0/none/width:0 too), prove-failed on the `border: 0` form.

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0
**Converged** - no new actionable findings; the one NIT is pre-existing and out of scope (below).
- [NIT] web/index.html:3907 - the pre-existing consolidated-layout rule `body.consolidated .pj-member { border: 0 }` already drops all member borders in that layout, so the "neutral keeps its outline / unseen keeps its dashed border" invariant holds in the tab view only. DEFERRED: not a regression from this diff, and the change is about the tab-view MEMBERS panel Josh's images show. Worth a note if a consolidated-layout review surfaces it.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | NIT | .claude/plans/pjmember-stroke-2804.md | BRANCH | em dashes in plan prose | FIXED | 6b420de |
| 2 | 2 | WARNING | server.test.js | BRANCH | over-application control incomplete (state-unqualified transparent rule) | FIXED | a7ecd0bf |
| 3 | 3 | NIT | web/index.html comment | BRANCH | fragile `#33408` line-number citation | FIXED | a59a2536, 48d4d58c |
| 4 | 3 | NIT | server.test.js | SELF | over-application guard only caught the transparent form | FIXED | a59a2536 |
| 5 | 4 | NIT | web/index.html:3907 | BRANCH | consolidated layout already drops all member borders (invariant is tab-view only) | DEFERRED | pre-existing, out of scope |

### Outstanding questions (ASKED)
None.

### NITs (non-blocking)
- Consolidated-layout border invariant is layout-conditional (iteration 4) - deferred as pre-existing.

### Strengths (across all iterations)
- `border-color: transparent` (not `border: 0`) preserves box geometry and fills edge to edge via `background-clip: border-box`; id-anchored specificity wins over the base and consolidated rules regardless of source order (iterations 1, 2, 3, 4).
- Scoping verified correct end-to-end against the pjMember builder: pjm-* and unseen are mutually exclusive, so the rule never touches an unseen member; present-but-neutral members and the settings/add-agent surfaces keep their base stroke (iterations 1, 2, 3, 4).
- The test asserts both halves of the deletion (stroke gone on the three states; base stroke and unseen dashed border survive) plus a generic guard against any future state-unqualified border removal (iterations 1, 3, 4).
- Browser-check and Browser-check-surface trailers present and accurate; no em dashes anywhere in the shipped output (iterations 2, 4).
