---
pre_challenge: true
method: challenge-loop
branch: rtv-4213
diff_hash: e36a8da47d85256bc562af379171c926dd323922fa3fc99f03f129792b8a48ef
validation: passed
subdir_audit: passed
timestamp: 2026-09-27T16:40:01Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** Yes, at iteration 8. Final validation (6j) passed on 1bdb0bcb2 behind the heavy gate: the full
suite (10886 tests: 10723 pass, 163 skipped, 0 fail, 0 cancelled), type-check, lint, build; subdir audit rc=0.
**Total findings:** 2 BLOCKERs (process), 9 WARNINGs, 0 CONVENTIONs, NITs below
**Fixed:** 9 | **Deferred:** 0 | **Decided (ruled):** 2 | **Asked (awaiting user):** 0

The loop converged once at iteration 4 (proof at 0ef783edc). The PR's runner then FAILED the new rootOk check
({"gutter":15,"sbw":0}): the scratch-scroller probe copied from #4076 reads 0 on a runner that hides element
scrollbars while the root reserves 15px, and main's full run fails boot-no-flash and plus-bar-3837 the same way.
Iterations 5 to 8 review the replacement: the root's own stable-gutter width, in all three checks.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
- [WARNING] browser-checks-gutter-yardstick.test.js: the third yardstick copy was unpinned --> FIXED (fc5b02f2a)
- [WARNING] docs/browser-checks/render-tasks-view-3559.js: "window edges" wording --> FIXED (fc5b02f2a)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs
- [WARNING] docs/browser-checks/README.md: the row said window edges --> FIXED (1cbe75237)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
- [WARNING] the gutter strip called "a separate card" that did not exist --> FIXED (03456037c, filed #4216)
- [WARNING] the pin test guarded the copied text, not its use --> FIXED (03456037c)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0. Converged at 03456037c. The runner then failed rootOk; the yardstick was replaced in all
three checks (47dcb27c9, Liu Kang approved the widened scope m1752).

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
- [WARNING] the change is unproven on the classic-scrollbar runner --> merge condition recorded: the PR run
  must select and pass all three checks, and tasks-view's rootOk must read gutter 15 / sbw 15 (not 0/0)
- NITs fixed (308559a88): guard spelling, unsupported-engine comment, docstring, plan's Change marked superseded

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 2 BLOCKERs (process), 1 WARNING, 0 CONVENTIONs, 1 NIT
- [BLOCKER] the proof was stale for the new head --> resolved by this proof (never hand-edited)
- [BLOCKER] commits pushed onto a branch with an open PR (CLAUDE.md) --> RULED: Liu Kang m1769, keep #4222
  (same fix for the same failing check, directed there); head-moved note posted on the PR
- [WARNING] no full validation on the new approach --> FIXED: 6j passed on 1bdb0bcb2 (above)
- NIT fixed (6c7f959a5): the measurement marker is pinned as appearing exactly once

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 NEW WARNINGs (2 duplicates: the ruling, the runner condition), 4 NITs
- NITs fixed (1bdb0bcb2): guard covers overflow-y:scroll and setProperty; the root's whole style attribute is
  restored; a comment made literal. Accepted: dense one-line copies (the cost of pinned copies).

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0. Its BLOCKER (stale proof), WARNING (runner) and CONVENTION (push after open) and NIT (three
copies) are duplicates of ledger entries 8, 7, 9 and the accepted NIT.
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | browser-checks-gutter-yardstick.test.js | BRANCH | third copy unpinned | FIXED | fc5b02f2a |
| 2 | 1 | WARNING | docs/browser-checks/render-tasks-view-3559.js | BRANCH | "window edges" wording | FIXED | fc5b02f2a |
| 3 | 2 | WARNING | docs/browser-checks/README.md | BRANCH | README row wording | FIXED | 1cbe75237 |
| 4 | 3 | WARNING | docs/browser-checks/render-tasks-view-3559.js | BRANCH | "separate card" not filed | FIXED | 03456037c (#4216) |
| 5 | 3 | WARNING | browser-checks-gutter-yardstick.test.js | BRANCH | use unguarded | FIXED | 03456037c |
| 6 | runner | WARNING | three checks | BRANCH | scratch scroller reads 0 on the runner | FIXED | 47dcb27c9 |
| 7 | 5 | WARNING | three checks | BRANCH | unproven on runner | FIXED | merge condition |
| 8 | 6 | BLOCKER | .claude/plans/rtv-4213-pre-challenge.md | BRANCH | stale proof | FIXED | this proof |
| 9 | 6 | BLOCKER | branch | BRANCH | push after PR open | RULED | Liu Kang m1769 |
| 10 | 6 | WARNING | plan | BRANCH | no validation on new approach | FIXED | 6j on 1bdb0bcb2 |

### Outstanding questions
None. The gutter strip's colour is a product question filed as #4216, outside this change.

### NITs (non-blocking)
- guard spellings, restore of the whole style attribute, exactly-once marker, literal comments (all fixed)
- the three measurement copies are dense single lines, pinned as text (accepted)

### Strengths
- The root cause was read off the runner's own log and main's full run, not assumed.
- The gutter is the difference of the root's width without and with a stable gutter, so a margin cancels.
- The pin test guards identity, order, the finally, exactly-once, and the use in tasks-view; each seen failing.

### Not proven here
This Mac draws overlay scrollbars (gutter 0, sbw 0). Only the PR's runner job proves the fix.
