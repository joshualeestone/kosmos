---
pre_challenge: true
method: challenge-loop
branch: restorelive-7816
diff_hash: ea7856d42856b8bce2dafe0e778a89302a895e7fc4d69264d723922026eebbf6
validation: passed
subdir_audit: passed
timestamp: 2026-11-03T04:37:46Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes
**Total findings:** 6 actionable (0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, plus 2 NITs acted on as defects), 10 NITs in all
**Fixed:** 4 | **Deferred:** 2 | **Asked (awaiting user):** 0

Validation note: per the queue rule on this Mac (one full suite at a time, others' runs queued; memory
feedback-one-suite-per-mac-queue-discipline), each iteration ran the focused tests (web.pbrestore-7404.test.js, the
render-pbrestore-end-7801.js browser check in Chromium and WebKit, the browser-check wiring tests) and the full suite ran
at 6j. The first 6j run went red on three web.plus-stale tests (that file's fake element had no setAttribute, which the
Off reset now calls); fixed in d44474c6c2 and the second 6j run passed: 26583 tests, 0 failed, build passed.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [NIT] web/index.html (pbfPaint comment) - the comment claimed a switch waiting across Off does nothing, which held only if the timer ran before the next answer --> FIXED by deleting the claim (61a2bb3068), and the throttled order pinned in a test
- [NIT] web.pbrestore-7404.test.js - Off, On and a new answer before the held timer untested --> FIXED (61a2bb3068)
- [NIT] render-pbrestore-end-7801.js - observer never disconnected

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html - liveSoon borrowed across Off then On --> DEFERRED: the guarantee is a switch never in a write's task and never before the quiet first fill; both hold, and iteration 1's test pins it
- [WARNING] render-pbrestore-end-7801.js - the observer read aria-live after the write's task, so "polite when the end is written" could not fail alone --> FIXED (dd3dd0beb), read inside the setter; a mutant writing while off then flipping in the same task reds only that assertion, both engines
- [CONVENTION] web/index.html - unguarded getElementById in Off --> DEFERRED: static markup, and pbfShow's first line looks up #pb-files the same way
- [NIT] plan file wording; [NIT] repeated setAttribute('off') while not live

#### Iteration 3
**Reviewer model:** fable
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 0 of the above
- [CONVENTION] docs/browser-checks/README.md - the check's row lacked the #7816 claims --> FIXED (83dd142489)
- [NIT] render-pbrestore-end-7801.js - the "first fill" label named a fill that does not happen --> FIXED (83dd142489), renamed to the first paint with the answer
- [NIT] web.pbrestore-7404.test.js - painter() left real timers running after tests --> FIXED (83dd142489)
- [NIT] test name; [NIT] repeated attribute write

#### Iteration 4
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [NIT] web.pbrestore-7404.test.js:581 - test name says "no paint between", the setup is "no timer turn between"
- [NIT] web.pbrestore-7404.test.js:122 - say that a polite-state test must pass timers()
- [NIT] web/index.html - say liveSoon is left alone at Off on purpose
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | NIT | web/index.html (pbfPaint) | SELF | comment over-claimed the Off case | FIXED | 61a2bb3068 |
| 2 | 2 | WARNING | web/index.html (pbfPaint) | BRANCH | liveSoon borrowed across Off/On | DEFERRED | guarantee holds; tested |
| 3 | 2 | WARNING | docs/browser-checks/render-pbrestore-end-7801.js | BRANCH | aria-live read after the write's task | FIXED | dd3dd0beb |
| 4 | 2 | CONVENTION | web/index.html (pbfShow) | BRANCH | unguarded getElementById | DEFERRED | static markup, same as pbfShow's first line |
| 5 | 3 | CONVENTION | docs/browser-checks/README.md | BRANCH | row lacked the #7816 claims | FIXED | 83dd142489 |
| 6 | 6j | BLOCKER | web.plus-stale.test.js | BRANCH | final-validation: three tests red, fake element had no setAttribute | FIXED | d44474c6c2 |

### NITs (non-blocking, across all iterations)
- [NIT] render-pbrestore-end-7801.js - observer never disconnected (iteration 1; observer since replaced by the setter)
- [NIT] plan file - mutants not named per test (iteration 2)
- [NIT] web/index.html - setAttribute('off') on every paint while not live (iterations 2, 3)
- [NIT] web.pbrestore-7404.test.js - test name and timers() note (iteration 4)
- [NIT] web/index.html - a comment at Off on liveSoon (iteration 4)

### Strengths (across all iterations)
- The switch to polite goes through one guarded zero-delay callback, never sharing a task with a write (iterations 1-4)
- Held timers make each task boundary deterministic; every new test has a CONTROL and goes red under its own mutant (iterations 1, 2, 4)
- The browser check reads aria-live inside the write, in Chromium and WebKit (iterations 3, 4)
- Off resets the line itself; the test no longer clears it by hand (iterations 2, 4)
