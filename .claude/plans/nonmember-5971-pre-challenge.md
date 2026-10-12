---
pre_challenge: true
method: challenge-loop
branch: nonmember-5971
diff_hash: 8cacde9c4736dd62460f58f51a0a7d50a7c29a0c4d8e552259431b600551cb03
validation: pending (Mortals run queued; PR CI runs the full suite)
subdir_audit: passed
timestamp: 2026-10-12T17:39:10Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (opus, sonnet)
**Converged:** Yes (iteration 2 raised NITs only, fixed)
**Measured first:** main already refuses giving a task or a part to an agent not on the project (engine/tasks.js create and assignPart); the change is a route-level test with the real engine. The test fails when the engine check is removed (perturbed and restored).

## Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] the test drove the page path (sec-fetch-site), not the agent CLI path the card names --> FIXED (every arm runs on the CLI path, agent token, recorded as a process add, and the page path; the path asserted)
- [NIT] plan named no concrete other way work leaves a project --> FIXED (removed members keep their parts, named on the card)
- [NIT] fake panes and setup order differ from the sibling test --> FIXED
- [NIT] assign arm overlaps server.task-assign-4914 --> NOTED (it adds the real engine through the page path)

#### Iteration 2
**Reviewer model:** sonnet
- [NIT] header said "as the agent CLI sends it" though from_pane and world headers are omitted --> FIXED (same path)
- [NIT] assign refusal regex loose --> FIXED (exact sentence)
- [NIT] a plan line under the wrong heading --> FIXED
