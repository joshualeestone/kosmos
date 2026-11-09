---
pre_challenge: true
method: challenge-loop
branch: doneparts-8301
diff_hash: f270b77058b1fbb442a49abae4b0d6bb114b02c0cf0686cd8f35a7e485dc1a73
validation: passed-except-one-unrelated-timing-test
subdir_audit: passed
timestamp: 2026-11-09T21:07:01Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8, the review cap. Rounds 1 to 3 here are four reviewer launches (opus, opus, sonnet, haiku), so the true count is 9 launches.
**Converged:** No. Stopped at the cap. Round 8's one real finding is fixed and was not reviewed again.
**Fixed:** all BLOCKERs. **Deferred:** listed below. **Asked (awaiting user):** 0

Validation: full suite on the last code head before the final rebase: 28279 tests, 27838 pass, 1 fail, the rest skipped. The one failure is engine/connect.win32signin.test.js, a 15 s Windows sign-in timing test in a file this branch does not touch; it passes alone (19 of 19). The earlier full run on this branch found three real failures, all fixed. PR CI runs the full suite on the exact head.

### Per-Iteration Breakdown

#### Iterations 1 to 3
**Reviewer model:** opus, opus, sonnet, haiku
- [BLOCKER] the first design inferred "never ran" from missing evidence and mislabelled a parent whose children did the work, a plain close and a reopened task --> FIXED, rebuilt as an explicit --not-run
- [WARNING] replaced tasks were not counted --> FIXED

#### Iteration 4
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 5 WARNINGs, 3 NITs
- [BLOCKER] web/index.html:72241 -- no browser check asserted the change --> FIXED, render-subtasks-3861.js
- [WARNING] engine/tasks.js:255 -- "closed without running" was false for a replaced task that ran --> FIXED, word changed
- [WARNING] engine/holdstale.js:155 -- the flag was never taught --> FIXED; the screen control is DEFERRED
- [WARNING] engine/tasklist.js:201 -- a not-run child read done --> FIXED
- [WARNING] engine/tasks.js:1177 -- no history, close time overwritten --> FIXED
- [WARNING] web.subtasks-3861.test.js:322 -- display paths untested --> FIXED

#### Iteration 5
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 1 WARNING, 1 NIT
- [BLOCKER] engine/taskactphrase.js:104 -- the engine copy of the history phrases lagged the page --> FIXED
- [WARNING] engine/holdstale.js:155 -- assumed the task never ran --> FIXED, conditional

#### Iteration 6
**Reviewer model:** haiku
**New findings:** 2 WARNINGs, 1 CONVENTION, 2 NITs
- [WARNING] engine/holdstale.js:166 -- the hint broke a pasted command --> FIXED, its own sentence
- [WARNING] tools/windows/kosmos-cli.js:1505 -- no warning on a very old board --> DEFERRED, in the plan
- [CONVENTION] web/index.html:73207 -- two derivations --> FIXED in iteration 7

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 6 WARNINGs, 1 CONVENTION, 4 NITs
- [WARNING] web/index.html:73405 -- the receipt said done for a not-run task --> FIXED
- [WARNING] web/index.html:72350 -- no mark on the row --> FIXED
- [WARNING] web/index.html:73211 -- the built action was removed --> FIXED
- [WARNING] ios/Kosmos/TaskPageLogic.swift:466 -- raw token in the iPhone history --> FIXED; iPhone counts DEFERRED to #8146
- [WARNING] cli.task-close-many-7412.test.js:1 -- several-at-once untested --> FIXED, and the test found a real Mac bug
- [WARNING] plan -- the card is only partly met while the flag is unused --> DEFERRED, stated in the PR

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 2 NITs
- [WARNING] engine/tasks.js:2213 -- ancestors were not checked for the mark --> FIXED, not re-reviewed (cap)
- [WARNING] web/index.html:4646 -- radius changed for every chip --> deliberate, Mona Lisa's ask, in the plan

### NITs (non-blocking)
- [NIT] install/kosmos:6722 -- several at once does not say "as not run" per task; in the plan
