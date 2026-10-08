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
 * Pure decision. Never throws for ANY input: a null or non-object argument, a non-string / relative /
 * '..'-bearing home or agent dir, or an unreadable runner all yield UNKNOWN (reaches: null), never a
 * thrown TypeError or a spurious verdict.
 *
 *   runner           'claude' | 'codex' | 'gemini' | 'grok' | ... (case-insensitive, trimmed)
 *   agentClaudeDir   the agent's EFFECTIVE Claude config dir (absolute, no '..'), or null/'' for a clean
 *                    default launch (CLAUDE_CONFIG_DIR unset). Only read for a Claude agent.
 *                    Prefer the pane's live CLAUDE_CONFIG_DIR where available (slice 2): it catches the
 *                    EFFECTIVE_CCD leak-pin that a default-account plist does not record. The plist
 *                    configDir is the fallback.
 *   personClaudeHome the person's own Claude home (absolute, = accounts.homeDir()/.claude)
 */
function reachFrom(input) {
  const { runner, agentClaudeDir, personClaudeHome } = (input && typeof input === 'object') ? input : {};
  const r = typeof runner === 'string' ? runner.trim().toLowerCase() : '';
  if (r === 'codex') return { reaches: false, reason: CODEX_ISOLATED };
  if (r === 'claude') {
    // The person's home must be a usable ABSOLUTE path with no '..' segment, or reach cannot be judged for
    // ANY agent on this runner -- INCLUDING a default launch, which shares exactly this home. A relative,
    // empty, or '..'-bearing home is an anomalous environment (e.g. a relative AGENT_WORKFORCE_HOME), so
    // answer UNKNOWN, never guess. This guard sits ABOVE the default-launch return on purpose: a default
    // launch on such a home would otherwise report a reaches:true the signal cannot stand behind.
    // (typeof check first: path.isAbsolute throws on a non-string.)
    if (typeof personClaudeHome !== 'string' || !path.isAbsolute(personClaudeHome) || personClaudeHome.split(/[\\/]/).includes('..')) {
      return { reaches: null, reason: UNKNOWN };
    }
    // Clean default launch: CLAUDE_CONFIG_DIR unset -> effective dir is the person's (absolute) home.
    if (agentClaudeDir == null || agentClaudeDir === '') return { reaches: true, reason: REACHES };
    // The agent dir must be a usable absolute path with NO '..' segment. path.resolve is purely lexical:
    // it collapses '..' WITHOUT following symlinks, so a crafted '/p/link/../.claude' could otherwise
    // resolve equal to the person home and yield a spurious reaches:true. Reject '..' (and a relative or
    // non-string dir) as UNKNOWN rather than risk the dangerous direction.
    if (typeof agentClaudeDir !== 'string' || !path.isAbsolute(agentClaudeDir) || agentClaudeDir.split(/[\\/]/).includes('..')) {
      return { reaches: null, reason: UNKNOWN };
    }
    // Compare RESOLVED paths so 'h/./.claude' and 'h/.claude/' are not read as different folders. Both
    // dirs are '..'-free absolute paths here, so a remaining case/symlink difference reads as a separate
    // folder -- the safe direction: it over-reports a mismatch, never a spurious reach.
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
 * injectable so tests need no real plist. Runner AND dir interpretation are left entirely to reachFrom,
 * so the resolver and the core never judge the same input differently. A readJob or homeDir that throws,
 * or no readable job, yields UNKNOWN (the tests lock this in).
 *
 * Slice 2: where the live pane env is available, pass the pane's CLAUDE_CONFIG_DIR as agentClaudeDir
 * instead of the plist value, to catch the EFFECTIVE_CCD leak-pin on a default-account agent (see the
 * module header).
 */
function reachForAgent(agentName, deps = {}) {
  const create = deps.create || require('./create');
  const accounts = deps.accounts || require('./accounts');
  let personClaudeHome = '';
  try {
    const rawHome = accounts.homeDir();
    // Guard the RAW home BEFORE path.join collapses a '..': reachFrom's '..' guard cannot see a '..' that
    // join has already normalised away (homeDir '/q/link/..' + '.claude' joins to '/q/.claude'). Join only
    // a clean absolute no-'..' home; otherwise pass the raw value so reachFrom's own guard returns UNKNOWN
    // rather than a false reaches:true.
    personClaudeHome = (typeof rawHome === 'string' && path.isAbsolute(rawHome) && !rawHome.split(/[\\/]/).includes('..'))
      ? path.join(rawHome, '.claude')
      : rawHome;
  } catch { personClaudeHome = ''; }
  let job = null;
  try { job = create.readJob(agentName); } catch { job = null; }
  if (!job) return { reaches: null, reason: UNKNOWN };
  const runner = job.runner || 'claude';
  // Pass configDir through UNCHANGED (only null/undefined -> null); reachFrom judges its type and shape,
  // so a non-string value becomes UNKNOWN there rather than a false default-launch here. Coercing a
  // non-string to null here would make the resolver and the core disagree on the same input.
  const configDir = (job.configDir === null || job.configDir === undefined) ? null : job.configDir;
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
