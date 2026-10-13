'use strict';

/* #5309 part 2, slice 1: per-agent plugin REACH.
 *
 * Do the plugins/connectors the person installed in their own provider app reach THIS agent, and if
 * not, why? This is the signal the board needs to show the honest state the day-one report asked for:
 * "connected for you, but this agent cannot see it" (false-ready, no repair path).
 *
 * Home logic only. Slice 1 deliberately names no file inside a provider folder: the plugin-file shapes
 * (plugins/installed_plugins.json records, a populated settings.json enabledPlugins, Codex's
 * enabled-plugin record) were not pinned by kosmos#5309 part 1 and are not verifiable on
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
 * ONE known over-report REMAINS, documented and deliberately not closed: a default-account Claude agent
 * whose pane was pinned to another folder via a leaked tmux-global EFFECTIVE_CCD (bin/agent-supervisor.sh
 * ~888-902) is recorded reaches:true, because the plist configDir is null for it while the pane actually
 * runs elsewhere. The live pane env is NOT available at /api/status (only the plist configDir is), so
 * slice 2 cannot pass the pane's real CLAUDE_CONFIG_DIR. Because the board renders ONLY reaches:false,
 * this makes the board STAY SILENT in that narrow leaked-global case -- a missed notice, never a false
 * one, which is the safe direction for a UI whose fail-safe is silence. Closing it needs new snapshot
 * plumbing to surface the pane env; left to a follow-up. Treat a reaches:true as "reaches, unless the
 * pane was EFFECTIVE_CCD-pinned".
 *
 * WORLD SCOPING: the live caller is agentPluginReach (below), wired onto the /api/status per-agent map,
 * which passes the row's ALREADY-resolved runner + account.dir -- the same resolution the card's account
 * field uses. So reach is world-scoped exactly as that account field is (no separate world-keyed read),
 * which keeps reach and the account shown on the same card from ever disagreeing. agentPluginReach reads
 * no job itself, so there is no worldId for it to thread.
 */

const path = require('node:path');
const fs = require('node:fs');

// Stable reason codes slice 2's board/UI switches on. Keep these strings fixed.
const REACHES = 'reaches';                           // the agent shares the person's provider home
const SEPARATE_ACCOUNT = 'separate-account-folder';  // Claude agent on a non-default account folder
const CODEX_ISOLATED = 'codex-isolated-runtime';     // Codex private runtime excludes desktop plugins
const NOT_APPLICABLE = 'not-applicable';             // non-Claude/Codex runner: condition does not apply
const UNKNOWN = 'unknown';                            // the agent's runner/home could not be read
const NO_EVIDENCE = 'no-evidence';                   // #5309 slice 2: a reaches:false candidate, but the
                                                     // person added nothing this agent lacks -> render NOTHING.
                                                     // reaches:null like UNKNOWN (the board fires only on
                                                     // reaches===false), but distinct so a test/log can tell
                                                     // "nothing to warn about" from "could not read".

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
 *   personClaudeHome the person's own Claude home. The caller MUST pass the .claude dir itself
 *                    (accounts.homeDir()/.claude), absolute, not the home root: reachFrom compares it to
 *                    agentClaudeDir directly and does not append .claude or otherwise re-derive it.
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

/* ===========================================================================================
 * #5309 slice 2: the EVIDENCE gate.
 *
 * reachFrom answers the account/runner CONDITION (does this agent share the person's provider home).
 * On its own it fires reaches:false for EVERY secondary-account Claude agent and EVERY Codex agent,
 * whether or not the person added a single plugin -- a false warning on most agents (Liu Kang, #5309).
 * The board must warn only when there is EVIDENCE the person actually added something THIS agent lacks.
 * So a reaches:false from reachFrom is GATED here: it stands only if the person's enabled plugins / MCP
 * servers include at least one the agent's home does not. Nothing added, or unreadable -> render nothing.
 *
 * Reliable, shape-safe signals (documented keys, read defensively; an unknown value shape is tolerated,
 * a parse/read error is UNKNOWN, a missing file is a legitimate EMPTY set -- not an error):
 *   - enabledPlugins in settings.json  (ENABLED is what loads tools; sidesteps the installed_plugins.json
 *                                       record shape #5309 part 1 left unmeasured)
 *   - mcpServers in .claude.json       (top-level + per-project)
 *   - Codex: the person's ~/.codex has >=1 MCP server (config.toml) or plugin -> categorical, the isolated
 *            runtime excludes ALL of it by design (#4592), so no per-plugin diff, just presence.
 *
 * PERFORMANCE (Liu Kang, #5309; kept consistent with #5314/cardpost's read-once-per-poll pattern):
 * /api/status polls every few seconds, so the files are NOT re-read per agent per poll. Each folder's
 * set is cached keyed on its files' mtimes; a poll with unchanged mtimes does ZERO readFileSync (it
 * still statSyncs to check the mtime -- cheap, and the test asserts readFileSync, not statSync).
 * The caller resolves the person's paths ONCE per poll and passes them in, so they are not re-derived
 * per agent; the mtime cache de-dupes repeated agent folders and repeated polls alike.
 * `deps.fs` is injectable so a test can count reads and prove a second status read re-reads nothing.
 * =========================================================================================== */

const _folderSetCache = new Map(); // codexPersonPresence: cacheKey -> { mtimeKey, value: { present, readable } }
const _parseCache = new Map();     // `${file}\0${mtime}` -> { obj: parsed-or-null, readable } (folder-INDEPENDENT)

function _mtimeKey(fsDep, ...paths) {
  return paths.map((p) => {
    try { return String(fsDep.statSync(p).mtimeMs); } catch { return '-'; } // missing file is a stable '-'
  }).join('\0');
}

// Read + JSON.parse one file, cached by (path, mtime) and FOLDER-INDEPENDENT, so the SAME file is parsed at
// most once per poll however many agents/folders consult it (kosmos#5309: the person's ~/.claude.json is
// shared across every separate-account agent, not re-parsed per agent). ENOENT -> { obj: null, readable: true }
// (a home with no such file enabled nothing); any other read error or invalid JSON -> { obj: null, readable: false }.
function _parsedFile(fsDep, file) {
  const key = String(file) + '\0' + _mtimeKey(fsDep, file);
  const hit = _parseCache.get(key);
  if (hit) return hit;
  let v;
  try {
    const raw = fsDep.readFileSync(file, 'utf8');
    try { v = { obj: JSON.parse(raw), readable: true }; } catch { v = { obj: null, readable: false }; }
  } catch (e) { v = { obj: null, readable: (e && e.code === 'ENOENT') }; }
  _parseCache.set(key, v);
  return v;
}

// enabledPlugins ids from a settings.json: an object (keys) or an array (entries); anything else -> none.
function _enabledPluginIds(obj) {
  const e = obj && obj.enabledPlugins;
  if (Array.isArray(e)) return e;
  // An object maps plugin id -> enabled bool; ONLY an enabled (truthy) entry loads tools, so a `false`
  // value is a plugin the person turned OFF and must not count as "added" (kosmos#5309: it is a false notice).
  if (e && typeof e === 'object') return Object.keys(e).filter((k) => e[k]);
  return [];
}

// mcpServers names from a .claude.json: top-level ALWAYS, plus the per-project map keyed EXACTLY by this
// agent's own working folder (kosmos#5309, Liu Kang's ruling). A per-project server applies only to the
// folder it was added from, so one added in another repo was never this agent's to use -- counting it is
// the false warning. The caller passes agentFolder already canonicalized the way Claude Code keys projects
// (exact match, no prefix/ancestor); a null/unknown agentFolder falls back to top-level only (safe, missed).
function _mcpServerNames(obj, agentFolder) {
  const names = [];
  const top = obj && obj.mcpServers;
  if (top && typeof top === 'object' && !Array.isArray(top)) names.push(...Object.keys(top));
  const projects = obj && obj.projects;
  if (agentFolder && projects && typeof projects === 'object' && !Array.isArray(projects)) {
    const m = projects[agentFolder] && projects[agentFolder].mcpServers;
    if (m && typeof m === 'object' && !Array.isArray(m)) names.push(...Object.keys(m));
  }
  return names;
}

/*
 * The enabled-plugin + MCP-server id set for one Claude home, cached by the mtimes of its two files.
 * `settingsPath` is <dir>/settings.json. `claudeJsonPath` is the home's .claude.json -- which the CALLER
 * locates, because it differs: at the HOME ROOT (~/.claude.json) for the default home, INSIDE the config
 * dir (<CLAUDE_CONFIG_DIR>/.claude.json) for a non-default account (per the plugin-location rule).
 * `agentFolder` is this agent's own working folder (canonical), selecting WHICH per-project mcpServers entry
 * counts (kosmos#5309); null -> top-level mcpServers only. Returns { ids: Set<string>, readable: bool };
 * readable is false if EITHER file errored unreadably (-> UNKNOWN).
 */
function folderPluginSet(settingsPath, claudeJsonPath, agentFolder, deps) {
  const fsDep = (deps && deps.fs) || fs;
  // The PARSE is cached per (path, mtime) and folder-independent (so the person's files are read at most
  // once per poll however many agents consult them); the folder only selects which per-project mcpServers
  // entry is projected from the ALREADY-PARSED .claude.json (cheap, no I/O) -- read-once-per-poll preserved
  // across the per-agent folder scoping (kosmos#5309).
  const s = _parsedFile(fsDep, settingsPath);
  const c = _parsedFile(fsDep, claudeJsonPath);
  const spIds = s.obj ? _enabledPluginIds(s.obj) : [];
  const cjIds = c.obj ? _mcpServerNames(c.obj, agentFolder) : [];
  return { ids: new Set([...spIds.map(String), ...cjIds.map(String)]), readable: s.readable && c.readable };
}

/*
 * Whether the person's Codex home holds >=1 MCP server or plugin (categorical: the isolated runtime
 * excludes it wholesale, so presence, not a diff, is the evidence). Shape-tolerant -- a [mcp_servers...]
 * header in config.toml, or any entry under <codexHome>/plugins -- so it needs no TOML parser. Cached by
 * the mtimes of config.toml and the plugins dir. { present: bool, readable: bool }; a read error on
 * config.toml (not ENOENT) -> not readable (UNKNOWN). A missing home/file is readable + not present.
 */
function codexPersonPresence(codexHome, deps) {
  const fsDep = (deps && deps.fs) || fs;
  if (typeof codexHome !== 'string' || !path.isAbsolute(codexHome)) return { present: false, readable: false };
  const cfg = path.join(codexHome, 'config.toml');
  const pluginsDir = path.join(codexHome, 'plugins');
  const cacheKey = 'codex\0' + codexHome;
  const mtimeKey = _mtimeKey(fsDep, cfg, pluginsDir);
  const hit = _folderSetCache.get(cacheKey);
  if (hit && hit.mtimeKey === mtimeKey) return hit.value;
  let readable = true; let hasMcp = false; let hasPlugin = false;
  try { hasMcp = /^\s*\[\[?mcp_servers/m.test(fsDep.readFileSync(cfg, 'utf8')); }
  catch (e) { if (!e || e.code !== 'ENOENT') readable = false; }
  try { hasPlugin = fsDep.readdirSync(pluginsDir).some((n) => n !== '.' && n !== '..'); }
  catch (e) { if (e && e.code !== 'ENOENT') readable = false; } // a missing plugins dir is simply none
  const value = { present: readable && (hasMcp || hasPlugin), readable };
  _folderSetCache.set(cacheKey, { mtimeKey, value });
  return value;
}

/*
 * PURE combiner: gate a reachFrom result on gathered evidence. Only a reaches:false candidate is gated;
 * reaches:true / reaches:null pass through unchanged. For SEPARATE_ACCOUNT, `evidence` is the person's
 * and agent's folder sets; for CODEX_ISOLATED, the person's Codex presence. Never throws; unreadable
 * evidence -> UNKNOWN, nothing missing -> NO_EVIDENCE (both reaches:null -> the board renders nothing).
 */
function gateOnEvidence(reach, evidence) {
  if (!reach || reach.reaches !== false) return reach;
  const ev = evidence || {};
  if (reach.reason === SEPARATE_ACCOUNT) {
    const person = ev.personSet; const agent = ev.agentSet;
    if (!person || !agent || person.readable !== true || agent.readable !== true) return { reaches: null, reason: UNKNOWN };
    const missing = [...person.ids].filter((id) => !agent.ids.has(id));
    if (missing.length > 0) return { reaches: false, reason: SEPARATE_ACCOUNT, folder: reach.folder, missing };
    return { reaches: null, reason: NO_EVIDENCE };
  }
  if (reach.reason === CODEX_ISOLATED) {
    const cx = ev.codex;
    if (!cx || cx.readable !== true) return { reaches: null, reason: UNKNOWN };
    return cx.present ? { reaches: false, reason: CODEX_ISOLATED } : { reaches: null, reason: NO_EVIDENCE };
  }
  return reach;
}

/*
 * Live entry for the /api/status caller: the per-agent reach WITH the evidence gate.
 *   inputs.runner / inputs.agentClaudeDir  -> the account/runner condition (as reachFrom)
 *   inputs.personClaudeDir / inputs.personClaudeJson -> the person's ~/.claude dir and its .claude.json
 *                                            (at the home ROOT), resolved ONCE per poll by the caller
 *   inputs.personCodexHome                 -> the person's ~/.codex, for the Codex categorical check
 *   inputs.agentWorkFolder                 -> this agent's own working folder (canonical), selecting which
 *                                            per-project mcpServers count (kosmos#5309); null -> top-level only.
 *                                            May be a FUNCTION (lazy thunk): resolved only on the separate-account
 *                                            path that uses it, so its syscalls never run for a reaching agent.
 * The agent's own .claude.json is <agentClaudeDir>/.claude.json (inside the config dir). Reads are
 * mtime-cached (folderPluginSet / codexPersonPresence), so this is cheap to call per agent every poll.
 */
function agentPluginReach(inputs, deps) {
  const i = (inputs && typeof inputs === 'object') ? inputs : {};
  // Default the runner the SAME way readJob does: a null/undefined runner is a default
  // launch, which is Claude. The /api/status caller's row runner (runnerOfCard) is null for exactly that
  // case (null and 'claude' are indistinguishable to the board), so a separate-account Claude agent with
  // an unrecorded runner must still be judged as Claude, not fall to UNKNOWN. A present-but-empty runner
  // stays as-is (reachFrom reads it as UNKNOWN) -- only null/undefined defaults.
  const runner = (i.runner === null || i.runner === undefined) ? 'claude' : i.runner;
  const reach = reachFrom({ runner, agentClaudeDir: i.agentClaudeDir, personClaudeHome: i.personClaudeDir });
  if (!reach || reach.reaches !== false) return reach;
  if (reach.reason === SEPARATE_ACCOUNT) {
    // Resolve agentWorkFolder HERE, not at the caller, so its cost is paid ONLY on the separate-account path
    // that actually uses it (kosmos#5309 iter 3): a string is used as-is; a FUNCTION is a lazy thunk the
    // caller passes so the folder's syscalls (workerDir read + realpath) never run for a reaching / other-runner agent.
    const folder = (typeof i.agentWorkFolder === 'function') ? i.agentWorkFolder() : i.agentWorkFolder;
    const personSet = folderPluginSet(path.join(i.personClaudeDir, 'settings.json'), i.personClaudeJson, folder, deps);
    const agentSet = folderPluginSet(path.join(i.agentClaudeDir, 'settings.json'), path.join(i.agentClaudeDir, '.claude.json'), folder, deps);
    return gateOnEvidence(reach, { personSet, agentSet });
  }
  if (reach.reason === CODEX_ISOLATED) {
    return gateOnEvidence(reach, { codex: codexPersonPresence(i.personCodexHome, deps) });
  }
  return reach;
}

// Test-only: drop the per-folder mtime cache (so a read-count test starts from a known state).
function _resetCache() { _folderSetCache.clear(); _parseCache.clear(); }

module.exports = {
  reachFrom,
  agentPluginReach,
  folderPluginSet,
  codexPersonPresence,
  gateOnEvidence,
  _resetCache,
  REACHES,
  SEPARATE_ACCOUNT,
  CODEX_ISOLATED,
  NOT_APPLICABLE,
  UNKNOWN,
  NO_EVIDENCE,
};
