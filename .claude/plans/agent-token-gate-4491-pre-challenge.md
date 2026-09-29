---
pre_challenge: true
method: challenge-loop
branch: agent-token-gate-4491
diff_hash: aab2efb08835c03eb1655a635eeddf82fbc4dff6851035cda664ccaa8f38a9ee
validation: passed
subdir_audit: passed
timestamp: 2026-09-29T06:28:41Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6 (opus, sonnet alternating)
**Converged:** Yes (round 5 NITs only; a validation red then reopened it; round 6 clean)
**Total findings:** 11 actionable WARNINGs + 1 validation BLOCKER, plus NITs
**Fixed:** 10 | **Deferred:** 2 (recorded in the plan) | **Asked:** 0

⚠️ **Disclosures:** several validation runs were stopped by me (my own worktree's processes only) because their code was superseded mid-run. Origin set by reading, recorded BRANCH. One test I added in round 4 was vacuous (a post to a missing project cannot show who posted, which its own control proved); I removed it and recorded the gap as decided.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] server.agent-token-sender-570.test.js — the old security pin still passed while its claim became false --> FIXED (58cbfa223): rewritten to the new invariant, AGENT_TOKEN_ROUTES pinned exactly
- [WARNING] server.agent-token-gate-4491.test.js — gate-pass only, no identity --> FIXED: whoami identity, header-vs-body spoof with a control, revoked token refused
- [WARNING] server.js — network wording ignored the Kosmos+ tunnel over loopback --> FIXED: tunnel caveat stated

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] server.js — the gate checks the store, not the roster (failed revoke residual) --> FIXED (501b0320e): stated in the code and plan
- [WARNING] server.agent-token-gate-4491.test.js — msg identity untested --> FIXED: a token-only msg is sent as its agent, body cannot change it
- [WARNING] server.js — a new unauthenticated store scan --> FIXED: a shape check before the scan

#### Iteration 3
**Reviewer model:** opus
- [WARNING] bin/agent-supervisor.sh — the agent token rides on tmux argv (ps-visible), now worth more --> FIXED (15e85bbab): residual stated; #4497 filed to move it off argv before the set widens
- [WARNING] server.agent-token-gate-4491.test.js — the malformed-token test could not see the shape check --> FIXED: a spy with a control

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] plan — read as if the CLI benefits; the shipped Mac CLI sends msg/post tokens in the body --> FIXED (620a1f1b2): "server side only" stated; CLI change is the next PR
- [WARNING] server.js — the scan cost for a well-formed random token --> FIXED: named as the accepted report/reply class
- [WARNING] tests — post identity and network peer not exercised --> DEFERRED: post checks the project first (a control proved a missing-project fixture cannot show the sender), post shares senderFromAgentToken with msg and the 570 pin; network peers are refused by remoteWriteGuard (own suite) and the set is pinned out of REMOTE_AGENT_ROUTES

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 2 NITs (plan should mention the Windows CLI already sends the header; the 570 test title should name whoami)

#### Validation red, then Iteration 6
- [BLOCKER] fixture-discipline.test.js — the new suite reaches POST /api/agents without sandboxing Claude Code's config --> FIXED (bcbd4d506): AGENT_WORKFORCE_CLAUDE_CONFIG sandboxed
**Iteration 6 reviewer model:** sonnet — 0 BLOCKERs, 0 WARNINGs, 3 NITs; confirmed every root sandboxed
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | server.agent-token-sender-570.test.js | BRANCH | stale security pin | FIXED | 58cbfa223 |
| 2 | 1 | WARNING | server.agent-token-gate-4491.test.js | BRANCH | no identity test | FIXED | 58cbfa223 |
| 3 | 1 | WARNING | server.js | BRANCH | tunnel caveat | FIXED | 58cbfa223 |
| 4 | 2 | WARNING | server.js | BRANCH | revoke residual | FIXED | 501b0320e |
| 5 | 2 | WARNING | tests | BRANCH | msg identity | FIXED | 501b0320e |
| 6 | 2 | WARNING | server.js | BRANCH | unauthenticated scan | FIXED | 501b0320e |
| 7 | 3 | WARNING | bin/agent-supervisor.sh | BRANCH | argv token residual | FIXED (stated, #4497) | 15e85bbab |
| 8 | 3 | WARNING | tests | BRANCH | shape check unobservable | FIXED | 15e85bbab |
| 9 | 4 | WARNING | plan | BRANCH | CLI benefit implied | FIXED | 620a1f1b2 |
| 10 | 4 | WARNING | server.js | BRANCH | scan cost wording | FIXED | 620a1f1b2 |
| 11 | 4 | WARNING | tests | BRANCH | post identity / network peer | DEFERRED | reasons above |
| 12 | V | BLOCKER | fixture-discipline | BRANCH | Claude config not sandboxed | FIXED | bcbd4d506 |

### Validation
- Final validation (6j) on bcbd4d506: PASSED, hash aab2efb08835, 11635 node tests / 0 fail, shell suites clean, subdir audit clean.
- Controls measured red: the exemption removed (pass test), the shape check removed (spy test).

### Strengths
- [STRENGTH] The exemption needs the exact route AND a valid header token, is evaluated last, and never opens a person-only route.
- [STRENGTH] The gate and handlers agree on the caller (header first); spoof tests with controls.
