---
pre_challenge: true
method: challenge-loop
branch: consolidated-subview-3502
diff_hash: 08b1b52c5a962133e388792795db3e0a9e2971dd58296a2f7ba948a40d0c8b52
validation: passed
subdir_audit: passed
timestamp: 2026-09-23T21:37:31Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5 (iteration 1 = the 6.0 fix-and-validate pass; then 4 blind reviews alternating opus/sonnet)
**Converged:** Yes (iteration 5, sonnet, produced zero new actionable findings; convergence witnessed by two models)
**Total findings:** 2 BLOCKERs, 3 WARNINGs, 5 NITs (0 CONVENTIONs) + STRENGTHs
**Fixed:** 4 (1 BLOCKER dedup) | **Deferred:** 5 NITs | **Asked (awaiting user):** 0

The multi-model loop earned its keep: opus and sonnet each caught real findings the other missed
(the surface-gate token collisions on sonnet, the missing focus test on opus).

### Per-Iteration Breakdown

#### Iteration 1 (the 6.0 fix-and-validate pass)
**Reviewer model:** n/a (helper validation + author-found)
**New findings:** 1 BLOCKER, 1 WARNING
**Self-generated:** 0 (nothing had committed at 6.0 time; BRANCH)
- [BLOCKER] browser-checks-reason-grep.test.js -- the new check bumped the emit-site count; EXPECTED_SITES 126 -> 127 (deliberate, measured). --> FIXED (3efa434ad).
- [WARNING] web/index.html settings-link handler -- it focused #pj-settings-back, now display:none in consolidated (a display:none element cannot take focus), stranding keyboard focus on the cog. Caught by the author while reading before the first blind review. --> FIXED (3efa434ad): focus the settings heading (tabindex -1) when the back button is hidden.

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs (1 WARNING raised but a DUPLICATE of iteration 1's focus finding, already FIXED), 0 CONVENTIONs
**Self-generated:** 0
- [WARNING] the focus regression -- confirmed independently (the reviewer even cited the codebase's "must not drop focus to body" rule). DEDUP of iteration 1; confirmed resolved by 3efa434ad.

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 2 NITs
**Self-generated:** 0
- [BLOCKER] the #2518 browser-check-surface gate reds: my diff changed lines carrying `data-win-copy` (render-win32-board-copy.js) and `dname` (render-title-descender-3438.js), neither covered. --> FIXED (3efa434ad amended): added per-check override trailers after confirming both checks' asserted behaviour is unchanged (win32 asserts #docs-finder TEXT, unaffected by the class swap; title-descender asserts the project-detail title, not the settings .dname).
- [NIT] plan filename lacks the timestamp suffix. --> DEFERRED (repo-wide drift, cosmetic).
- [NIT] the check asserts pj-alltasks-view but does not declare it (relies on render-alltasks.js's override). --> DEFERRED (harmless; declaring it would create a token-ownership conflict).

#### Iteration 4
**Reviewer model:** opus
**New findings:** 1 WARNING, 2 NITs
**Self-generated:** 0
- [WARNING] the settings-focus fix (a behavioural change) had no automated assertion; the check verified only the precondition (back hidden). --> FIXED (9af5046a3): added a positive-controlled focus assertion that clicks the real cog and checks document.activeElement lands on the settings heading (clearing the firstrun-overlay inert first, which the hermetic boot leaves set). Fails on the pre-fix handler, passes on the fix.
- [NIT] plan-filename timestamp (re-raise). --> DEFERRED.
- [NIT] the check asserts pj-alltasks-view without declaring it (re-raise). --> DEFERRED.

#### Iteration 5
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
**Converged** -- no new actionable findings. The reviewer independently verified the focus assertion is faithful (traced frClose() as the only inert-clearing path), checked all three surface override trailers against each check's actual assertions, verified the count bump two ways, and ran the check locally (15/15).
- [NIT] Settings has pre-existing right padding but no left inset (asymmetric in its centered box). --> DEFERRED (reviewer: "not a regression from this change; no action needed").
- [NIT] the inert clear is page-wide rather than scoped to firstrun-set panels. --> DEFERRED (reviewer: "harmless in this hermetic boot"; worth scoping only if the check is reused as a template).

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | browser-checks-reason-grep.test.js:540 | BRANCH | emit-site count 126->127 for the new check | FIXED | 3efa434ad |
| 2 | 1 | WARNING | web/index.html (settings-link handler) | BRANCH | focus() on the display:none back button strands focus in consolidated | FIXED | 3efa434ad |
| 3 | 2 | WARNING | web/index.html (settings-link handler) | BRANCH | dup of #2 (blind-confirmed) | FIXED (dedup) | 3efa434ad |
| 4 | 3 | BLOCKER | commit trailers | BRANCH | #2518 surface gate: data-win-copy + dname collisions uncovered | FIXED | 3efa434ad (amend) |
| 5 | 3 | NIT | plan filename | BRANCH | no timestamp suffix | DEFERRED | repo-wide drift |
| 6 | 3 | NIT | render-subview-cleanup-3502.js:2 | BRANCH | asserts pj-alltasks-view without declaring it | DEFERRED | render-alltasks.js override covers the token |
| 7 | 4 | WARNING | render-subview-cleanup-3502.js | BRANCH | focus fix behaviour untested | FIXED | 9af5046a3 |
| 8 | 5 | NIT | web/index.html:~3995 | BRANCH | Settings right-padding without left (centered box) | DEFERRED | pre-existing, not a regression |
| 9 | 5 | NIT | render-subview-cleanup-3502.js:105 | BRANCH | inert clear is page-wide | DEFERRED | harmless in the hermetic boot |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- Plan filename lacks the timestamp suffix (iterations 3, 4) -- repo-wide drift.
- The check asserts pj-alltasks-view without declaring it (iterations 3, 4) -- covered by render-alltasks.js's override.
- Settings has pre-existing right padding without a left inset (iteration 5) -- not introduced here.
- The inert clear is page-wide (iteration 5) -- harmless in this hermetic boot.

### Strengths (across all iterations)
- CSS correctly consolidated-scoped with longhand properties; Settings excluded from the left inset (centered); no shorthand clobber or tab-view leak (iterations 2, 4, 5).
- The #2518 surface gate handled honestly: three per-check override trailers, each checked against the overridden check's actual assertions; gate exit 0 (iterations 4, 5).
- The browser-check is fully wired (README, runner list) and positive-controlled (7 CSS/geometry fails on the pre-fix markup, plus the focus assertion fails on the pre-fix handler); the focus assertion clicks the real cog and reads document.activeElement (iterations 2, 4, 5).
- The focus fix reaches the correct branch and lands focus on the heading once the firstrun inert is cleared, the real dismissed state (iterations 4, 5).
