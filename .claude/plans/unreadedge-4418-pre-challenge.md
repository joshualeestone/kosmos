---
pre_challenge: true
method: challenge-loop
branch: unreadedge-4418
diff_hash: 79c8c10579614db9338ef46e7362121f4115ded898c296a96859436b1580da3e
validation: not run locally before the PR (urgent, for the 0.7.07 freeze, with another agent's suite on this Mac); CI's full suite gates the merge
subdir_audit: not run locally; CI
timestamp: 2026-09-28T20:33:39Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2: one NIT)
**Total findings:** 1 WARNING (deferred to its owner), plus NITs
**Fixed:** 0 actionable (3 NITs taken) | **Deferred:** 1 | **Asked:** 0

Card #4418 (Josh, for 0.7.07): the gold unread edge (#3743) is switched off everywhere (DMs, project rooms, the setup
guide). UNREAD_EDGE_ON false makes unreadEdgeApply, the one place a message is marked data-unread, return at once.

Validation, stated plainly: NOT run locally before the PR. The change is a flag plus tests. What was run locally:
- the new unit test (4 of 4, including a control);
- the browser-check index, wiring and reason-grep tests;
- a parse of the page.

CI's full suite must be green before merge.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] web/whats-new.json still says "an unread message has its gold outline again" --> DEFERRED: Baron owns that
  line and asked me not to edit it (his branch wnunread-4418, pushed 9fbcf478d); the 0.7.07 cut refuses to freeze while
  main still says "gold outline".
- NITs taken: a test that unreadEdgeApply is the only setter of data-unread; the CSS comment and README row say the
  check is unwired while the edge is off.
- NIT noted: with the switch off, the backlog and fresh bookkeeping is never pruned, so flipping the switch back on
  mid-session could mark stale messages. It is a build-time flag; this is written down for whoever turns it back on.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 1 NIT (the "no other spelling" regex has no positive control)
**Converged.**

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/whats-new.json | BRANCH | tile says the gold outline is back | DEFERRED | Baron's line, his branch (9fbcf478d); the freeze refuses it |
