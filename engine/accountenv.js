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
function accountEnvVar(runner) {
  /* Each runner reads its account home from its OWN env var. gemini/grok added
     with the provider-accounts subsystem (#3296/#3391): a per-account gemini agent
     is launched with GEMINI_CLI_HOME = its account dir, a per-account grok agent
     with GROK_HOME = its account dir. (The one Gemini quirk -- the CLI writes its
     data into a `.gemini` subdir BELOW GEMINI_CLI_HOME -- lives in create.js's
     geminiStorageHome helper, NOT here: the account dir IS the env value verbatim,
     exactly as it is for codex/grok, so this stays a neutral name-only leaf.) */
  switch (runner) {
    case 'codex': return 'CODEX_HOME';
    case 'gemini': return 'GEMINI_CLI_HOME';
    case 'grok': return 'GROK_HOME';
    default: return 'CLAUDE_CONFIG_DIR';
  }
}

module.exports = { accountEnvVar };
