'use strict';

/* #5309 part 2, slice 1: per-agent plugin REACH.
 *
 * Do the plugins/connectors the person installed in their own provider app reach THIS agent, and if
 * not, why? This is the signal the board needs to show the honest state the day-one report asked for:
 * "connected for you, but this agent cannot see it" (false-ready, no repair path).
 *
 * Home logic only. Slice 1 deliberately names no file inside a provider folder: the plugin-file shapes
 * (plugins/installed_plugins.json records, a populated settings.json enabledPlugins, Codex's
 * enabled-plugin record) were not pinned by slice 1 (kosmos#5309, PR #5371) and are not verifiable on
 * a box with no plugins installed. So this reports the reach CONDITION and its reason, never a list of
 * specific plugins. Naming the specific plugins is a follow-up once those shapes are measured.
 *
 * The reach condition is derived from the measured home logic (see engine/status.js claudeAccountDirOf,
 * engine/accounts.js, bin/agent-supervisor.sh):
 *   - Claude default account: CLAUDE_CONFIG_DIR unset, so the effective folder IS the person's
 *     ~/.claude -> the person's plugins reach it. No mismatch.
 *   - Claude non-default account: a separate account folder with its own plugins -> a plugin the
 *     person installed in their own Claude app is not in it.
 *   - Codex: every agent (default included) runs in a private runtime home that deliberately excludes
 *     the person's ~/.codex plugins (#4592). Categorical, by design -- not a per-plugin bug.
 *   - Other runners (Gemini/Grok/...): this condition does not apply.
 *
 * Fail-safe direction: an unreadable runner, a missing/garbage/non-absolute home, or an unreadable job
 * maps to UNKNOWN (reaches: null), so those never produce a spurious reaches:true or reaches:false.
 * ONE known over-report remains and is NOT yet closed in this slice: a default-account Claude agent
 * whose pane was pinned to another folder via a leaked tmux-global EFFECTIVE_CCD (bin/agent-supervisor.sh
 * ~888-902) is recorded reaches:true here, because the plist configDir the resolver reads is null for it
 * while the pane actually runs elsewhere. reachFrom takes the effective dir as input, so slice 2 (which
 * has the live pane env) passes the pane's real CLAUDE_CONFIG_DIR and closes it. Until then, treat a
 * reaches:true as "reaches, unless the pane was EFFECTIVE_CCD-pinned".
 */

const path = require('node:path');

// Stable reason codes slice 2's board/UI switches on. Keep these strings fixed.
const REACHES = 'reaches';                           // the agent shares the person's provider home
const SEPARATE_ACCOUNT = 'separate-account-folder';  // Claude agent on a non-default account folder
const CODEX_ISOLATED = 'codex-isolated-runtime';     // Codex private runtime excludes desktop plugins
const NOT_APPLICABLE = 'not-applicable';             // non-Claude/Codex runner: condition does not apply
const UNKNOWN = 'unknown';                            // the agent's runner/home could not be read

/*
 * Pure decision. Never throws for any input: a non-string or non-absolute home, or an unreadable
 * runner, yields UNKNOWN rather than a thrown TypeError or a spurious verdict.
 *
 *   runner           'claude' | 'codex' | 'gemini' | 'grok' | ... (case-insensitive, trimmed)
 *   agentClaudeDir   the agent's EFFECTIVE Claude config dir (absolute), or null/'' for a clean
 *                    default launch (CLAUDE_CONFIG_DIR unset). Only read for a Claude agent.
 *                    Prefer the pane's live CLAUDE_CONFIG_DIR where available (slice 2): it catches the
 *                    EFFECTIVE_CCD leak-pin that a default-account plist does not record. The plist
 *                    configDir is the fallback.
 *   personClaudeHome the person's own Claude home (absolute, = accounts.homeDir()/.claude)
 */
function reachFrom({ runner, agentClaudeDir, personClaudeHome } = {}) {
  const r = typeof runner === 'string' ? runner.trim().toLowerCase() : '';
  if (r === 'codex') return { reaches: false, reason: CODEX_ISOLATED };
  if (r === 'claude') {
    // The person's home must be a usable ABSOLUTE path, or reach cannot be judged for ANY agent on this
    // runner -- INCLUDING a default launch, which shares exactly this home. A relative or empty home is an
    // anomalous environment (e.g. a relative AGENT_WORKFORCE_HOME), so answer UNKNOWN, never guess. This
    // guard is deliberately ABOVE the default-launch return: a default launch on a non-absolute home would
    // otherwise report a reaches:true the signal cannot stand behind (kosmos#5309 review, Sonya).
    // (typeof check first: path.isAbsolute throws on a non-string.)
    if (typeof personClaudeHome !== 'string' || !path.isAbsolute(personClaudeHome)) {
      return { reaches: null, reason: UNKNOWN };
    }
    // Clean default launch: CLAUDE_CONFIG_DIR unset -> effective dir is the person's (absolute) home.
    if (agentClaudeDir == null || agentClaudeDir === '') return { reaches: true, reason: REACHES };
    // The agent dir must also be a usable absolute path to compare (path.resolve would resolve a relative
    // value against the process cwd and could spuriously match): report UNKNOWN, never guess.
    if (typeof agentClaudeDir !== 'string' || !path.isAbsolute(agentClaudeDir)) {
      return { reaches: null, reason: UNKNOWN };
    }
    // Compare RESOLVED paths so 'h/./.claude' and 'h/.claude/' are not read as different folders.
    // (Not symlink- or case-resolved: a case/symlink difference reads as a separate folder, which is
    // the safe direction -- it over-reports a mismatch, never a spurious reach.)
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
 * when set, else (for Claude) the person's ~/.claude via the null-default in reachFrom. `deps` is
 * injectable so tests need no real plist. Runner interpretation is left entirely to reachFrom, so the
 * two never normalise the runner differently.
 *
 * Slice 2: where the live pane env is available, pass the pane's CLAUDE_CONFIG_DIR as agentClaudeDir
 * instead of the plist value, to catch the EFFECTIVE_CCD leak-pin on a default-account agent (see the
 * module header).
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
  // Pass the plist configDir straight through (null when unset); reachFrom reads it only for Claude and
  // treats null as the default home. No runner check here, so no second normalisation to drift.
  const configDir = (typeof job.configDir === 'string' && job.configDir) ? job.configDir : null;
  return reachFrom({ runner, agentClaudeDir: configDir, personClaudeHome });
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
