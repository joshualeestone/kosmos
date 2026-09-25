---
pre_challenge: true
method: challenge-loop
branch: tasks-door-3703
diff_hash: 40406c510a502edfd835448f201977bde313abbb9d1086f5e0a857a5ea796f07
validation: passed
subdir_audit: passed
timestamp: 2026-09-25T09:39:40Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6 blind reviewer passes, alternating Opus and Sonnet
**Converged:** Yes (iteration 6, Sonnet: one cosmetic NIT, nothing actionable)
**Total findings:** 20 (0 BLOCKERs, 6 WARNINGs, 1 CONVENTION, 13 NITs), plus 2 synthetic validation BLOCKERs
**Fixed:** 18 | **Deferred/accepted:** 4 (recorded in the plan) | **Asked (awaiting user):** 0

Validation: the full suite through the validation helper PASSED on e35d31f4 (9049 pass, 0 fail,
148 skipped; lint, type-check and build clean; subdir audit clean; helper hash 40406c510a50).
Two earlier red runs were load flakes, not this diff:
- `engine/feedbacksend` #1760 timing: 4189ms at load 16 on 10 cores, about 330ms alone (x3).
- `test-kosmos-addr-reclaim-3079` owner pid: 12/12 alone (x3).
Neither file is in the diff.

### Per-Iteration Breakdown

#### Validation pass (on 154747ce)
**New findings:** 2 synthetic BLOCKERs
**Self-generated:** 0
- [BLOCKER] web.tasks-new-3703.test.js:34 hand-built member rows (fixture-discipline) --> FIXED (79381623, real fleet cards)
- [BLOCKER] render-tasks-view-3559.js lacked lib-sandbox-home after #3675 (main was red) --> RESOLVED upstream by #3705 (merged 08:49Z); my duplicate was dropped and the branch rebased

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 4
- [WARNING] web/index.html openNewTask no-choices branch: said "Make a project first" when the list was unreadable or all archived --> FIXED (f0329571, three honest sentences)
- [NIT] the picker change carried an assignee to another project --> FIXED (f0329571)
- [NIT] no-choices branch left a stale project name for the describedby line --> FIXED (f0329571)
- [NIT] the picker default keyed on an empty draft --> FIXED (f0329571)
- [NIT] a door's scope is sticky after leaving the view --> ACCEPTED (plan Decisions: consistent with a rail pick)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 1
- [WARNING] web/index.html #nt-modal aria-describedby pointed at a hidden line in picker mode --> FIXED (169c192b, description follows the mode)
- [WARNING] + New task files to an archived project when scoped to it --> DECISION (169c192b, as that project's own page does; test + plan)
- [NIT] engine/tasks.js allTasks and its test's comments described the retired screen --> FIXED (169c192b)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 6 NITs
**Self-generated:** 3
- [WARNING] web/index.html openNewTask: the dialog's own default pick wiped a draft (details-only, or an archived project's draft) --> FIXED (ffaeae17, the draft follows the pick; only who resets)
- [NIT] no-choices branch drops a kept assignee --> ACCEPTED (rare; plan)
- [NIT] a scope to a deleted project opens the picker --> ACCEPTED (visible; plan)
- [NIT] server.js comments described the retired door read --> FIXED (ffaeae17)
- [NIT] engine/tasks.js and server.tasks-all-1382 comments --> FIXED (ffaeae17)
- [NIT] the plan named a check and a label that do not exist --> FIXED (ffaeae17)
- [NIT] no browser arm for archived projects in the picker --> FIXED (ffaeae17, render-alltasks arm)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 0 NITs
**Self-generated:** 1
- [WARNING] web/index.html tskPaint: the rail's "All tasks" count included an archived door's project (#1346 class) --> FIXED (8dd1e27f; browser arm red without the fix)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 4 NITs
**Self-generated:** 3
- [WARNING] web/index.html tskPaint: projHint kept a deleted project as the scope forever --> FIXED (e35d31f4, only while the project exists)
- [CONVENTION] stale prose about the retired screen in render-alltasks, render-tasks, web.tasks-cap-1193 --> FIXED (e35d31f4)
- [NIT] a good read erased the "Added task N" line --> FIXED (e35d31f4, clears only its own error line)
- [NIT] a rail pick sent withArchived like a door --> FIXED (e35d31f4, door scope only)
- [NIT] picker mode focused the text box, so the chosen project was never heard --> FIXED (e35d31f4, focus on the picker)
- [NIT] render-alltasks "other project not listed" arm is redundant with the one before --> ACCEPTED (harmless)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0
**Converged**: no new actionable findings.
- [NIT] web/index.html nt-go: "Added task N to <project>." uses the name read before the reload --> recorded; cosmetic, transient status line

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | V | BLOCKER | web.tasks-new-3703.test.js:34 | BRANCH | hand-built members | FIXED | 79381623 |
| 2 | V | BLOCKER | render-tasks-view-3559.js | BRANCH | missing lib-sandbox-home | FIXED | upstream #3705 |
| 3 | 1 | WARNING | web/index.html openNewTask | SELF | "make a project first" untrue | FIXED | f0329571 |
| 4 | 2 | WARNING | web/index.html #nt-modal | SELF | describedby on a hidden line | FIXED | 169c192b |
| 5 | 2 | WARNING | web/index.html openNewTaskFromTasks | BRANCH | archived scope files there | DECIDED | 169c192b + plan |
| 6 | 3 | WARNING | web/index.html openNewTask | SELF | default pick wiped a draft | FIXED | ffaeae17 |
| 7 | 4 | WARNING | web/index.html tskPaint | BRANCH | rail All count from archived door | FIXED | 8dd1e27f |
| 8 | 5 | WARNING | web/index.html tskPaint | BRANCH | projHint kept a deleted project | FIXED | e35d31f4 |
| 9 | 5 | CONVENTION | render-alltasks/render-tasks/web.tasks-cap-1193 | BRANCH | stale prose | FIXED | e35d31f4 |

### Outstanding questions (ASKED, still unresolved when the run ended)
- None.

### NITs (non-blocking, across all iterations)
- Sticky door scope after leaving the view (iteration 1): accepted, plan.
- No-choices branch drops a kept assignee (iteration 3): accepted, rare, plan.
- A deleted project's scope opens the picker (iteration 3): accepted, visible, plan.
- Redundant "other project not listed" browser arm (iteration 5): accepted, harmless.
- "Added task N to <project>." uses the pre-reload name (iteration 6): recorded, cosmetic.
- All other NITs listed per iteration above were fixed.

### Strengths (across all iterations)
- Every guarantee of the retired screen is re-asserted on the new destination rather than assumed to have moved (iterations 1, 6).
- Each fix carries a test that a mutation turns red; browser arms were proved able to fail (iterations 4, 5).
- withArchived is a one-project, id-equality exception with controls for live and unknown ids (iterations 2, 6).
