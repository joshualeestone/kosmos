---
pre_challenge: true
method: challenge-loop
branch: win32-prune-rows-2720
diff_hash: adfc684146e737d180a252da253c95ec1d1494e51e6469f51334cf95e07d4f5e
validation: passed
subdir_audit: passed
timestamp: 2026-09-11T02:09:12Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (round 2: "NO NEW FINDINGS")
**Total findings:** 2 (1 CONVENTION, 1 NIT)
**Fixed:** 2 | **Documented as residual:** none (the one-supervisor assumption is recorded in the plan's Weakest part) | **Asked (awaiting user):** 0

`diff_hash` is sha256 of `git diff 2f841189 HEAD -- . ':!.claude/plans/win32-prune-rows-2720-pre-challenge.md'`
at 80795ff7. That is the branch's full change from its merge-base with `main`, with
this proof file left out. The pre-challenge-gate hook is not installed on this
Windows box, so the recipe is written out here. The branch was rebased onto main after the
loop converged, so the commit ids in the breakdown below are from before that
rebase. Every commit subject names its round.

**Validation of record:**
- All 16 win32 suites after the rebase onto main 2f841189: 289/289.
- The full suite on the Windows box against `main`: no new failure. On main 2f841189, 5924 tests with 796 failing; on the branch, 5929 tests with the same 796 failing, with identical failing names.
- macOS CI on the PR.

**Live on the box:** with the shared engine pointer on this branch, one task cycle
(a fresh start) cut winstream-1's ownership rows from 26 to 1, which is the
session just started. The card stayed idle. The pointer then went back to main,
and all 5 cards read idle.

**Control runs:** each fix has a test that fails when the fix is removed:
- the prune call removed;
- the prune also run on a resume;
- the name filter removed;
- always rewrite, even with nothing to drop.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- It confirmed the premise holds in production:
  - `blockedBy` runs before every launch;
  - the agent task is IgnoreNew;
  - the detached `launch()` path is not selected;
  - a rekey cannot land between the launch and the prune.
- It confirmed create is unaffected: `awaitSession` finds the kept new row, and
  the rollback uses that same id. The lock and the closure are also correct.
- [CONVENTION] The comment said the other rows were for sessions that "have
  ended". `blockedBy` only proves none is LISTED, and a new session takes up to
  about 5s to appear. --> FIXED ae0c9b5d: the comment and the plan now say
  "listed", and the plan's Weakest part covers the gap and the one-supervisor
  assumption.
- [NIT] "This row belongs to agent X" was written out by hand three times.
  --> FIXED ae0c9b5d: one `win32sessions.rowIsUnder`, used by the prune, the
  supervisor's `ourLiveSession`, and create's `awaitSession`. A control (always
  false) fails tests in all three callers.

#### Iteration 2
**Reviewer model:** sonnet
**NO NEW FINDINGS.** The reviewer checked:
- `rowIsUnder` behaves the same at all three call sites. Removing its
  `Boolean(row)` guard crashes an existing test, so that guard is covered.
- `pruneName` edge cases: an empty record, malformed rows, and `keepIds` that
  contain another agent's ids.
- A missing-array call-site mutation is caught by two tests.
- The prune runs synchronously with the fresh start, so no rekey can land between
  them.
- Test isolation, and that production wiring uses the real `win32sessions`.

### Strengths (across all iterations)
- One locked rewrite (`pruneName`) through the same `rewrite()` every record
  write uses.
- The keep set rests on a guarantee the code already enforces: a fresh start
  happens only after `blockedBy` has seen none of this agent's sessions live. So
  it needs no second reading of the live list.
- Every failure reaches the task log and never undoes a start.
