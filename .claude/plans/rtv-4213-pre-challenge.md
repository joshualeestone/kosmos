---
pre_challenge: true
method: challenge-loop
branch: rtv-4213
diff_hash: 4cb6294a58fcc06b3979844dc6c18725d4f6d82c651a45c9065960e8c5e982da
validation: passed
subdir_audit: passed
timestamp: 2026-09-27T15:55:48Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes, at iteration 4. Final validation (6j) passed on 03456037c behind the heavy gate: the full
suite (10886 tests: 10723 pass, 163 skipped, 0 fail, 0 cancelled), type-check, lint, build; subdir audit rc=0.
**Total findings:** 0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, NITs below
**Fixed:** 5 | **Deferred:** 0 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0
- [WARNING] docs/browser-checks/render-tasks-view-3559.js: the third copy of #4076's root yardstick was unguarded --> FIXED (fc5b02f2a): browser-checks-gutter-yardstick.test.js generalised to N files; a one-character drift in the new copy fails it (seen)
- [WARNING] the check's labels said "window edges" while it now measures the page layout --> FIXED (fc5b02f2a): "edges of the page layout (a reserved scrollbar gutter excluded)", as #4076 worded plus-bar

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0
- [WARNING] docs/browser-checks/README.md: the row still said window edges --> FIXED (1cbe75237)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
- [WARNING] the gutter strip was described as "a separate card" that did not exist --> FIXED (03456037c): filed as #4216 for Josh's decision
- [WARNING] the pin test guarded the copied text but not its use --> FIXED (03456037c): a new test asserts w comes from root.right, no clientWidth, and rootOk is passed to chk; reverting w or dropping the chk fails it (both seen)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs
**Self-generated:** 0
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | browser-checks-gutter-yardstick.test.js | BRANCH | third yardstick copy unpinned | FIXED | fc5b02f2a |
| 2 | 1 | WARNING | docs/browser-checks/render-tasks-view-3559.js | BRANCH | "window edges" wording | FIXED | fc5b02f2a |
| 3 | 2 | WARNING | docs/browser-checks/README.md | BRANCH | README row wording | FIXED | 1cbe75237 |
| 4 | 3 | WARNING | docs/browser-checks/render-tasks-view-3559.js | BRANCH | "separate card" not filed | FIXED | 03456037c (#4216) |
| 5 | 3 | WARNING | browser-checks-gutter-yardstick.test.js | BRANCH | use of the yardstick unguarded | FIXED | 03456037c |

### Outstanding questions
None. The gutter strip's colour is a product question filed as #4216, outside this change.

### NITs (non-blocking)
- a comment on why w still holds for the tab layout's bottom read (iteration 1, added; scope fixed in iteration 3)
- a docstring line over width; an earlier commit message said "comment rewraps" while it was still 135 chars (iteration 3, fixed)

### Strengths
- #4076's measured mechanism and yardstick copied, not reinvented; the copies are pinned as text and in use.
- The narrowed claim is stated in the check's own labels and filed for decision, not hidden.

### Not proven here
This Mac draws overlay scrollbars, so the check itself has not run against a classic-scrollbar gutter. The PR's
browser-checks job on the runner is the proof; the new rootOk chk could itself go red there.
