---
pre_challenge: true
method: challenge-loop
branch: actwrap-8731
diff_hash: 31fb17c02e9219b8c396eb08ff449125d996ffc94b01df3f8ebfd2f1da7066a1
validation: passed
subdir_audit: passed
timestamp: 2026-11-19T16:16:30Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 3 (0 BLOCKERs, 1 WARNING, 2 CONVENTIONs, 5 NITs)
**Fixed:** 3 | **Deferred:** 0 | **Asked (awaiting user):** 0

Full validation ran once after convergence (run-tests node suite and the four shell shards), on HEAD a70be6c3a9:
PASSED, hash 31fb17c02e92. The browser-check gate and the surface gate both passed (bash -c, as CI runs them).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 2 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above (ITER_COMMITS was empty)
- [WARNING] docs/browser-checks/render-tasks.js:376 — the step compared the row with its own clientWidth, so a row that GREW to fit the token passed --> FIXED (a70be6c3a9): it also compares the row's right edge with the activity list's, and the list's own scroll width. Proven both arms: green with the fix; red with the fix removed and min-width: auto (row scrollW 2143 == clientW 2143, right 2667 > list right 885).
- [CONVENTION] web/index.html:6947 — the comment said the check row's .why rule sets overflow-wrap; no .why rule does (the value there is inherited) --> FIXED (a70be6c3a9): claim removed.
- [CONVENTION] web.task-activity-wrap-8731.test.js:8 — the header said every activity row is measured; one is --> FIXED (a70be6c3a9).
- [NIT] web.task-activity-wrap-8731.test.js:20 — effective() sees only the exact selector text; the browser check is the real guard --> addressed in the test header (a70be6c3a9).
- [NIT] measurement history in source comments --> trimmed (a70be6c3a9).

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Converged** — no new actionable findings.
- [NIT] web.task-activity-wrap-8731.test.js:16 — readFileSync relative to cwd (the same form its sibling web.* tests use).
- [NIT] render-tasks.js:370 — a slow send and a missing row give the same failure message (matches the existing SAID step).
- [NIT] render-tasks.js:385 — only the 1280px viewport is measured; the same single rule governs the phone layout.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | docs/browser-checks/render-tasks.js:376 | BRANCH | a grown row passed the check | FIXED | a70be6c3a9 |
| 2 | 1 | CONVENTION | web/index.html:6947 | BRANCH | comment cited a .why rule that does not exist | FIXED | a70be6c3a9 |
| 3 | 1 | CONVENTION | web.task-activity-wrap-8731.test.js:8 | BRANCH | header said every row is measured | FIXED | a70be6c3a9 |

### NITs (non-blocking, across all iterations)
- [NIT] web.task-activity-wrap-8731.test.js:20 — cascade helper scope (iteration 1, addressed)
- [NIT] measurement history in comments (iteration 1, addressed)
- [NIT] cwd-relative readFileSync (iteration 2)
- [NIT] one failure message for slow send and missing row (iteration 2)
- [NIT] phone viewport not measured (iteration 2)

### Strengths (across all iterations)
- One property on the rule that already had min-width: 0, matching the task page's sibling rows (iteration 1)
- The browser step cannot fail silently: a swallowed wait is followed by a loud die (iterations 1 and 2)
- The static test names its own blind spot and points at the rendered guard (iteration 2)
