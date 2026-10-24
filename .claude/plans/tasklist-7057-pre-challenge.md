---
pre_challenge: true
method: challenge-loop
branch: tasklist-7057
diff_hash: 6266d0c728c0e5e6c90e5fed0ea623dc769616ddc88c0091ae0c3771390bd741
validation: passed
subdir_audit: passed
timestamp: 2026-10-24T21:42:09Z
iterations: 1
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 blind review (opus, 15:47 CDT): 0 BLOCKER, 4 WARNING, 4 NIT, all taken. **Converged: no**: the fixes were not reviewed again. Every finding and decision is in .claude/plans/tasklist-7057.md.

**Validation of THIS diff:** the Mortals full suite on head 6d6b47340f (base 59e599d67f): 23840 tests, 0 failed (23506 passed, the rest skipped), hash 6266d0c728c0, which is this proof's diff_hash (computed with the gate's own command, never typed).

**Earlier validation, stated exactly:** a run for f1d0c57647 (before review 1) was stopped mid-suite on Mortals once its head was superseded, so it has no result; nothing is claimed for it.

**Mutants (each turned a named test red, then restored):** token-only scoping removed; the archived filter removed; quietDays keeping every group instead of open; the threshold ignored; createdAt in place of lastActivityOf; .some in place of .every on the token arm; quietDays dropped from the bash one-project URL.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] last activity never tested against a transcript --> FIXED (an ordinary event leaves the stale list; a missed note does not count)
- [WARNING] the every-record token rule not pinned --> FIXED (duplicate-id fixture with a board-token control; nobody-token 403)
- [WARNING] Mac one-project --stale only run against a URL-blind stub --> FIXED (real board)
- [WARNING] an older board's "say which project" to a token-only --all read as a missing project --> FIXED (both CLIs name the older board)
- [NIT] an older Mac engine module gave the wrong advice --> FIXED (checks for acrossLines, as Windows does)
- [NIT] all/quietDays with view=tasks silently ignored --> FIXED (400)
- [NIT] the #4491 comment still said one project --> FIXED
- [NIT] --all "" differed between the CLIs --> FIXED (in the parity test)
