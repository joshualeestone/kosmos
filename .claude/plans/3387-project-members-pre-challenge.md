---
pre_challenge: true
method: challenge-loop
branch: 3387-project-members
diff_hash: 12e532ee362f819ca9b7595d1e7645ae07ee62c82124ed7fac94636c13d98e0f
validation: passed
subdir_audit: passed
timestamp: 2026-09-22T07:35:03Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7 (6.0 initial validation passed clean, so the first blind reviewer was iteration 1)
**Converged:** Yes (iteration 7 produced zero new BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 8 actionable (0 BLOCKERs from reviewers, 4 WARNINGs, 1 CONVENTION, 3 NITs actioned as fixes) + 1 synthetic BLOCKER from the 6j final-validation gate
**Fixed:** 9 | **Deferred:** 0 | **Asked (awaiting user):** 0

Model rotation (kosmos#2032): opus / sonnet / opus / sonnet / opus / sonnet / opus. Convergence witnessed by both models.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above (first reviewer; ITER_COMMITS empty)
- [NIT] web/index.html — `.alist-sep` CSS rule now dead (nothing emits the `<hr>`) --> FIXED (f2fc12f17): removed the rule, reworded the sub-header comment
- [NIT] web/index.html — modal opened from the rail did not return focus to the rail + on close (focus fell to body) --> FIXED (f2fc12f17): AM_OPENER records the rail opener
- [NIT] render-project-members-3387.js — vestigial `err: null` field with an always-true assertion --> FIXED (f2fc12f17): removed

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs (companion diagnostics)
**Self-generated:** 0 of the above
- [WARNING] no test exercised the grouped -> empty-board transition (the setAgentsGrouped(false) in the early return) --> FIXED (8699229b9): added scenario 5

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs
**Self-generated:** 0 of the above (the cited line, tick's catch, is pre-existing)
- [WARNING] web/index.html — tick()'s failed-poll catch did not reset the grouped head, so a poll failure while grouped left "Project Members" over a "could not refresh" list --> FIXED (1dfb9d591): setAgentsGrouped(false) in the catch + scenario 6

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 1 of the above (the AM_OPENER staleness finding cites amClose logic this loop added in iteration 1)
- [WARNING] web/index.html — AM_OPENER could be left stale by pjView's direct modal-hide, misdirecting a later tab-view close to the off-screen rail + (a regression to the tab-view focus contract); .hidden could not see an ancestor-hidden control --> FIXED (cb213e43c): both openers record themselves; amClose uses an offsetParent visibility test
- [WARNING] no test for "grouped but Other-Agents list empty" (all visible agents are members) --> FIXED (cb213e43c): added scenario 7
- [NIT] the eval(SETUP.toString()) fixture-sharing was non-idiomatic --> FIXED (cb213e43c): refactored to addInitScript + a named window fixture fn

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs (both harmless / intentional)
**Self-generated:** 0
- Reviewer converged (no actionable findings). The 6j final-validation gate then caught a real regression (below).

#### 6j final-validation gate (after iteration 5 convergence)
**Synthetic finding:** [BLOCKER] final-validation: 3 isolation tests failed with `ReferenceError: setAgentsGrouped is not defined` (server.test.js + web.offline-note.test.js lift `tick`/its catch slice and eval it with an explicit injected-dependency list; iteration 3 added a setAgentsGrouped call into that lifted region). **Origin: BRANCH.** --> FIXED (30b8d47a8): injected setAgentsGrouped as a no-op into the three lifted-tick harnesses, matching the existing ringNewAgentMessages pattern. Loop returned to review.

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 1 NIT
**Self-generated:** 0
- [CONVENTION] the plan file did not reflect the post-plan refinements (AM_OPENER, the two no-row resets, all-members header) --> FIXED (723635ca3): added a "Refinements during the challenge-loop" section to the plan

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0
**Converged** — no new actionable findings; every no-row reset, the surface-gate trailers, the harness injections and the plan were independently confirmed correct.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | NIT | web/index.html:3542 | BRANCH | dead .alist-sep CSS rule | FIXED | f2fc12f17 |
| 2 | 1 | NIT | web/index.html (amClose) | BRANCH | rail-opened modal did not return focus to the rail + | FIXED | f2fc12f17 |
| 3 | 1 | NIT | render-project-members-3387.js | BRANCH | vestigial err:null field | FIXED | f2fc12f17 |
| 4 | 2 | WARNING | render-project-members-3387.js | BRANCH | no grouped->empty-board transition test | FIXED | 8699229b9 |
| 5 | 3 | WARNING | web/index.html (tick catch) | BRANCH | failed-poll branch did not reset the grouped head | FIXED | 1dfb9d591 |
| 6 | 4 | WARNING | web/index.html (amClose/AM_OPENER) | SELF | AM_OPENER could go stale via pjView's direct hide; .hidden misses ancestor-hidden | FIXED | cb213e43c |
| 7 | 4 | WARNING | render-project-members-3387.js | BRANCH | no all-members-grouped (empty rest) test | FIXED | cb213e43c |
| 8 | 4 | NIT | render-project-members-3387.js | BRANCH | non-idiomatic eval fixture sharing | FIXED | cb213e43c |
| 9 | 6j | BLOCKER | server.test.js / web.offline-note.test.js | BRANCH | lifted-tick isolation tests threw ReferenceError: setAgentsGrouped | FIXED | 30b8d47a8 |
| 10 | 6 | CONVENTION | .claude/plans/3387-project-members-20260922-010736.md | BRANCH | plan did not reflect post-plan refinements | FIXED | 723635ca3 |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- render-project-members-3387.js scenario 8's "fixture sanity" wording implies a conditional gate that a flat assertion harness does not have (iteration 5) — left as-is; it functions correctly as a companion diagnostic
- web/index.html — the "Other Agents" header renders with no rows beneath it when every agent is a member (iteration 5) — intentional per the plan (keeps New agent reachable), covered by scenario 7
- web/index.html:3549 — fold-a hides the sub-header's label and + individually rather than the wrapping span (iteration 6) — functionally equivalent
- render-project-members-3387.js test #4 control's railName/plusLabel sub-assertions are static defaults that cannot fail in isolation (iteration 7) — the real reset transition is covered by scenarios 5 and render-consolidated-layouts.js

### Strengths (across all iterations)
- The change reuses the existing add-member engine + modal rather than duplicating logic; openAddMemberModal improves on the tab-view handler by painting the picker immediately (iter 1)
- The new render-project-members-3387.js reds on origin/main with discriminating controls, not a tautology; runs both themes (iters 1-5)
- setAgentsGrouped is called on every #alist no-row path (empty-board early return, flat branch, failed-poll catch); paintAgentList is the single funnel for PJ_CURRENT transitions, so the head/+ state cannot drift (iters 3, 5, 6)
- The three Browser-check-surface trailers are honest and complete; each names a check whose declared token appears in a changed web/index.html line and whose contract is genuinely unaffected (iters 1-7)
- No em dashes (any of the five spellings) anywhere in the diff (every iteration)
