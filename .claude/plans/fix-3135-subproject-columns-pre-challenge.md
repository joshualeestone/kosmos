---
pre_challenge: true
method: challenge-loop
branch: fix-3135-subproject-columns
diff_hash: fb8329a028139b330c3b98307fa98ec37bee61bc630d17d0b63223ccdc61863e
validation: passed
subdir_audit: passed
timestamp: 2026-09-16T01:03:33Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes
**Total findings:** 7 (1 BLOCKER, 2 WARNINGs, 2 CONVENTIONs, 2 NITs) plus 8 STRENGTHs
**Fixed:** 4 | **Deferred:** 3 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1 (6.0 initial validation fix-and-validate pass)
**Reviewer model:** opus (orchestrator's own 6.0 pass, no blind reviewer yet)
**New findings:** 1 BLOCKER, 0 WARNINGs, 1 CONVENTION, 0 NITs
**Self-generated:** 0 (nothing had committed as a loop fix yet; the synthetic finding is BRANCH by instruction)
- [BLOCKER] tools/browser-checks.sh -- initial-validation: the new browser-check render-subproject-columns-3135.js was not RUN by the runner (#1387 wiring test failed) --> FIXED (commit ff7ed0cd): added the check to the runner's execution list.
- [CONVENTION] .claude/plans/ -- no plan file for this branch --> FIXED (commit def9ac0b): wrote the plan file.

#### Iteration 2 (first blind review)
**Reviewer model:** sonnet (a different model from iteration 1, per 6a)
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0 (all cited lines blame to f69826af5, the branch content under review, not to a loop fix commit)
**Duplicates of prior findings:** 0
- [WARNING] web/index.html:2977 -- the compact override supersedes the base four-column rule and the <52rem media collapse at every width; web.project-rows.test.js's pinned "four columns / narrow-only stacking" text now describes behavior the columnised view no longer renders (the two-derivations-of-one-fact class the repo names as its most-shipped defect) --> FIXED (commit 8368d5bb): documented that the compact card shape is now unconditional in the tab list view and that the base grid-template + media collapse are superseded here, and cross-referenced it from the test.
- [WARNING] render-subproject-columns-3135.js:99 -- the CSS and browser-check comments claimed a subtree is "never orphaned", but break-before/break-inside are advisory hints, not hard guarantees; a subtree taller than a balanced column can still split --> FIXED (commit 8368d5bb): restated the mechanism as advisory in both comments, disclosing the rare residual (an orphaned child shows indent but no ancestry chip, since the chip is hidden on a .child in this view).
- [CONVENTION] commit f69826af5 -- subject uses the `subproject-columns-3135 --` prefix but the branch is `fix-3135-subproject-columns` --> DEFERRED: Kosmos squash-merges (the individual commit subject is discarded; the squash commit uses the PR title), interactive rebase is unavailable in this environment, and rewriting the non-HEAD commit would reshuffle the plan/wiring commit shas and invalidate this loop's diff hash for no durable benefit. The PR title follows the convention.
- [NIT] .claude/plans/fix-3135-subproject-columns.md -- plan filename has no timestamp suffix --> DEFERRED (NIT): the plan-file gate and challenge-loop match on branch substring (timestamp optional in practice), and sibling plans follow the same no-timestamp pattern.
- [NIT] web/index.html:2979 -- legacy -webkit-column-break-* prefixes are redundant on modern engines --> FIXED (commit 8368d5bb): removed them, keeping unprefixed break-before/break-inside.

#### Iteration 3 (second blind review)
**Reviewer model:** opus (rotated back per 6a, so convergence is witnessed by two distinct models)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs (both accepted, no-action limitations)
**Self-generated:** 0
**Converged** -- no new actionable findings; two NITs restate already-disclosed accepted limitations.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | tools/browser-checks.sh | BRANCH | new browser-check not wired into runner (#1387) | FIXED | ff7ed0cd |
| 2 | 1 | CONVENTION | .claude/plans/ | BRANCH | no plan file | FIXED | def9ac0b |
| 3 | 2 | WARNING | web/index.html:2977 | BRANCH | override supersedes base rule + media query; stale pinned test description | FIXED | 8368d5bb |
| 4 | 2 | WARNING | render-subproject-columns-3135.js:99 | BRANCH | overclaimed "never orphaned" (advisory hint) | FIXED | 8368d5bb |
| 5 | 2 | CONVENTION | commit f69826af5 | BRANCH | commit subject prefix mismatch | DEFERRED | squash-merge discards subject; PR title correct |
| 6 | 2 | NIT | .claude/plans/fix-3135-subproject-columns.md | SELF | plan filename has no timestamp | DEFERRED | siblings omit it; gate matches branch substring |
| 7 | 2 | NIT | web/index.html:2979 | BRANCH | redundant -webkit prefixes | FIXED | 8368d5bb |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] render-subproject-columns-3135.js:187 -- the break-rule arms assert the COMPUTED property, not visual cohesion; true layout cohesion needs pixel comparison (unavailable this session). Accepted limitation, honestly disclosed. (iteration 3)
- [NIT] render-subproject-columns-3135.js:171 -- the `columns >= 2` arm depends on the panel rendering wide at the 1600px fixture; a future narrowing would fail LOUDLY with listWidth/columns surfaced, never silently pass. Safe. (iteration 3)

### Strengths (across all iterations)
- Tight, correct scoping: every new selector is prefixed body:not(.consolidated) #pj-list:not(.asgrid); consolidated rail, narrow rail, grid tile view, Map view, drag and fold all verified untouched. (iterations 2, 3)
- Specificity handled deliberately: the override cleanly beats the base rule and the media collapse, so the base rule text stays verbatim and its pins still pass. (iterations 2, 3)
- The new browser-check's load-bearing arms are non-vacuous: columnisation, column count, computed break rules, and compact-card shape all return the dangerous answer on origin/main. (iterations 2, 3)
- Subtree cohesion mechanism is sound (break-inside atomic rows + break-before on .child), with the rare residual honestly disclosed. (iteration 3)
- margin-bottom restores the inter-row spacing the flex gap loses under display:block multicol. (iteration 3)
