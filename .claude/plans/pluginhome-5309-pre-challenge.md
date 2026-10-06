---
pre_challenge: true
method: challenge-loop
branch: pluginhome-5309
diff_hash: 64b842638328494ee21652f6c00b11c6e75e6c4ab56c5856b5383eb1d7e59c4a
validation: passed
subdir_audit: passed
timestamp: 2026-10-06T04:02:00Z
iterations: 19
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 19 (18 on the instructions text, alternating Opus and Sonnet; 1 on the size-canary change after full validation)
**Converged:** Yes (iteration 18, Sonnet: no new actionable findings; iteration 19 on the canary raise: clean)
**Validation:** passed (Mortals, hash 64b842638328, 15514 tests, 0 fail, 0 cancelled; ENTRY clean)
**Fixed:** every BLOCKER, WARNING and CONVENTION raised | **Deferred:** repeats of settled points, each with its reason in the plan | **Asked:** 0

### What the loop found (the change is agent-facing instructions, so most findings were claims the text could not back)
- [WARNING] engine/connections.js — claude.ai connectors are not plugins; they follow the signed-in account --> FIXED (account check)
- [WARNING] engine/connections.js — "installed" is not "active": switched off, one project, added after start --> FIXED
- [WARNING] engine/connections.js — unmeasured Codex and synced-plugin details --> FIXED (removed; plan records what is measured)
- [WARNING] engine/connections.js — a default agent can be pointed at another folder (agent-supervisor.sh EFFECTIVE_CCD) --> FIXED (compare actual folders)
- [WARNING] engine/connections.js — the Claude desktop app's own settings are a third place --> FIXED
- [WARNING] engine/connections.js — `claude mcp add` servers live in .claude.json, beside .claude when CLAUDE_CONFIG_DIR is unset (measured) --> FIXED
- [WARNING] engine/connections.js — a SELF-written "one project only" clause was wrong (--scope project uses .mcp.json) --> FIXED (deleted)
- [WARNING] engine/connections.js — `--scope local` is the default (measured from --help); per-project records measured in .claude.json --> FIXED
- [WARNING] engine/connections.js — the direct instruments: claude plugin list / mcp list / mcp get / auth status, codex mcp list (each from --help) --> FIXED
- [WARNING] engine/connections.js — `claude mcp list` health-checks servers; run once --> FIXED
- [WARNING] engine/connections.js — the scope line must not cover the Connections tab section --> FIXED ("the rest of this section")
- [WARNING] engine/connections.js — enabledPlugins in settings.json for the switched-off check (read on this box) --> FIXED
- [WARNING] engine/create.test.js — full validation: the role-made boot file passed the MAX/5 size canary (53,566 bytes) --> FIXED (MAX/4, the third raise for intended text; logged on kosmos#4021)
- [CONVENTION] .claude/plans/pluginhome-5309.md — claims sourced to review rounds rather than facts --> FIXED

### Per-Iteration Breakdown (reviewer model)
Iterations 1, 3, 5, 7, 9, 11, 13, 15, 17: opus. Iterations 2, 4, 6, 8, 10, 12, 14, 16, 18: sonnet. Iteration 19 (canary): sonnet.
Self-generated findings (on lines an earlier fix wrote): iterations 6, 7, 9, 13, 14, 15, 16. Per 6e, self-written prose claims
were deleted rather than reworded where possible (iterations 6 and 16).

### NITs (non-blocking)
- engine/connections.test.js — the test pins phrases, not truth; the plan's evidence list carries the truth
- engine/connections.js — Gemini, Grok and Antigravity agents are told the section does not apply to them

### Strengths
- The block stays constant: no argument, no machine state (connections.test.js pins blockBody.length === 0)
- Every claim is either measured on Agent1s or worded as a check for the agent; the plan says which
- The new test is red-capable against origin/main's connections.js
