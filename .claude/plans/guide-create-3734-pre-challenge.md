---
pre_challenge: true
method: challenge-loop
branch: guide-create-3734
diff_hash: 919b5a670b44444004c8e610babc77747898d7f0df785b79da94b2e425cbaeb8
validation: passed
subdir_audit: passed
timestamp: 2026-09-25T14:47:49Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4: no BLOCKER, WARNING or CONVENTION; no ASKED findings)
**Total findings:** 1 BLOCKER, 13 WARNINGs, 1 CONVENTION, 14 NITs
**Fixed:** all BLOCKERs, WARNINGs and the CONVENTION, and most NITs | **Deferred:** 0 | **Asked (awaiting user):** 0

Round 1 changed the design: the first version gated POST /api/agents to the guide's token; review showed POST
/api/team (#1279) already lets any token agent create agents, so the gate restricted one spelling, not the
ability. The branch was rebuilt on /api/team (18685d98). Validation also failed twice on guards outside the node
tests (Windows verb parity, the help-exit source check), each fixed in the next commit.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 6 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 0 (no loop commits yet)
- [BLOCKER] install/kosmos cmd_agent - a bare `node` (an agent's PATH may have none) --> FIXED 18685d98 (kosmos_engine_node; no-node test)
- [WARNING] server.js - the /api/agents gate restricted one spelling, not the ability (/api/team exists) --> FIXED 18685d98 (rebuilt on /api/team; docs say "only the guide's instructions")
- [WARNING] server.js - the hourly bound was check-then-act across an await --> FIXED 18685d98 (/api/team's per-creator cap under its lock)
- [WARNING] server.js - no createdBy/purpose provenance --> FIXED 18685d98 (/api/team records both)
- [WARNING] server.js - every failure collapsed to one 403 --> FIXED 18685d98 (/api/team's 503/403 split)
- [WARNING] engine/roles.js - no Windows verb --> FIXED 18685d98 (tools/windows/kosmos-cli.js)
- [WARNING] server.js - only the provider was inherited --> FIXED 18685d98 (account folder too, creatorRunsOn)
- [CONVENTION] cli test ran with the developer's env --> FIXED 18685d98 (sandboxed KOSMOS_HOME and PATH)
- [NIT] help banner, --help exit, an unread answer read as half-made, string replace with $ --> FIXED 18685d98

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** not recorded
- [WARNING] install/kosmos:1976 - `kosmos agent --help` fell through to the top-level banner --> FIXED c7fe2e6a

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** not recorded
- [WARNING] tools/windows/kosmos-cli.js - a 15 s timeout read as "not made" --> FIXED f7c0ed16 (long timeout; "may have been made"; Mac curl 28 too)
- [WARNING] server.js creatorRunsOn - provider and account from two records --> FIXED f7c0ed16 (both from the launch job)
- [WARNING] server.js - a model-only member moved to the creator's provider --> FIXED f7c0ed16
- [WARNING] tests - account inheritance and the operator arm untested through the route --> FIXED f7c0ed16
- [NIT] fixture 403 text, help exit code, Windows link, comment placement, no-token message --> FIXED f7c0ed16

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
**Converged** - no new actionable findings.
- [NIT] install/kosmos - "roles" shares the "cannot be made" not-running sentence
- [NIT] install/kosmos - `why` rides curl argv with no length guard

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | install/kosmos | BRANCH | bare node | FIXED | 18685d98 |
| 2 | 1 | WARNING | server.js | BRANCH | gate on one spelling | FIXED | 18685d98 |
| 3 | 1 | WARNING | server.js | BRANCH | racy bound | FIXED | 18685d98 |
| 4 | 1 | WARNING | server.js | BRANCH | no provenance | FIXED | 18685d98 |
| 5 | 1 | WARNING | server.js | BRANCH | one 403 for all | FIXED | 18685d98 |
| 6 | 1 | WARNING | engine/roles.js | BRANCH | no Windows verb | FIXED | 18685d98 |
| 7 | 1 | WARNING | server.js | BRANCH | account not inherited | FIXED | 18685d98 |
| 8 | 1 | CONVENTION | cli.agent-create-3734.test.js | BRANCH | unsandboxed CLI test | FIXED | 18685d98 |
| 9 | 2 | WARNING | install/kosmos:1976 | BRANCH | agent --help | FIXED | c7fe2e6a |
| 10 | 3 | WARNING | tools/windows/kosmos-cli.js | BRANCH | timeout read as not made | FIXED | f7c0ed16 |
| 11 | 3 | WARNING | server.js | BRANCH | two records | FIXED | f7c0ed16 |
| 12 | 3 | WARNING | server.js | BRANCH | model-only member moved | FIXED | f7c0ed16 |
| 13 | 3 | WARNING | tests | BRANCH | route arms untested | FIXED | f7c0ed16 |

Origin is BRANCH throughout: the blame lookup was not run (the fail-safe value).

### NITs (non-blocking, not fixed)
- `kosmos agent roles` shares the "cannot be made" not-running sentence (iteration 4)
- `why` on curl argv with no length guard (iteration 4)
- plan file name has no timestamp suffix (common in the tree)

### Strengths (across all iterations)
- One agent-facing create path (/api/team): token-derived creator, provenance, a per-creator cap under a lock (1, 3, 4)
- refreshGuideRole: marked folder only, exact match, version-checked, idempotent, tested (1, 3, 4)
- The CLI keeps tokens off argv and reads answers as JSON with the engine's own node (3, 4)
- Mutations, all RED on their own assertions: rewrite outside the guide, CLI without the token, bare node, agent
  missing from the help list, the model check, the agent-caller check, the account line, provider before job
