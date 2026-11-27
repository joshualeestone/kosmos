---
pre_challenge: true
method: challenge-loop
branch: builtnotice-9178
diff_hash: 9908d78301257cce4c7f49100f9a6c6a56a7da578804f55a072656f518918463
validation: passed
subdir_audit: passed
timestamp: 2026-11-27T06:57:06Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (round 3 raised no BLOCKER and no WARNING)
**Total findings:** 0 BLOCKERs, 4 WARNINGs (all fixed), NITs fixed or accepted with reasons; in full in .claude/plans/builtnotice-9178.md
**Asked (awaiting user):** 0

### Validation
- Full validation: passed on this Mac 00:51 CST 2026-11-27 (validate-requeue.sh, rc 0, audit rc 0, head b25a7b200b, hash 9908d7830125; 0 node failures, four shell shards green). Only this proof file changed after it.
- subdir CLAUDE.md audit: passed.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus

- [WARNING] the new holder was excepted even when its heard line did not go out (budget skip, COULD_NOT) FIXED
- [WARNING] the agent-adds test expected what the control expects, so it could pass with no notice: a third holder now must be owed one FIXED
- [WARNING] droppedBuiltForWork was only ever stubbed: a real-engine test now pins it (add, give open, keepBuilt refusal, put back, a fresh read) FIXED
- [NIT] the `except` names trimmed; the failover-source exclusion documented as a backstop (the Assigner refuses a built task inside the write) FIXED

#### Iteration 2
**Reviewer model:** opus

- [WARNING] no test drove an UNCONFIRMED heard line at either site (a mutant dropping it passed): tested now, the mutant fails FIXED
- [NIT] a stale test comment FIXED
- [NIT] an UNCONFIRMED paste that is never submitted leaves no re-read: accepted (counted as went, the side that avoids a duplicate)

#### Iteration 3
**Reviewer model:** opus

- No issues found at BLOCKER or WARNING.
- [NIT] an adder that cannot be named is owed a re-read of its own change: accepted (one redundant notice, never a missed one)
- [NIT] `except` matches names exactly while owesNotice matches by key: accepted (who is stored trimmed and exact)
