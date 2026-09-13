'use strict';
/**
 * Which environment variable carries an agent's account directory, per runner.
 *
 * codex reads CODEX_HOME; Claude Code reads CLAUDE_CONFIG_DIR. ONE rule for both
 * platforms: `create.plistFor` writes this key into a Mac launchd job, and
 * `win32launch.childEnv` sets it in a Windows agent's environment, so an account
 * change lands in the variable the runner actually reads on either one.
 *
 * ⚠️ A LEAF, WITH NO REQUIRES, and deliberately neutral. It lived in win32argv.js
 * for one round, which made the Mac plist writer depend on a Windows argv module
 * (review round 2). Both platforms' launch code can load this without pulling the
 * other's tree.
 */
function accountEnvVar(runner) { return runner === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR'; }

module.exports = { accountEnvVar };
