'use strict';

/* #5309 part 2, slice 1: per-agent plugin REACH.
 *
 * Does the person's own provider-app plugins/connectors reach THIS agent, and if not, why?
 * This is the signal the board needs to show the honest state the day-one report asked for:
 * "connected for you, but this agent cannot see it" (false-ready, no repair path).
 *
 * Home logic only. Slice 1 deliberately names no file inside a provider folder: the plugin-file
 * shapes (plugins/installed_plugins.json records, a populated settings.json enabledPlugins, Codex's
 * enabled-plugin record) were not pinned by slice 1 (kosmos#5309, PR #5371) and are not verifiable on
 * a box with no plugins installed. So this reports the reach CONDITION and its reason, never a list of
 * specific plugins. Naming the specific plugins is a follow-up once those shapes are measured.
 *
 * The reach condition is derived entirely from the measured home logic (see engine/status.js
 * claudeAccountDirOf, engine/accounts.js, bin/agent-supervisor.sh):
 *   - Claude default account: CLAUDE_CONFIG_DIR unset, so the effective folder IS the person's
 *     ~/.claude -> the person's plugins reach it. No mismatch.
 *   - Claude non-default account: a separate account folder with its own plugins -> a plugin the
 *     person installed in their own Claude app is not in it.
 *   - Codex: every agent (default included) runs in a private runtime home that deliberately excludes
 *     the person's ~/.codex plugins (#4592). Categorical, by design -- not a per-plugin bug.
 *   - Other runners (Gemini/Grok/...): this condition does not apply.
 */

const path = require('node:path');

// Stable reason codes slice 2's board/UI switches on. Keep these strings fixed.
const REACHES = 'reaches';                           // the agent shares the person's provider home
const SEPARATE_ACCOUNT = 'separate-account-folder';  // Claude agent on a non-default account folder
const CODEX_ISOLATED = 'codex-isolated-runtime';     // Codex private runtime excludes desktop plugins
const NOT_APPLICABLE = 'not-applicable';             // non-Claude/Codex runner: condition does not apply
const UNKNOWN = 'unknown';                            // the agent's runner/home could not be read

/*
 * Pure decision. Never throws; an unreadable runner or missing person-home yields UNKNOWN
 * (reaches: null) rather than a false "reaches: true".
 *
 *   runner           'claude' | 'codex' | 'gemini' | 'grok' | ... (case-insensitive)
 *   agentClaudeDir   the agent's EFFECTIVE Claude config dir (absolute), or null/'' for a clean
 *                    default launch (CLAUDE_CONFIG_DIR unset). Only read for a Claude agent.
 *                    Prefer the pane's live CLAUDE_CONFIG_DIR where available: it catches the
 *                    EFFECTIVE_CCD leak-pin (bin/agent-supervisor.sh) that a default-account plist
 *                    does not record. The plist configDir is the fallback.
 *   personClaudeHome the person's own Claude home (absolute, = accounts.homeDir()/.claude)
 */
function reachFrom({ runner, agentClaudeDir, personClaudeHome } = {}) {
  const r = typeof runner === 'string' ? runner.trim().toLowerCase() : '';
  if (r === 'codex') return { reaches: false, reason: CODEX_ISOLATED };
  if (r === 'claude') {
    if (!personClaudeHome) return { reaches: null, reason: UNKNOWN };
    // Clean default launch: CLAUDE_CONFIG_DIR unset -> effective dir is the person's home.
    if (!agentClaudeDir) return { reaches: true, reason: REACHES };
    // Compare RESOLVED paths so 'h/./.claude' and 'h/.claude/' are not read as different folders.
    if (path.resolve(agentClaudeDir) === path.resolve(personClaudeHome)) {
      return { reaches: true, reason: REACHES };
    }
    return { reaches: false, reason: SEPARATE_ACCOUNT, folder: agentClaudeDir };
  }
  if (r === '') return { reaches: null, reason: UNKNOWN };
  return { reaches: null, reason: NOT_APPLICABLE };
}

/*
 * Thin resolver for a live agent by name. Mirrors status.claudeAccountDirOf: the plist's configDir
 * when set, else the person's ~/.claude. `deps` is injectable so tests need no real plist.
 *
 * Slice 2: where the live pane env is available, pass the pane's CLAUDE_CONFIG_DIR as agentClaudeDir
 * instead of the plist value, to catch the EFFECTIVE_CCD leak-pin on a default-account agent.
 */
function reachForAgent(agentName, deps = {}) {
  const create = deps.create || require('./create');
  const accounts = deps.accounts || require('./accounts');
  let personClaudeHome = '';
  try { personClaudeHome = path.join(accounts.homeDir(), '.claude'); } catch { personClaudeHome = ''; }
  let job = null;
  try { job = create.readJob(agentName); } catch { job = null; }
  if (!job) return { reaches: null, reason: UNKNOWN };
  const runner = job.runner || 'claude';
  let agentClaudeDir = null;
  if (String(runner).toLowerCase() === 'claude') {
    agentClaudeDir = (typeof job.configDir === 'string' && job.configDir) ? job.configDir : personClaudeHome;
  }
  return reachFrom({ runner, agentClaudeDir, personClaudeHome });
}

module.exports = {
  reachFrom,
  reachForAgent,
  REACHES,
  SEPARATE_ACCOUNT,
  CODEX_ISOLATED,
  NOT_APPLICABLE,
  UNKNOWN,
};
