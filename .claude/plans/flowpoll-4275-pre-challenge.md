---
pre_challenge: true
method: challenge-loop
branch: flowpoll-4275
diff_hash: 4cb678975739ab64922537346a4c7df4ddff2b6cf8bb101bc777f532eb8d3302
validation: passed
subdir_audit: passed
timestamp: 2026-09-28T04:42:29Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes
**Total findings:** 2 actionable (2 WARNINGs), 3 NITs
**Fixed:** 4 | **Deferred:** 0 | **Asked (awaiting user):** 0 | **Not changed (already covered):** 1

Evidence: web.flowpoll-4275.test.js runs the page's own acctAddStart, acctFlowPaint, acctFlowWatch and
acctFlowStop with a fake fetch and interval and counts polls. Control (origin/main page): 4 of 5 behaviour
arms red. Mutants: start guard dropped -> the 3 ended-start arms red; dedup stop dropped -> the
watch-over-ended arm red; stop-on-any-repeat -> the active-flow control red; either handler's
acctFlowWatch() removed, or left only in a comment -> the handler pin red. Related suites
(web.accounts-add, web.connect-success-1656, web.reauth-1492, server.connect): 79/79.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
- [WARNING] code and cancel handlers reset ACCT_FLOW_LAST relying on a poll left running by the start. Fixed: both call acctFlowWatch(); pinned.
- [WARNING] frConnActive hand copy of ACTIVE_PHASES carries more weight. Not changed: parity asserted by server.connect.test.js:134, and a missing phase already stopped the poll on its first paint.
- [NIT] a test comment said "every caller". Fixed.

#### Iteration 2
**Reviewer model:** opus
- [NIT] the handler pin could be satisfied by a comment. Fixed: comments stripped, call must start a line.
- [NIT] the acctFlowPaint comment named a path that no longer reaches it. Fixed.

#### Iteration 3
**Reviewer model:** sonnet
- No findings.
