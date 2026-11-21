---
pre_challenge: true
method: challenge-loop
branch: agenthow-8735
diff_hash: e9e4e7703280ba59eeb75bc25b5a91ae7debc1dd88a47218f1a659ce3881428d
validation: passed
subdir_audit: passed
timestamp: 2026-11-21T05:43:04Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (round 2, sonnet on the whole branch, nothing above nit)
**Fixed:** both round 1 nits | **Asked (awaiting user):** 0

Slice 7 of #8735: the PM's #4474 new-role steps move word for word to `kosmos agent --how` (engine/agentguide.js, both
CLIs, both usage texts). The PM keeps the confirmation, the create command, "brief it by the name Kosmos prints", the
refusal and maybe-made lines, and a pointer that says the confirmation comes first. Mona Lisa's two conditions are
built: the guide opens with who it is for and the setup guide's refusal; only the PM is pointed at it, and roles.test
refuses `agent --how` for the setup guide with a CONTROL over every other role. pm 42,837 -> 42,440, ratchet 42,500.
Validation on the final head: 30,426 node tests 0 failed, all four shell shards, PASSED (hash e9e4e770). Related set:
173 files, 4,475, 0 failed.

### Per-Iteration Breakdown
#### Iteration 1 (opus, blind)
Nothing above nit. Measured: the server's fromGuide refusal is set from the caller's own identity (server.js), so a
guide any agent can print weakens no guard; nothing that reaches the setup guide points at the steps. Both nits taken
(the guide says "a role the setup guide wrote" and names `kosmos agent roles`).
#### Iteration 2 (sonnet, whole branch)
Nothing above nit; it also ran the three #4474 new-role test files (37, 0 failed).
