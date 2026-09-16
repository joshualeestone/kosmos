---
pre_challenge: true
method: challenge-loop
branch: margins-3133
diff_hash: eacc1fd092cf8d0f35750dd11c1c4c096fb1ff7dbfd3d1e913ba09f025510383
validation: passed
subdir_audit: passed
timestamp: 2026-09-16T09:03:19Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes
**Total findings:** 6 (2 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs)
**Fixed:** 5 | **Deferred:** 1 | **Asked (awaiting user):** 0

Scope: #3133 parts 1 (consolidated View-all-tasks top margin) and 3 (remove the sub-project
list-row count). Part 2 (tab projects-list right margin) is parked needs-browser and is not in
this diff.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (general-purpose)
**New findings:** 1 BLOCKER, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 (ITER_COMMITS empty at iteration 1)
- [BLOCKER] docs/browser-checks/render-project-rows.js — a CI browser-check also depended on
  .pjsub rendering (a sub-project fixture + present/hide assertion pair); removing .pjsub would
  red CI. Origin BRANCH. --> FIXED (3487cce7c): dropped the .pjsub arms + the now-purposeless
  sub-project fixture, kept pill/count hide coverage. (Missed initially: I grepped a stale main
  checkout, not the worktree.)
- [WARNING] docs/browser-checks/render-project-rows.js — stale comments about .pjsub. --> FIXED (3487cce7c).
- [NIT] docs/browser-checks/render-subprojects-1994.js:6 — run-on comment. --> FIXED (3487cce7c).

Then the 6.0/6g #2518 surface gate red'd: part 1 touches the pj-alltasks-view token that
render-alltasks.js annotates.
- [BLOCKER] (6g synthetic) #2518 surface gate: pj-alltasks-view / render-alltasks.js. Origin BRANCH.
  --> addressed with a Browser-check-surface trailer (render-alltasks.js runs in the tab layout;
  the consolidated-scoped padding-top cannot affect it).

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** the acted-on findings cite this loop's own iter-1 commit (SELF), both ordinary edits.
- [BLOCKER] commit 3487cce7 trailer — the Browser-check-surface trailer named "render-alltasks"
  without the .js extension, so browser-check-surface-gate.sh did not recognize it and the gate
  still red'd. Origin BRANCH. --> FIXED (aa99c37c6): corrected to "render-alltasks.js".
- [NIT] web/index.html — subCount was an always-empty constant after the removal. --> FIXED
  (aa99c37c6): dropped the variable and its '+ subCount' concatenation.

#### Iteration 3
**Reviewer model:** opus (general-purpose)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 acted-on
**Converged** — no new actionable findings.
- [NIT] git history — the obsolete bare-"render-alltasks" trailer in commit 3487cce is inert
  (matches no check; the corrected trailer in the newer commit is selected by head -1). --> DEFERRED:
  immutable history, no action; the gate ignores it.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | docs/browser-checks/render-project-rows.js | BRANCH | CI check depended on .pjsub render | FIXED | 3487cce7c |
| 2 | 1 | WARNING | docs/browser-checks/render-project-rows.js | BRANCH | stale .pjsub comments | FIXED | 3487cce7c |
| 3 | 1 | NIT | docs/browser-checks/render-subprojects-1994.js:6 | BRANCH | run-on comment | FIXED | 3487cce7c |
| 4 | 1 | BLOCKER | web/index.html (6g #2518) | BRANCH | surface gate: pj-alltasks-view / render-alltasks.js | FIXED | 3487cce7c trailer, corrected aa99c37c6 |
| 5 | 2 | BLOCKER | commit 3487cce7 trailer | BRANCH | trailer missing .js extension, gate unrecognized | FIXED | aa99c37c6 |
| 6 | 2 | NIT | web/index.html | SELF | subCount always empty | FIXED | aa99c37c6 |
| 7 | 3 | NIT | git history (commit 3487cce) | BRANCH | inert obsolete trailer | DEFERRED | immutable history; gate ignores it |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- render-subprojects-1994.js run-on comment (iter 1, FIXED)
- subCount always-empty constant (iter 2, FIXED)
- obsolete trailer in earlier commit (iter 3, deferred: immutable, inert)

### Strengths (across all iterations)
- Part 3 is a complete removal, not a hide: subCount var, '+ subCount' concat, .pjsub base CSS,
  and the consolidated display:none all gone; repo-wide sweep finds zero live .pjsub/subCount refs
  (iterations 2, 3).
- subs is correctly retained and load-bearing (the consolidated fold caret uses subs>0) (iterations 2, 3).
- The two updated browser-checks stay non-vacuous: render-project-rows keeps a real pill/count
  present-then-hidden control; render-subprojects-1994's sub==='' assertions return the dangerous
  answer on origin/main (iterations 2, 3).
- The Browser-check-surface trailer names render-alltasks.js WITH the extension the gate requires,
  and its justification is factually true (render-alltasks.js never enters consolidated layout)
  (iteration 3).
- Part 1 CSS precisely scoped (consolidated alltasks-view only, not the shared docs-view rule),
  using the real --space-8 token matching the sibling right inset (iterations 2, 3).
