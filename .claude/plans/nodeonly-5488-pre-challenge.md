---
pre_challenge: true
method: challenge-loop
branch: nodeonly-5488
diff_hash: 4bd57f89a7a66e1d5b325cde06142e74c50597b577f20e0a607af3a2c13122c1
validation: passed (focused, at this head: test-ci-runner-route-5488 17 ok incl. 5 arms running the REAL tmux step body, test-ci-runner-job-guard-5488 28 ok, test-ci-plans-only-reuse-5488 35 ok, tools.shell-shard-4317 12/12. Two red-checks: the old tmux step reds the route test via its pin; the guard changed to exit 0 in both workflow and pin reds the behaviour arm alone. The routing expression's every case is traced in both reviews; the live validation is the first node-only run on the self-hosted Mac after the switch goes on, measured on #5488)
subdir_audit: passed
timestamp: 2026-10-08T01:47:21Z
iterations: 2
converged: true
---


## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (opus, sonnet; each a fresh blind agent)
**Converged:** Yes (iteration 2: no BLOCKER, WARNING or CONVENTION; 3 NITs, all fixed)
**Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [NIT] the self-hosted arm accepted any non-zero exit (a missing step file exits 127 and would print ok) --> FIXED: wants rc=1 and the ::error:: line, and a guard fails the block when the step body was not extracted
- [NIT] PATH kept /usr/bin:/bin, needing a precondition that fails on hosts with a system tmux --> FIXED: stub-only PATH, bash by absolute path
- [NIT] the wiring pass message did not name the new rule --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
- [NIT] the plan still described the removed precondition --> FIXED
- [NIT] the "unset" arm sets RUNNER_ENVIRONMENT empty --> FIXED: labelled empty; the step treats both alike
- [NIT] the refusal could mislead when tmux is installed but off the runner's PATH --> FIXED: "(or not on its PATH)"

### Strengths
- [STRENGTH] the test runs the real step body from the parsed workflow, with a stub brew that records calls, and controls on both runner types
- [STRENGTH] every fallback (scope empty or failed, RUNNER_ENVIRONMENT unset) lands on the old behaviour
