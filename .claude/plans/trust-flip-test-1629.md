# #1629: regression guard for the delete-the-agent trust bug

## The bug (data-loss)
Flipping an agent to another Claude account re-armed Claude Code's terminal
workspace-trust prompt with "No, exit" preselected; the Enter reflex that clears a
stuck composer DELETED the agent. Root cause: trust.js wrote hasTrustDialogAccepted
into the config THIS process reads, but a flipped agent reads its own account's
<configDir>/.claude.json.

## State
The fix (CONFIG/trustFolder consult opts.configDir + CLAUDE_CONFIG_DIR, with a
#2129 default-account carve-out) shipped in #1640 but was UNTESTED. Renet's ratified
remaining scope: a behavioral account-flip verification, not a browser walk.

## Change (test only; trust.js unchanged)
Three perturbation-verified tests in engine/trust.test.js:
1. trustFolder({configDir}) writes into THAT account's config, default untouched.
2. CLAUDE_CONFIG_DIR set -> $CLAUDE_CONFIG_DIR/.claude.json.
3. #2129: agentDefaultAccount IGNORES the engine's CLAUDE_CONFIG_DIR.

Each carries a HOME=SANDBOX (and, for test 3, AGENT_WORKFORCE_HOME=sandbox) safety
net so a broken fix refuses against a sandbox file rather than writing the
operator's real ~/.claude.json.
