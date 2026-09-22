---
pre_challenge: true
method: challenge-loop
branch: codex-home-3430
diff_hash: 387d29398bfc2e1a5fd0a6160ee48255264ce898986ece1ef100c618a2c564ab
validation: passed
subdir_audit: passed
timestamp: 2026-09-22T23:16:58Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (on the CORRECTED fix; see the correction note below)
**Converged:** Yes (iteration 2's only actionable finding was a plan-doc em dash, now fixed; the code earned only STRENGTHs across both models)
**Total findings (v2 loop):** 3 (0 BLOCKERs, 1 WARNING, 1 CONVENTION, 1 NIT counted; more NITs deferred)
**Fixed:** 2 | **Deferred:** NITs | **Asked (awaiting user):** 0

### 🛑 Correction note (v1 was wrong; caught in review before merge)
The FIRST version of this fix pinned the pane to the leaked tmux server-global CODEX_HOME
(a naive copy of #3417's CLAUDE_CONFIG_DIR seam). PigeonPete review-verified it by content
and ICK confirmed: that is the WRONG home for codex. Codex auth lives in the DEFAULT
$HOME/.codex (default signin; create.js defaultAgentCodexHome deliberately skips the engine
CODEX_HOME; verified $HOME/.codex/auth.json exists on this box), and codex has NO launch-time
write-realign like #3417's ensure-launch-trust, so pinning the leak just made the wrong read
explicit and left the agent unauthenticated. The fix was reworked to OVERRIDE the pane's
CODEX_HOME to the default home (the MIRROR of #3417, not a copy). This proof covers the
CORRECTED fix; it will not merge until Pete + ICK confirm the corrected direction.

### Per-Iteration Breakdown (v2, on the corrected fix)

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] bin/agent-supervisor.sh — the bash fallback was two-tier (AGENT_WORKFORCE_CODEX_HOME || $HOME/.codex) but create.js defaultAgentCodexHome() is three-tier (AGENT_WORKFORCE_CODEX_HOME || (AGENT_WORKFORCE_HOME || HOME)/.codex); the missing tier held only implicitly via the plist-baked HOME (write-A-read-B class). --> FIXED (f39e133): reproduced faithfully as three tiers `${AGENT_WORKFORCE_CODEX_HOME:-${AGENT_WORKFORCE_HOME:-$HOME}/.codex}`.
- [NIT] test claude-arm control reuses the args file (fail-safe). DEFERRED.
- [NIT] stub show-environment CODEX_HOME not queried by the fixed path (forward-looking v1-regression guard). DEFERRED.
- [NIT] codex-dismiss-update.js not copied into the sandbox, so the dismiss-shim arg isn't directly exercised (same var as the pane, asserted). DEFERRED.

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0
**Converged** — no new actionable code findings.
- [CONVENTION] .claude/plans/codex-home-3430.md — 2 em dashes in added lines (house style). --> FIXED (c2a00a4).
- [NIT] middle/bottom tiers of the three-tier expansion exercised by inspection only (test sets tier 1). DEFERRED.
- [NIT] claude-arm control reuses args file (fail-safe). DEFERRED.

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | bin/agent-supervisor.sh | BRANCH | two-tier vs create.js three-tier defaultAgentCodexHome | FIXED | f39e133 |
| 2 | 2 | CONVENTION | .claude/plans/codex-home-3430.md | BRANCH | 2 em dashes in added lines | FIXED | c2a00a4 |
| 3 | 1,2 | NIT | tools/test-supervisor-codexhome-leak-3430.sh | BRANCH | control reuses args file / tiers by inspection / dismiss arg untested | DEFERRED | fail-safe + forward-looking |

### Outstanding questions (ASKED, still unresolved when the run ended)
None. (Merge is gated on Pete + ICK re-confirming the corrected direction, which is a review sign-off, not an ASKED loop finding.)

### Strengths (across the v2 loop)
- The three-tier bash expansion faithfully mirrors create.js defaultAgentCodexHome(), including set-but-empty semantics (JS `||` and bash `:-` fall through identically), and $HOME == os.homedir() on POSIX.
- Correct account-model handling with no double-push: the forwarding loop pushes CODEX_HOME only when own env is non-empty (per-account); the block fires only when empty (default); mutually exclusive, so a per-account codex agent is never mis-pointed at the default home. Claude panes untouched (RUNNER=codex guard), proven by the discriminating control.
- Pane read == dismiss write on one home across all four cases (default/clean, default/leaked, per-account, claude); the dismiss shim was changed from ${CODEX_HOME:-} to ${EFFECTIVE_CODEX_HOME:-}.
- The fix correctly DIVERGES from #3417 (overrides to the default home rather than pinning the leak, because codex has no write-realign); the test's v1-regression guard (pane must NOT read the leak) is genuinely discriminating, and non-vacuity holds against origin/main.
- CI wiring complete (test:shell, after the ccd-leak sibling); set -u clean throughout.
