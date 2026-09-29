---
pre_challenge: true
method: challenge-loop
branch: layer-gutter-4494
diff_hash: ab9c737ef47332f51a3799f6d732ee712b992b51767fed1a4217528791976757
validation: passed
subdir_audit: passed
timestamp: 2026-09-29T07:56:40Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4: its one WARNING is the reflow under the update wash, already recorded in the plan as an accepted trade; final validation on 8472e9598 PASSED, 11665 node tests / 0 fail, audit clean)
**Total findings:** 4 actionable (0 BLOCKERs, 4 WARNINGs incl. 1 validation red, 0 CONVENTIONs) plus NITs
**Fixed:** 3 | **Deferred:** 1 | **Asked (awaiting user):** 0

⚠️ **Disclosures:**
- After iteration 2 I told the operator the loop had converged. It had not: iteration 2's validation had FAILED, and I read the background job's exit (the trailing echo's) instead of the helper's. Found when 6j re-ran instead of skipping. Every later run captured the helper's own exit code.
- Two validation runs were stopped by me (only processes whose cwd was this worktree): the 6j run superseded by the iteration-2 fix, and the iteration-3 run superseded by the rebase.
- The branch was rebased onto main after iteration 3 (#4421 moved the emit-site counts). All shas cited before the rebase are orphaned; post-rebase fix commits are c2f1f620c, 213802e80, 8472e9598. Iterations 1-3's reviews read the pre-rebase tree; iteration 4 and the final validation read the rebased tree.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above (ITER_COMMITS empty)
- [WARNING] web/index.html:1343 - comment called the wizard and update overlay "the other two full-window layers"; .rm-back dialogs and #boot-cover have the same shape --> FIXED (comment no longer claims completeness; the others filed as #4506) (commit d2b9f11, rebased c2f1f620c)
- [NIT] render-layer-gutter-4494.js:1 - surface tokens miss firstrun --> applied (same commit)
- [NIT] render-layer-gutter-4494.js:64 - elementFromPoint measures hit, not paint (the wizard layer has no own background)
- [NIT] web/index.html:1346 - reflow behind the 0.86 update wash
- [NIT] render-layer-gutter-4494.js:126 - wizard gutter control runs on a sibling page, not the ?first-run=1 page

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 new WARNINGs from review, 1 validation BLOCKER-class red, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 (the validation red cites the iteration-1 comment line)
**Duplicates of prior findings (confirmed resolved):** 1 (other full-window layers: #4506 exists; its extra `dialog[open]` matches no element, the page has no <dialog>)
- [WARNING] validation (6g): browser-check surface gate (#2518) red: the iteration-1 comment named `#boot-cover`, a surface token of render-boot-no-flash.js, which this change does not touch --> FIXED (comment reworded without the token; the gate run alone exits 0, the red run on the prior commit is its control) (commit 213802e80 post-rebase)
- [NIT] plan: #4489's first-screen rule is not on main yet (it keys on #fr-choice, a separate layer; not covered by this rule)
- [NIT] render-layer-gutter-4494.js:113 - the confirm is revealed by setting hidden, then the real Update button is clicked
- [NIT] render-layer-gutter-4494.js:74 - three fixed y samples at 1280x800
- [NIT] specificity note (confirmed)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] browser-checks-reason-grep.test.js:543,740 - branch conflicted with main after #4421 raised the emit-site counts --> FIXED (rebased; resolved to 205/125 on top of main's 202/123, measured by the equality test on the rebased tree, 35/35) (commit 8472e9598 records it in the plan)
- [NIT] web/index.html:1345 - reflow behind the update wash (recorded in the plan as an accepted trade)
- [NIT] render-layer-gutter-4494.js - the short-page, reserved-but-unscrolled half is guarded only by the computed-style assertion (stated gap)
- [NIT] plan: "01:3x" timestamp --> applied (06:30:16Z from the card comment)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 NEW WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
**Duplicates:** 1 (the reflow under the 0.86 update wash, recorded as an accepted trade in the plan; the reviewer also judged it acceptable)
- [NIT] web/index.html:1345 - headers behind the layer shift ~15px (under the wash / inert; restart-up makes the same trade)
- [NIT] render-layer-gutter-4494.js:60 - three y samples, x inside the 15px strip
**Converged** - no new actionable findings; merge-tree against origin/main clean, 0 behind.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html:1343 | BRANCH | comment claimed the two layers were the whole set | FIXED | c2f1f620c; #4506 filed |
| 2 | 2 | WARNING | validation (surface gate) | BRANCH | comment named #boot-cover surface token | FIXED | 213802e80 |
| 3 | 3 | WARNING | browser-checks-reason-grep.test.js:543,740 | BRANCH | conflict with main after #4421 | FIXED | rebase; 205/125 measured; 8472e9598 |
| 4 | 1,3,4 | WARNING | web/index.html:1345 | BRANCH | board reflows 15px behind the 0.86 update wash | DEFERRED | accepted trade, recorded in plan (a 15px shift under a wash announcing a reload beats a bright strip; restart-up makes the same trade) |

### Validation
- Baseline (6.0) on the original tree: PASSED (hash 7a298dfe4402).
- Iteration 2 (6g) on d2b9f11: FAILED (surface gate), fixed.
- Final (6g/6j) on 8472e9598 after the rebase: PASSED, hash ab9c737ef473, 11665 node tests / 0 fail, shell suites clean, subdir audit clean. The new check: 13 passed on the rebased tree.
- The check goes red with the rule removed (4 failures, measured by me and independently by reviewers 1 and 3; reviewer 2 showed each selector half is covered separately).

### NITs (non-blocking, across all iterations)
- elementFromPoint proves hit-testing, not paint (iteration 1)
- the wizard's gutter control runs on a sibling page (iteration 1)
- the update confirm is revealed by setting hidden before the real button click (iteration 2)
- fixed y samples at 1280x800 (iterations 2, 4)
- the short-page half is guarded only by the computed-style assertion (iteration 3, stated in the check header and plan)
- headers shift behind the layer (iteration 4)

### Strengths (across all iterations)
- A positive control proves the 15px strip exists before either layer opens, so a green cannot come from a harness with no gutter (all four reviewers)
- One declarative :has rule, no JS, follows every open/close path; specificity and older-WebKit behaviour checked (iterations 1-4)
- Registration complete and matching the sibling render-restart-screen-4343 (iterations 1, 3, 4)
