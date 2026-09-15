---
pre_challenge: true
method: challenge-loop
branch: projectview-cleanup-6800
diff_hash: c7aadc79e81f6f86a3f6797a840e907fe6481f65bec4a3796d762b0b54a0dc5a
validation: passed
subdir_audit: passed
timestamp: 2026-09-15T20:55:06Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes (iteration 6 found zero new BLOCKER/WARNING/CONVENTION)
**Total findings:** 6 actionable (1 BLOCKER, 2 WARNINGs, 3 CONVENTIONs) + 6 NITs
**Fixed:** 6 | **Deferred:** 6 NITs | **Asked (awaiting user):** 0

6.68 project-view cleanup (#3103/#3104/#3105): removed the sub-projects section from the
single-project view in both layouts; moved the breadcrumb to a full-width row at the top of
`#pj-one-view` in the standard view and hid it in consolidated; made the consolidated left
rail titles-only (hid `.pjfaces`/`.pjpill`/`.pjsub`) and restyled `#pj-arch-toggle` smaller +
un-underlined (scoped to the consolidated rail). Two browser-checks updated + one driver
summary comment. Reviewed by opus and sonnet, alternating, across 6 iterations.

### Per-Iteration Breakdown

#### Iteration 1 (6.0 initial validation)
**Reviewer model:** n/a (validation pass, before the first blind reviewer)
**New findings:** 1 BLOCKER
**Self-generated:** 0 (synthetic, BRANCH by instruction)
- [BLOCKER] #2518 browser-check surface gate: `lrow` token in web/index.html diff flags render-dm-badges-2863.js, check not updated --> FIXED (26bbd54b9): the only `lrow` hits are two REMOVED comment lines ("the card/lrow hover") above the deleted `.pj-subrow` dark rules; the `.lrow` surface is unchanged, so overrode via the documented `Browser-check-surface: render-dm-badges-2863.js ...` per-check trailer.

#### Iteration 2 (opus, first blind review)
**Reviewer model:** opus
**New findings:** 1 CONVENTION, 1 NIT
**Self-generated:** 0
- [CONVENTION] web/index.html placeAppSettings comment: contrasted against the deleted `placeSubProjects` --> FIXED (26bbd54b9): reworded to state placeAppSettings's own sibling-reference approach.
- [NIT] `#pj-arch-toggle` restyle applied globally (deliberate at the time; escalated + fixed at iter 5).

#### Iteration 3 (sonnet)
**Reviewer model:** sonnet
**New findings:** 1 WARNING, 1 NIT
**Self-generated:** 0
**Duplicates of prior findings:** 0
- [WARNING] the `.pjsub` (sub-project count) rail-hide rule was UNGUARDED: both browser-checks' fixtures had childCount 0, so `.pjsub` never rendered and a regression would pass green --> FIXED (afbb3f123): gave Henderson a sub-project so its rail row renders `.pjsub`; added an explicit `present.{pill,count,sub}` non-vacuity control.
- [NIT] web.consolidated-980.test.js:293 comment names `placeSubProjects` (removed) -- accurate history, untouched file --> DEFERRED.

#### Iteration 4 (opus)
**Reviewer model:** opus
**New findings:** 1 CONVENTION, 3 NITs
**Self-generated:** 0
**Duplicates of prior findings:** 1 (arch-toggle scope, from iter 2)
- [CONVENTION] plan filename lacked the `-<timestamp>` suffix (project CLAUDE.md line 111) --> FIXED (9b6dec3c3): renamed to projectview-cleanup-6800-20260915T1821.md.
- [NIT x3] arch-toggle scope (dup); consolidated-980 comment (dup); density magic-number `<44` (annotated, non-vacuous) --> DEFERRED.

#### Iteration 5 (sonnet)
**Reviewer model:** sonnet
**New findings:** 1 CONVENTION, 1 WARNING
**Self-generated:** 0
- [CONVENTION] tools/browser-checks.sh driver summary for render-project-rows still described the removed #1303E same-line assertions --> FIXED (1106b8b8f): rewrote it for the #3105 titles-only assertions.
- [WARNING] arch-toggle restyle applied globally, beyond mockup 2's consolidated scope (flagged 3x, escalated here) --> FIXED (1106b8b8f): scoped to `body.consolidated #pj-arch-toggle` per josh-approved-designs-built-verbatim; the Projects TAB toggle keeps base .linkish.

#### Iteration 6 (opus)
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
**Converged** -- no new actionable findings.
- [NIT] `.pj-warn` (bad-folder warning) kept visible in the titles-only rail --> DEFERRED (deliberate: suppressing an actionable error is worse than a strict "titles only"; Josh's ask targets decorative counts/status, not error warnings).
- [NIT] render-project-rows tab-view leak-control comment (pre-existing arm, accurate for the #867 rules it guards) --> DEFERRED.
- [NIT] commit 065f697e2 body links the pre-rename plan path (historical, no code impact) --> DEFERRED.

#### Iteration 7 (opus) -- post-rebase re-verification (2026-09-15 15:54 CDT)
**Why:** 6.68 got the GO (Josh's fresh-Mac install confirmed the P0). Main had moved 5 commits
touching the shared web/index.html (#3110 avatar CSS, #3106 headline copy, #3114 resolver,
#1670/#3115, publish-atomic #3073b). Rebased projectview-cleanup-6800 onto current origin/main
(ab39ef8ef); merge-tree predicted no conflict and the 10-commit rebase applied with ZERO
conflicts. Per a-rebase-orphans-every-recorded-run, the pre-rebase green is not trusted: full
re-validation + a fresh blind challenge were run on the rebased HEAD.
**Reviewer model:** opus (fresh, blind, cold)
**New findings:** 0 BLOCKER, 0 WARNING, 0 CONVENTION (1 design-scope NOTE, not a defect).
- Traced every removed identifier (`pj-one-subprojects`, `placeSubProjects`, `pj-subs`,
  `pj-subrow`, `subsEl`) repo-wide: they survive ONLY in explanatory comments; the four
  removed-as-a-unit pieces (section markup, painter block, showTab call, click delegate) are
  all gone as a set, so no load-time null-deref.
- Rebase integrity confirmed: #3110 avatar CSS present at web/index.html:2522, #3106 copy is an
  ancestor of HEAD, the origin/main...HEAD diff is coherent project-view-only content with no
  duplicated/half-applied avatar/headline hunks; the challenge-loop fixups survived.
- Both browser-checks (render-subprojects-1994.js, render-project-rows.js) are in the live run
  loop and return the dangerous answer on origin/main (non-vacuous).
- Conventions clean: no em dashes (all five spellings incl. \u{2014}), no "Mac" product-voice,
  no new user-facing copy.
- [NOTE, not a defect] the #3105 Show Archived restyle is scoped to `body.consolidated` (rail
  only), consistent with the titles-only hide and faithful to the card's "(left column /
  consolidated left rail)" grouping; reversible. Flagged for Josh's awareness only.
**Re-validation:** full node suite on the rebased HEAD -- tests 7704, pass 7566, fail 0,
cancelled 0; browser-check surface gate 0 FAILED; bc-surface-map 0 FAILED; VAL_EXIT=0.
**Converged** -- rebased tree re-confirmed clean.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | .github/workflows + tools (surface gate) | BRANCH | #2518 lrow token flags render-dm-badges-2863 | FIXED | trailer, 26bbd54b9 |
| 2 | 2 | CONVENTION | web/index.html (placeAppSettings) | BRANCH | comment references deleted placeSubProjects | FIXED | 26bbd54b9 |
| 3 | 3 | WARNING | docs/browser-checks/render-project-rows.js | BRANCH | .pjsub rail-hide unguarded (childless fixtures) | FIXED | afbb3f123 |
| 4 | 4 | CONVENTION | .claude/plans/projectview-cleanup-6800.md | BRANCH | plan filename missing -<timestamp> | FIXED | 9b6dec3c3 |
| 5 | 5 | CONVENTION | tools/browser-checks.sh:1185 | BRANCH | driver summary describes removed #1303E assertions | FIXED | 1106b8b8f |
| 6 | 5 | WARNING | web/index.html:2729 | BRANCH | arch-toggle restyle applied globally (design scope) | FIXED | 1106b8b8f |

### Outstanding questions (ASKED)
None.

### NITs (non-blocking, across all iterations)
- [NIT] web/index.html #pj-arch-toggle scope (iters 2, 4) -- resolved at iter 5 by scoping to consolidated.
- [NIT] web.consolidated-980.test.js:293 stale `placeSubProjects` mention (iters 3, 4) -- accurate history, untouched file, deferred.
- [NIT] render-project-rows.js:171 density threshold `<44` magic number (iter 4) -- annotated, non-vacuous, deferred.
- [NIT] web/index.html .pj-warn kept visible in the rail (iter 6) -- deliberate, actionable-error not clutter, deferred.
- [NIT] render-project-rows.js:217 leak-control comment (iter 6) -- pre-existing arm, accurate for the #867 rules it guards, deferred.
- [NIT] commit 065f697e2 body links pre-rename plan path (iter 6) -- historical, no code impact, deferred.

### Strengths (across all iterations)
- Complete removal-as-a-unit: markup, painter, placeSubProjects + showTab call, and the load-critical click delegate all removed together; zero remaining executable references to the removed symbols (confirmed by full-repo grep, not just the diff).
- Breadcrumb relocation folded into placeProjectHead is idempotent and isolation-test-safe (short-circuit guards make it a no-op under the layout-picker mock document), simpler than the plan's proposed placeCrumbRow.
- Rail meta-hiding CSS out-specifies the #867 rail rules via the `#pj-list` id; correctly leaves the fold caret, title, and the #2929 orphan ancestry chip visible.
- Both browser-checks are non-vacuous with explicit controls (render-project-rows' `present` existence control + a child fixture; render-subprojects-1994's absence guards all red on origin/main).
- The surface-gate override trailer is honest and narrowly scoped (verified the `.lrow` DOM surface is genuinely untouched).
