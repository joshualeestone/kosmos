---
pre_challenge: true
method: challenge-loop
branch: helpleak-7980
diff_hash: 755a9fb0831950d70d13b3062d1db42da2bd3edfaf10082214d1b55bec98f229
validation: passed
subdir_audit: passed
timestamp: 2026-11-05T01:22:57Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 1 actionable (1 BLOCKER from the closing gate), 6 NITs
**Fixed:** 1 | **Deferred:** 0 | **Asked (awaiting user):** 0

Baseline (6.0): full suite passed on 51cc36cd16 (26700 pass, 0 fail). Closing gate (6j): the first run failed one guard,
cli.sandbox-data-4796 (the subshell harness spawned bash with the parent environment and no data root of its own);
fixed in 037f5ee059 by giving it AGENT_WORKFORCE_DATA; the rerun passed (26701 pass, 0 fail).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [NIT] install/kosmos:4359 - the comment called the help re-dispatch "above" (it is below) --> fixed (ca2eae199f)
- [NIT] install/kosmos:4361 - "nothing this command starts inherits it" was not pinned by a test --> fixed: a child of the command does not inherit the marker; fails with the unset removed (ca2eae199f)
- [NIT] cli.community-exit-reason-7967.test.js:253 - the harness cutter checked only the start of a function --> fixed (ca2eae199f)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Converged** - no new actionable findings.
- [NIT] install/kosmos:4361 - the re-dispatch pointer names a direction, not the handler
- [NIT] cli.community-exit-reason-7967.test.js:253 - the cutter assumes no column-0 brace inside the function bodies
- [NIT] cli.community-exit-reason-7967.test.js:259 - harness scripts live under the sandbox DATA dir

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 6j | BLOCKER | final-validation: yarn test | BRANCH | #4796 guard: harness without a data root | FIXED | 037f5ee059 |

### NITs (non-blocking, across all iterations)
- [NIT] the re-dispatch pointer names a direction, not the handler (iteration 2)
- [NIT] the cutter assumes no column-0 brace inside the two function bodies (iteration 2)
- [NIT] harness scripts live under the sandbox DATA dir, swept by tmpscope (iteration 2)

### Strengths (across all iterations)
- The marker is honoured only for the bare verb, the one shape the --help re-dispatch runs, and is unset before the command runs (iterations 1, 2)
- The harness drives the real say, _community_reason_line and cmd_community_with_reason cut from install/kosmos, with a control (iterations 1, 2)
- Each test fails on its mutant: the `$# -eq 0` dropped, the BASH_SUBSHELL check dropped, the unset removed (iterations 1, 2)
