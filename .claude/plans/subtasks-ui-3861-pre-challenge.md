---
pre_challenge: true
method: challenge-loop
branch: subtasks-ui-3861
diff_hash: eb9cb221e7c454c91a42f2d5d147c659ef88393a4b270d7a2e20384acd4eedc0
validation: passed
subdir_audit: passed
timestamp: 2026-09-26T03:21:52Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (iteration 1 is the 6.0 fix-and-validate pass; iterations 2 and 3 are blind reviews)
**Converged:** Yes
**Total findings:** 11 (1 BLOCKER, 1 WARNING, 2 synthetic validation BLOCKERs, 0 CONVENTIONs, 8 NITs)
**Fixed:** 6 (the 4 blocking findings plus 2 NITs) | **Deferred:** 1 NIT | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1 (6.0 initial validation)
**Reviewer model:** none (validation helper and full suite)
**New findings:** 2 BLOCKERs (synthetic), 0 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0 of the above (synthetic findings are BRANCH by instruction)
- [BLOCKER] initial-validation: web.tasks-cap-1193.test.js "the column is still capped at five" failed; the project column nested before the cap --> FIXED (commit 3cfb3c5): cap to five first, then nest the five
- [BLOCKER] initial-validation: web.project-page.test.js heard-sentence ordering failed; the subtask branch pushed the heard line past the 600-char window --> FIXED (commit 3cfb3c5): the task-page branch now reads the heard sentence too; window widened to 900 with a note (the pinned ordering, after the reload, is unchanged)

#### Iteration 2
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above (all cited lines were authored in the branch's first commit 8a025b9, not in a loop fix commit)
- [BLOCKER] web/index.html ntFillParents: a Part of pick carried across the dialog's project switch (both switch paths set NT_FOR first, so the old number was reselected in the new project) --> FIXED (commit 6effc24): options record the project they were built for; a pick is kept only for the same project. Browser-check arm added; measured red without the fix
- [WARNING] web/index.html ntFillParents: a cancelled "+ Add subtask" left its preset for the next plain New task --> FIXED (commit 6effc24): a preset is not part of the draft unless the person changes it; browser-check arm added, measured red without the fix
- [NIT] web/index.html chip aria-label on a plain span, and a label that dropped visible words --> FIXED (commit 6effc24): visible words via .vh, no aria-label on spans
- [NIT] web/index.html #tk-subs rebuilt every poll, taking keyboard focus --> FIXED (commit 6effc24): change-guarded
- [NIT] web/index.html tskPaint prunes fold-hidden ticks by reading the DOM --> DEFERRED: correct as written; the DOM is the exact set of rows on screen, which is what the tick rule is about

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
**Converged:** no new actionable findings.
- [NIT] plan file: top summary still says EXPECTED_SITES +2 (the Built section corrects it to +0, measured)
- [NIT] data-close-parent in TSK_FOCUS_KEYS is inert (tskCloseParent moves focus to the status line itself)
- [NIT] engine/projects.js computes tree.up(t) twice
- [NIT] tskCloseParent does not disable its button in flight (TSK.busy guards the double submit)
- [NIT] depth classes named d1/d2 on rows and sub1/sub2 on cards

### Validation note
The first 6g run after iteration 2 was red on the #2518 surface gate (render-unread-edge-3743, render-agentdm-3414 on token 'msg'; render-alltasks on 'tsk-new'). All three checks were run on the branch and pass unchanged; per-check Browser-check-surface trailers with reasons are on commit 5cc4ab4. The re-run passed: 9666 tests, 0 failures.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | web.tasks-cap-1193.test.js | BRANCH | column no longer sliced to five | FIXED | 3cfb3c5 |
| 2 | 1 | BLOCKER | web.project-page.test.js | BRANCH | heard line after reload, window | FIXED | 3cfb3c5 |
| 3 | 2 | BLOCKER | web/index.html ntFillParents | BRANCH | Part of carries across projects | FIXED | 6effc24 |
| 4 | 2 | WARNING | web/index.html ntFillParents | BRANCH | preset survives a cancel | FIXED | 6effc24 |
| 5 | 2 | NIT | web/index.html tskRow chip | BRANCH | aria-label on span | FIXED | 6effc24 |
| 6 | 2 | NIT | web/index.html tkPaintSubtasks | BRANCH | focus lost on poll | FIXED | 6effc24 |
| 7 | 2 | NIT | web/index.html tskPaint | BRANCH | DOM-read tick prune | DEFERRED | correct as written |
| 8 | 6g | BLOCKER | tools/run-tests.sh surface gate | BRANCH | three surface-mapped checks flagged | FIXED | 5cc4ab4 (checks run, trailers) |

### NITs (non-blocking, across all iterations)
- Iteration 3's five NITs above, left as they are.

### Strengths (across all iterations)
- taskNest is one pure rule for both surfaces; parent-not-in-list and a loop are both handled and pinned by lifted tests fed from the real engine (iterations 2 and 3)
- The project page rows and /api/tasks rows share one treeOf, and a test asserts they agree row by row (iterations 2 and 3)
- Every interpolated value is esc()'d, Number()'d or set by textContent (iterations 2 and 3)
- New browser check and new arms were each measured red without the change (negative controls)
