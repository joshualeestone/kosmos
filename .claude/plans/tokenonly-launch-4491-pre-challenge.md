---
pre_challenge: true
method: challenge-loop
branch: tokenonly-launch-4491
diff_hash: 5f73cf240fcc08b2ac5cdfaa70de5fec727b23968f0a4902dae6c510d20f3a84
validation: focused at this head on origin/main e29c2c8de: engine/sendertoken-tokenonly-4491, the sendertoken tests, the supervisor node tests and the file-scanning guards (fixture-discipline, the #4796 guard, no-brand-refs, no-name-refs), 162 pass, 0 fail; tools/test-supervisor-env, -wait, -model-2140, -agentbrowser-3633, -retrust-2808, -ccd-leak-3417, -codexhome-leak-3430 all rc 0; CI runs the full suite on the merge ref
subdir_audit: passed
timestamp: 2026-10-01T10:32:13Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes
**Total findings:** 13 (0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 8 NITs)
**Fixed:** 7 | **Deferred:** 0 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above (ITER_COMMITS empty)
- [WARNING] bin/agent-supervisor.sh:1204 — Antigravity's launch-time report (run from the supervisor shell) got the token but not the switch --> FIXED (559a414bf): _LAUNCH_TOKEN_ONLY beside _LAUNCH_TOKEN, handed to the seed
- [WARNING] bin/agent-supervisor.sh:483 — nothing pinned the switch empty, so a value on the shared tmux server's global environment could put an unlisted agent into the pilot --> FIXED (559a414bf): `-e KOSMOS_AGENT_TOKEN_ONLY=` beside the KOSMOS_WORLD pin; test asserts it; reverting it fails the test
- [NIT] tools/test-supervisor-env.sh — no "listed, no token" arm --> FIXED (559a414bf, strengthened in iteration 2)
- [NIT] engine/sendertoken.js — say Mac supervisor launches only --> FIXED (559a414bf)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 3 of the above (each cites a line iteration 1's fix commit wrote)
- [WARNING] bin/agent-supervisor.sh:748 — every pane now has the switch SET (empty); a future reader testing -n would read it as on --> FIXED (e3148b8fe): comment at the pin names the exactly-1 contract and its readers
- [WARNING] tools/test-supervisor-env.sh:300 — the no-token arm could not tell "suppressed" from "never evaluated" (no engine) --> FIXED (e3148b8fe): stub engine whose tokenOnlyFor is on for everyone, failing mint vs working-mint control; moving the switch outside the token guard fails it (measured)
- [WARNING] bin/agent-supervisor.sh:1212 — the seed env carried two assignments, relying on order --> FIXED (e3148b8fe): the seed filter skips the pane's pin, so only the launch's own value is passed
- [NIT] bin/agent-supervisor.sh:487 — second node spawn per launch --> accepted (guarded, falls back to off)
- [NIT] engine/sendertoken.js:547 — per-world root unstated --> FIXED (e3148b8fe): docblock says a named-world agent reads its world's file

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | bin/agent-supervisor.sh:1204 | BRANCH | Antigravity seed lacked the switch | FIXED | 559a414bf |
| 2 | 1 | WARNING | bin/agent-supervisor.sh:483 | BRANCH | no empty pin against tmux global env | FIXED | 559a414bf |
| 3 | 2 | WARNING | bin/agent-supervisor.sh:748 | SELF | pin sets the var empty; exactly-1 contract unstated | FIXED | e3148b8fe |
| 4 | 2 | WARNING | tools/test-supervisor-env.sh:300 | SELF | no-token arm could not discriminate | FIXED | e3148b8fe |
| 5 | 2 | WARNING | bin/agent-supervisor.sh:1212 | SELF | seed relied on env assignment order | FIXED | e3148b8fe |

### NITs (non-blocking, across all iterations)
- [NIT] bin/agent-supervisor.sh:487 a second node spawn per launch with a token (iterations 2, 3; accepted)
- [NIT] tools/test-supervisor-env.sh:322 the Antigravity seed arm is structural (iteration 3; stated in the plan; nothing drives a signed-in Antigravity launch)
- [NIT] engine/sendertoken.js:546 readFileSync on a FIFO would block (iteration 3; the mint has the same exposure in the same store)
- [NIT] tools/test-supervisor-env.sh:262 no named-world supervisor arm (iteration 3; reviewer traced the world roots are exported before the read)

### Strengths (across all iterations)
- The switch rides only beside a real hex token, in the one-use 0600 secrets file, never argv; every failure path is off and the launch goes on (iterations 1, 2, 3)
- Exact roster-name match, not safeKey, with near-miss names tested; -discord twin covered (iterations 1, 3)
- Every root written is sandboxed; controls that can fail (working-mint stub, unlisted agent) (iterations 2, 3)
- Author note: one perturb in iteration 2 was run before committing and its git checkout took two uncommitted fixes; both were re-applied and committed (e3148b8fe), and the test was rerun green.
