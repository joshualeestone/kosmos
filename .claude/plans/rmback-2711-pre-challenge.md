---
pre_challenge: true
method: challenge-loop
branch: rmback-2711
diff_hash: 5c9d8eff9a428d58a509857fd8484a7651937fe4578951c90cc3c19acf1e550e
validation: passed
subdir_audit: passed
timestamp: 2026-09-11T05:15:50Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 blind passes (opus, sonnet, opus)
**Converged:** Yes (iteration 3 found zero NEW BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 6 (0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs)
**Fixed:** 3 | **Deferred:** 3 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above (ITER_COMMITS empty on the first pass)
- [WARNING] docs/browser-checks/render-projects.js, render-tasks.js - the narrow-width (below 56rem, tab behind burger) route out of a project is not exercised by any changed check --> DEFERRED: a UX/design call, not a code defect. The route out is preserved at every width (the Projects-tab handler is viewport-independent), sub-views keep their own .back buttons, and item 17 is Josh's explicit "remove back arrow" ask, documented PROPOSED in the plan for his pixel review. Adding narrow-width coverage is beyond item-17 scope.
- [NIT] .claude/plans/rmback-2711.md - em dashes (the fleet's one banned output character) --> FIXED (commit b5882d1, replaced with hyphens)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above (both stale comments predate this loop; blame attributes them to old commits, so BRANCH)
**Duplicates of prior findings (confirmed resolved):** 0
- [WARNING] web/index.html:19568 - the tabs-handler comment asserted "arriving by Back" as a live route into the reset; #pj-back was removed --> FIXED (commit 8263f45, reworded to historical framing)
- [WARNING] web/index.html:36470 - the pjMarkOpen docblock listed "the Back button" among the current close paths that call pjMarkOpen(null) --> FIXED (commit 8263f45, changed to the still-live add-project Back button)
- [NIT] commit subjects use `#2711 item 17: <msg>`, a slight deviation from the two accepted forms --> DEFERRED: CLAUDE.md says either form is accepted; rebasing already-committed loop history is disproportionate for a NIT.

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
**Converged** - no new actionable findings.
- [NIT] web/index.html:36467 - the pjMarkOpen docblock names 4 of the 5 live close paths (the openProject can't-read-back fallback is unnamed) --> DEFERRED: pre-existing (it named 4 of 6 before this change), illustrative rather than exhaustive, and the authoritative pin is the count test (5), which is correct. Making the list exhaustive would risk the "exhaustive prose list goes stale" trap Convention #5 warns about.
- [NIT] web/index.html:10189 (removed button) - the a11y/discoverability tradeoff of dropping the in-context exit --> DEFERRED: duplicate of iteration 1's WARNING; Josh's pixel review, documented PROPOSED.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | render-projects.js / render-tasks.js | BRANCH | narrow-width route-out not exercised by a changed check | DEFERRED | UX/design call; route preserved at all widths; Josh pixel review |
| 2 | 1 | NIT | .claude/plans/rmback-2711.md | BRANCH | em dashes in plan file | FIXED | b5882d1 |
| 3 | 2 | WARNING | web/index.html:19568 | BRANCH | comment asserts "arriving by Back" as a live route | FIXED | 8263f45 |
| 4 | 2 | WARNING | web/index.html:36470 | BRANCH | pjMarkOpen docblock lists removed Back button as a close path | FIXED | 8263f45 |
| 5 | 2 | NIT | commit subjects | BRANCH | `#2711 item 17:` form deviation | DEFERRED | either form accepted |
| 6 | 3 | NIT | web/index.html:36467 | BRANCH | docblock names 4 of 5 close paths | DEFERRED | pre-existing, illustrative; count test authoritative |
| 7 | 3 | NIT | web/index.html:10189 | BRANCH | a11y/discoverability tradeoff | DEFERRED | dup of #1; Josh pixel review |

### NITs (non-blocking, across all iterations)
- [NIT] plan-file em dashes (iteration 1) - FIXED
- [NIT] commit subject form (iteration 2) - deferred, either form accepted
- [NIT] docblock 4-of-5 close-path enumeration (iteration 3) - deferred, illustrative
- [NIT] a11y/discoverability of removing the in-context exit (iteration 3) - deferred, Josh pixel review

### Strengths (across all iterations)
- Route equivalence verified by reading the code, not asserted: the Projects-tab handler runs the exact `pjCloseConfirm(); PJ_CURRENT=null; pjMarkOpen(null); pjView('list')` sequence the removed arrow ran, and the refresh-stuck guard survives (iterations 1, 2, 3).
- The pjMarkOpen(null) 6->5 count change is correct: exactly 5 code-only call sites remain, and the test strips comments before counting (iterations 1, 2, 3).
- Browser-check rewrites are faithful: `.tab[data-tab="projects"]` is a unique, clickable selector at the 1280px viewport every affected check uses (iterations 1, 2, 3).
- The web.unique-ids.test.js swap to pj-say is sound: id="pj-say" exists exactly once, so both controls stay meaningful (iterations 1, 2, 3).
- No dangling live references to #pj-back remain in app, tests, or browser-checks; the shared .back CSS class was correctly left untouched (7 other buttons use it) (iterations 1, 2, 3).
