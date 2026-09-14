---
pre_challenge: true
method: challenge-loop
branch: tasks-copy-2708
diff_hash: 50e0452a53a513c2719e96f50d651737fb71583b2805de04205291afb0ce83b3
validation: passed
subdir_audit: passed
timestamp: 2026-09-11T01:41:15Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2 surfaced zero BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 1 WARNING (iter 1) actionable, plus NITs
**Fixed:** all actionable | **Deferred:** 0 | **Asked:** 0

Reviewer models rotated (kosmos#2032): opus, sonnet.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 WARNING (+ strengths)
**Self-generated:** 0 (the finding is about the initial feature commit)
- [WARNING] engine/projects.js - hasTasks uses raw p.tasks length (open + closed); a closed-only project would emit "Its tasks: kosmos task list ... to see them", a broken promise IF task list filters to open-only --> RESOLVED (6578b335): verified it does NOT - install/kosmos:1486 renders closed tasks with a [done] prefix, so a closed-only project genuinely has tasks to see and raw length is the RIGHT condition (an open-only count would say "No tasks set" while the list shows them). Documented in the code comment + plan weakest premise, and added a closed-only test.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKER, 0 WARNING, 0 CONVENTION (2 NITs)
**Self-generated:** 0
**Converged** - the reviewer independently verified the raw-length-includes-closed premise against server.js:9683 (the /api/tasks route keeps closed tasks), engine/tasks.js allTasks, and install/kosmos:1486, and confirmed the new tests red-capable by reverting the source. One NIT applied (82b9eac8): the membershipLine test used kind 'added' instead of the real 'joined'; the other NIT (the closed-only test is a documentation-via-test regression guard) was kept as-is.

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/projects.js | BRANCH | raw task count vs closed-only subclass | RESOLVED | 6578b335 (verified + documented) |

### NITs (non-blocking)
- The closed-only test does not exercise different branching (hasTasks ignores open/closed); kept as a documentation-via-test regression guard. (iteration 2)
- membershipLine test used kind 'added'; changed to the real 'joined'. (iteration 2, fixed 82b9eac8)

### Strengths (across iterations)
- The "raw length includes closed" premise is verified correct against two real call paths (the /api/tasks route keeps closed tasks; install/kosmos renders them with [done]), so a closed-only project genuinely has tasks to see and the copy is honest.
- The new test branches (taskless / tasks-bearing / closed-only / id-less / membershipLine) were confirmed red-capable by reverting the source (both the block copy and the membershipLine copy failed, then passed once restored).
- The id-less branch is unchanged and correctly suppresses the whole task section (including the new "No tasks set" line), since taskLine is spliced only inside the pre-existing p.id ternary; a negative assertion locks it in.
- The change is precisely scoped to the two sites the plan names, with comments that accurately describe both the code and the verified external facts.
