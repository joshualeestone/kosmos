---
pre_challenge: true
method: challenge-loop
branch: ick-3279-mapcleanup
diff_hash: 40ee48eb7545282f3bd791cbb638b1500c96c836ce9ecd100a5aee4eaeaf6557
validation: passed
subdir_audit: passed
timestamp: 2026-09-19T03:59:42Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2 found no BLOCKER/WARNING/CONVENTION)
**Total findings:** 6 (1 BLOCKER, 0 WARNINGs, 3 CONVENTIONs, 2 NITs)
**Fixed:** 6 | **Deferred:** 0 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 0 WARNINGs, 3 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above (ITER_COMMITS empty on the first review)
- [BLOCKER] browser-check gate (#1720/#2518) -- web/ changed with no docs/browser-checks assertion
  update (a deletion does not count) and no override trailer, so tools/run-tests.sh fails -->
  FIXED: added a `Browser-check:` trailer (dead-code deletion only; the retired Map's absence is
  already asserted by render-projects + render-projects-roadmap-3276, both re-run green) AND a
  per-check `Browser-check-surface: render-dm-badges-2863.js` trailer (the flagged 'onode' token is
  the deleted PROJECTS `.pjonode`; that check asserts the AGENTS `#orgmap .onode` badges, untouched).
  Both gates verified passing (sourced + called as run-tests.sh does), and confirmed the override is
  honest by measurement (bare `.onode` still 34 refs, zero added `onode` lines).
- [CONVENTION] .claude/plans/ -- no plan file for the branch --> FIXED (added ick-3279-mapcleanup.md)
- [CONVENTION] web/index.html:37725 -- comment named the deleted Map's data-pjfold as a live
  three-way distinction --> FIXED (now two-way: data-pjtreefold vs the rail's data-fold)
- [CONVENTION] web/index.html:44049 -- fold-caret comment "the same order the Map view uses" -->
  FIXED (Map reference removed)
- [NIT] web/index.html:5672 -- `.pjonode.attn` in a dark-mode rationale footnote --> FIXED (reworded)
- [NIT] web.project-rows.test.js:90 -- comment named the deleted render-subproject-columns-3135.js
  --> FIXED (noted the multi-column List + its check were retired in #3276/#3279)

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0 of the above
**Converged** -- no issues found. 6 STRENGTHs: no dangling references in live code (whole-tree
sweep); no over-deletion (PJ_TREE_FOLDED/PJ_ORDER/PJ_DRAGGING/orgTreeOf and the live .pj-roadmap
CSS all intact; agents bare `.onode` = 34, `#orgmap` = 1, using the different `.pjonode` the map
used); forced-dark parity clean (web.theme.test.js 13/13, regenerated via sync-forced-theme.js not
hand-edited); the render-dm-badges-2863.js surface override is honest; the test rewrite is
non-vacuous (6/6) and the browser-check-file removal is consistent across file/README/runner (wiring
suite 14/14); and the companion pjMapFit deletion (not in the card's list) is correctly justified.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | tools/run-tests.sh browser-check gates | BRANCH | web/ change with no assertion update + no trailer | FIXED | Browser-check + Browser-check-surface trailers (verified both gates pass) |
| 2 | 1 | CONVENTION | .claude/plans/ | BRANCH | no plan file | FIXED | added ick-3279-mapcleanup.md |
| 3 | 1 | CONVENTION | web/index.html:37725 | BRANCH | stale Map data-pjfold comment | FIXED | 402319e8 (amended) |
| 4 | 1 | CONVENTION | web/index.html:44049 | BRANCH | stale "Map view uses" comment | FIXED | 402319e8 (amended) |
| 5 | 1 | NIT | web/index.html:5672 | BRANCH | .pjonode.attn rationale footnote | FIXED | 402319e8 (amended) |
| 6 | 1 | NIT | web.project-rows.test.js:90 | BRANCH | names deleted browser-check | FIXED | 402319e8 (amended) |

### Outstanding questions (ASKED, still unresolved when the run ended)
- None.

### NITs (non-blocking, across all iterations)
- web/index.html:5672 (.pjonode.attn footnote) -- fixed.
- web.project-rows.test.js:90 (deleted-check reference) -- fixed.

### Strengths (across all iterations)
- No dangling references: every deleted symbol has zero surviving functional references (only
  accurate retirement comments + historical plan records remain) (iters 1, 2).
- No over-deletion: the KEEP island (PJ_TREE_FOLDED/pjSaveFold/PJ_ORDER/pjSaveOrder/pjClearOrder/
  pjManualOrderActive/PJ_DRAGGING) sitting inside the map-code region, plus orgTreeOf and the live
  .pj-roadmap CSS and the bare .pc-t/.pj-row base rules, are all intact (iters 1, 2).
- Forced-dark mirror regenerated via tools/sync-forced-theme.js, not hand-edited (web.theme 13/13) (iters 1, 2).
- Browser-check-file removal is atomic + consistent (file, README row, runner entry); wiring suite green (iters 1, 2).
- The map used the projects-only `.pjonode`; the agents `#orgmap .onode` badge surface is untouched,
  making the render-dm-badges-2863.js override honest (iter 2).
