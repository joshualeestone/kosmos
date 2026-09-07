---
pre_challenge: true
method: challenge-loop
branch: task-activity-768
diff_hash: 3b3a7fa920deda5e4633ec891c0a4fc5af6c9218cd07ed0eb405c4e3956691f2
validation: passed
subdir_audit: passed
timestamp: 2026-09-07T13:33:14Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (plus a 6j final-validation catch)
**Converged:** Yes (iteration 2 produced zero new BLOCKER/WARNING/CONVENTION; the 6j final validation then caught one repo-wide gate violation, fixed, re-validated green)
**Total findings:** 5 (0 BLOCKERs from review, 1 WARNING, 0 CONVENTIONs, 3 NITs, + 1 synthetic BLOCKER from 6j)
**Fixed:** 3 | **Deferred:** 3 (NITs) | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
- [WARNING] web/index.html paintTaskActivity — the stale-fetch `n !== TK_OPEN` guard was present after the `fetch` await but NOT after the `res.json()` await, so a task switch during body-parse could paint the old task's events --> FIXED (commit d4369158; added a test that flips TK_OPEN inside json() to exercise the second-await guard)
- [NIT] #tk-activity aria-live re-announces the whole list --> DEFERRED (reviewer: acceptable, consistent with the page's other live regions)
- 3 STRENGTHs: escaping complete + real XSS control; meaningful tests with dangerous-answer controls; no refresh/poll regression.

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Converged** — no new actionable findings.
- [NIT] the `<time datetime>` attr does not gate on isFinite(at) --> DEFERRED (unreachable via the route: taskchat.read drops rows whose `at` is not a finite Date.parse, so the render never sees a malformed `at`)
- [NIT] aria-live verbosity (dup of iter-1) --> DEFERRED
- [NIT] server route returns a few fields the UI doesn't read --> DEFERRED (by design; transcript API; no leak — exposes nothing the existing task routes didn't)
- 5 STRENGTHs: escaping complete; BOTH stale-fetch guards present + independently tested; correctness end-to-end (keying, field names, oldest-first, fail-soft); scope discipline matches the plan; the browser-check genuinely waits for the async row and can fail.

#### 6j — Final validation catch (the safety net working)
The full-suite final validation went RED on `fixture-discipline.test.js`: `no test builds
an agent card or a roster row by hand`. `web.task-activity-768.test.js` hand-built a
roster row (`PROJECT.agents = [{ sessionName: ... }]`), which the gate forbids (a
hand-built row is free to carry or miss fields the real producer never would). Only the
FULL suite catches this — the gate scans every test file — which is why the isolated test
runs and the blind reviews (which reviewed logic, not the repo-wide gate) passed, and 6j
caught it.
- [BLOCKER] fixture-discipline: web.task-activity-768.test.js hand-built a roster row -->
  FIXED (commit 43dfac6a: build PROJECT from the real producer — fleet.install +
  projects.describe — matching web.task-page.test.js, with a sandbox for the roots those
  engines read at require time). Re-validated: full suite 5029/5029 green.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html paintTaskActivity | stale-fetch guard missing after res.json() await | FIXED | d4369158 (+ second-await test) |
| 2 | 1 | NIT | web/index.html #tk-activity | aria-live re-announces whole list | DEFERRED | acceptable, matches page's live regions |
| 3 | 2 | NIT | web/index.html paintTaskActivity | `<time datetime>` not gated on isFinite(at) | DEFERRED | unreachable — read() drops bad-at rows |
| 4 | 2 | NIT | server.js activity route | returns fields the UI doesn't read | DEFERRED | by design; transcript API; no leak |
| 5 | 6j | BLOCKER | web.task-activity-768.test.js | hand-built roster row (fixture-discipline) | FIXED | 43dfac6a (real producer) |

### Outstanding questions (ASKED, still unresolved when the run ended)
- None.

### NITs (non-blocking, across all iterations)
- aria-live verbosity (iter 1/2) — DEFERRED
- `<time datetime>` on the unreachable malformed-at branch (iter 2) — DEFERRED
- wide transcript response (iter 2) — DEFERRED

### Strengths (across all iterations)
- Escaping is complete and correct at the render site (the RAW-text store's contract), with a real XSS dangerous-answer control in the tests.
- Both stale-fetch guards (after fetch and after res.json()) are present and independently tested.
- Correctness end-to-end: same (id, number) keying as the record side, matching field names, oldest-first order, genuine fail-soft (200 + [] for a missing transcript).
- Scope discipline matches the plan / #768: read-only route + additive list, no three-column reflow, no due date, no conversation composer; the pre-existing "no due date field" test still passes.
- The browser-check drives the real board and genuinely waits for the async activity row (can fail on timeout or a missing "Created").
