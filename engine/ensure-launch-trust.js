#!/usr/bin/env node
'use strict';
/*
 * #2808 class-1 / #2129: re-apply the folder-trust write + the bypass-permissions
 * pre-accept on EVERY (re)launch, not only at create.
 *
 * WHY THIS EXISTS. engine/create.js writes trustFolder + preacceptBypass once, at
 * CREATE. But agents restart constantly (launchd KeepAlive, `kosmos restart`, a
 * hand/claude-fe relaunch), and the relaunch path (bin/agent-supervisor.sh) did NOT
 * re-apply them - it relied on the create-time write persisting. Two ways that
 * assumption breaks and parks a RESTARTED agent on Claude Code's folder-trust dialog
 * (#2129), the exact catastrophic wedge, on a gate --dangerously-skip-permissions does
 * NOT answer (folder-trust is a separate startup dialog from tool-permission):
 *   - a fresh macOS user whose ~/.claude.json was never created before the restart;
 *   - a config/account state where the create-time key did not land or is not read.
 * Re-applying here, immediately before the supervisor launches the agent, closes both:
 * the trust key + the bypass pre-accept are present every time the pane starts.
 *
 * SAFE BY CONSTRUCTION.
 *   - Idempotent: trustFolder reports already:true and preacceptBypass writes nothing
 *     when the keys are already set, so a normal restart re-writes nothing.
 *   - Best-effort: an agent that will not start because a re-trust write failed is a
 *     far worse outcome than the prompt it prevents, so this ALWAYS exits 0 (the same
 *     posture as bin/codex-dismiss-update.js). trustFolder/preacceptBypass already
 *     soft-fail ({ok:false, because}); the try/catch guards an unexpected throw.
 *   - Claude-only: the supervisor invokes this on the Claude launch arm only. The
 *     codex arm has its own trustCodexFolder + codex-dismiss-update shim, and configDir
 *     there is a CODEX_HOME, so a CLAUDE trust/consent write must never run against it.
 *
 * It mirrors engine/create.js's exact create-time call so the two agree:
 *   trustFolder(workdir, { configDir, createIfAbsent: true, agentDefaultAccount: !configDir })
 *   preacceptBypass(configDir, !configDir)
 *
 * argv[2] = workdir  - the CWD the agent launches in (`new-session -c`), i.e. the folder
 *                      whose on-disk realpath is Claude Code's trust key. Required; an
 *                      empty value is a no-op (nothing to trust).
 * argv[3] = CLAUDE_CONFIG_DIR - empty means the DEFAULT account (~/.claude.json +
 *                      ~/.claude/settings.json), which agentDefaultAccount targets so the
 *                      write does not follow the ENGINE's own CLAUDE_CONFIG_DIR (#2173).
 */
const trust = require('./trust');

function ensureLaunchTrust(workdir, rawConfigDir) {
  if (!workdir) return; // nothing to trust; a missing CWD is not this script's failure to name
  const configDir = rawConfigDir ? rawConfigDir : null;
  const agentDefaultAccount = !configDir;
  // Both calls are best-effort and idempotent; their own return value ({ok, because})
  // is not acted on here - a refusal (another tool's file, a symlinked config) leaves
  // exactly the state that was there before, which is the safe direction for a relaunch.
  trust.trustFolder(workdir, { configDir, createIfAbsent: true, agentDefaultAccount });
  trust.preacceptBypass(configDir, agentDefaultAccount);
}

module.exports = { ensureLaunchTrust };

if (require.main === module) {
  try { ensureLaunchTrust(process.argv[2] || '', process.argv[3] || ''); }
  catch { /* best-effort: a re-trust failure must never block a launch */ }
  process.exit(0);
}
