---
pre_challenge: true
method: challenge-loop
branch: subprojects-parent-1994
diff_hash: f20011330b5de6eb88610365eb51cb0c846886dbce16c252b1e921118ebf4fef
validation: passed
subdir_audit: passed
timestamp: 2026-09-03T19:19:29Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes — iteration 3 surfaced zero BLOCKER/WARNING/CONVENTION findings.
**Total findings:** 9 (0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 5 NITs)
**Fixed:** 6 | **Deferred:** 3 | **Asked (awaiting user):** 0

Validation: the repo's shipped gate (`bash tools/run-tests.sh`) run green against final
HEAD — JS suite 4116 tests, 0 fail, 0 cancelled, plus the full shell gate, SUITE EXIT=0.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 1 NIT
- [WARNING] engine/projects.subprojects-1994.test.js — no route-level test for PUT forwarding `parent` (cycle → 400 not 500) or DELETE returning 409 through the route; every arm called the engine directly --> FIXED (65f3342f): 5 route arms added to server.projects.test.js
- [WARNING] engine/projects.js — the seen-set bounding the cycle walk over a store that ALREADY holds a loop had no test --> FIXED (65f3342f): engine arm that hand-builds a loop via writeAll and would hang on regression
- [NIT] engine/projects.js — cleanParent coerced any non-string via String(); `{parent: []}` silently un-grouped, `{parent: {}}`/`123` became literal ids --> FIXED (65f3342f): typeof-string guard + type-refusal test
- [CONVENTION] .claude/plans/ — plan file present and aligned with the four settled decisions; no drift --> DEFERRED: informational, not a defect

#### Iteration 2
**New findings:** 0 BLOCKERs, 1 WARNING, 2 NITs
**Duplicates of prior findings (confirmed resolved):** 0
- [WARNING] engine/projects.js:972 — `parentName` resolves regardless of the parent's archived state; archiving a project with children is allowed, so a child can be grouped under a hidden parent. Reviewer noted this is a UI-follow-up concern, not a data-model defect --> FIXED (70f2c5cb): describe now publishes `parentArchived` alongside `parentName` (one lookup) so the board can render a hidden group without re-joining — publishing the fact, not the rendering decision; + test arm
- [NIT] plan — said "12 arms"; 15 ship --> FIXED (70f2c5cb, and a leftover on line 74 in 41d0bd4c)
- [NIT] engine/projects.js — edit reads the store twice (cleanParent + mutate) on a parent-carrying save --> DEFERRED: consistent with the module's read-per-op style, single process, no correctness impact

#### Iteration 3
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Converged** — no new actionable (BLOCKER/WARNING/CONVENTION) findings.
- [NIT] plan:74 — "12-arm" leftover the iteration-2 fix missed --> FIXED (41d0bd4c)
- [NIT] engine/projects.js — parent id derived twice in describe (parent: field + IIFE) --> FIXED (41d0bd4c): derived once into a parentId local
- [NIT] engine/projects.js — double readAll (duplicate of iteration 2's NIT) --> DEFERRED (as above)

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | server.projects.test.js | No route-level test (PUT parent / DELETE 409) | FIXED | 65f3342f |
| 2 | 1 | WARNING | engine/projects.js | Seen-set (pre-existing loop) untested | FIXED | 65f3342f |
| 3 | 1 | NIT | engine/projects.js | cleanParent coerced non-string parent | FIXED | 65f3342f |
| 4 | 1 | CONVENTION | .claude/plans/ | Plan present, aligned, no drift | DEFERRED | Informational |
| 5 | 2 | WARNING | engine/projects.js:972 | Child groupable under archived parent | FIXED | 70f2c5cb (parentArchived seam) |
| 6 | 2 | NIT | plan | Arm count 12 vs 15 | FIXED | 70f2c5cb / 41d0bd4c |
| 7 | 2 | NIT | engine/projects.js | Double readAll on parent save | DEFERRED | By design, module style |
| 8 | 3 | NIT | plan:74 | "12-arm" leftover | FIXED | 41d0bd4c |
| 9 | 3 | NIT | engine/projects.js | parentId derived twice in describe | FIXED | 41d0bd4c |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- All NITs above were either fixed or deferred with reasoning; none outstanding.

### Strengths (across all iterations)
- Cycle detection is correct and provably terminating in every direction tested: it climbs the proposed parent's ancestor chain for `childId` (a cycle exists iff child is an ancestor of the proposed parent), the childId check precedes the seen-check so a real cycle is never masked, and the seen-set bounds a store that already holds a hand-edited loop. (iterations 1-3)
- Atomicity holds: cleanParent throws before mutate, so a mixed {name, parent-invalid} body applies nothing — directly tested. (iterations 1-3)
- Backward compatibility with legacy records lacking `parent` handled everywhere: describe normalizes to null, remove's `p.parent === id` never false-matches undefined, the cycle walk treats a non-string node.parent as chain-end. (iterations 2-3)
- Route tests are non-vacuous and exercise wiring the engine tests cannot; no existing exact-shape/deepEqual project assertion is broken by the new fields; both suites are picked up by run-tests.sh's coverage-count guard. (iterations 2-3)
- The plan is honest that the UI is out of scope and keeps #1994 open under the "done means the operator can use it" bar. (iterations 2-3)
