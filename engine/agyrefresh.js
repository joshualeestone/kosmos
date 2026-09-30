'use strict';
/**
 * kosmos#4353: write Kosmos's report hook for every Antigravity (agy) agent that is ALREADY
 * running and has NO Kosmos hook yet, once, at board start.
 *
 * Why this is needed: the hook is otherwise written only by agent-supervisor.sh, before a
 * launch (#4043). An update replaces the supervisor FILE, but a supervisor that was already
 * running keeps executing the copy it started with, and the board adopts running agents instead
 * of restarting them. So an agy agent launched before #4043 kept showing "Can't tell" through
 * every update until somebody restarted it.
 *
 * Why writing the file is enough: agy picks up a hooks.json written while it runs, on its next
 * turn (measured 2026-09-28 on agy 1.2.12; kosmos#4353 comment 5872366045). No restart.
 *
 * ONLY WHERE NO WORKING KOSMOS ENTRY EXISTS (none, or a broken one, repaired below). An agent the supervisor has already hooked is left to the
 * supervisor: the board's node path is not spelled the way the supervisor spells it, and
 * rewriting the entry at every board start (then back at every launch) would churn the file of
 * a running agent for nothing. Only running agents are visited; a stopped one is hooked when it
 * starts. Only this Kosmos's agents (runningJobs is world-scoped): an agy agent kept running in
 * another Kosmos is hooked when that Kosmos's board starts. Nothing is written when the bridge
 * the hook would run is missing: its PreInvocation and Stop handlers would fail on every turn,
 * and a later current supervisor would find an entry to leave alone.
 * An entry that is there but broken (a node or bridge gone) is REPAIRED, keeping its ask_question
 * tool hooks if it had them: a current supervisor wrote those after checking agy was new enough.
 * refreshRunningAgyHooks never throws (every dependency call is caught into a row). Building the
 * production wiring can: refreshAtBoardStart's caller in server.js catches that and says so.
 */
const fs = require('node:fs');
const path = require('node:path');

/** The object entry named `hookName` in `<workdir>/.agents/hooks.json`, or null (unreadable, absent,
    or not an object: a null, a string or a list there is malformed and ensureHooks replaces it). */
function readEntry(workdir, hookName) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(workdir, '.agents', 'hooks.json'), 'utf8'));
    const e = j && typeof j === 'object' ? j[hookName] : null;
    return e && typeof e === 'object' && !Array.isArray(e) ? e : null;
  } catch { return null; }
}

/** Does this event's first handler run `'<node>' '<bridge>' ...` with both paths present? A tool
    event (PreToolUse, PostToolUse) nests its handler one level down, under a matcher. */
function runsLive(e, ev) {
  const first = Array.isArray(e[ev]) ? e[ev][0] : null;
  const h = first && Array.isArray(first.hooks) ? first.hooks[0] : first;
  const cmd = h && typeof h.command === 'string' ? h.command : '';
  const quoted = require('./agyhooks').shUnquoteAll(cmd);   // the inverse of the shQuote that wrote it
  return quoted.length >= 2 && quoted.slice(0, 2).every((p) => fs.existsSync(p));
}

/** Is there a WORKING Kosmos entry: both halves ensureHooks writes (PreInvocation reports Working,
    Stop reports Idle), each naming a node and a bridge that exist? One that cannot be read that way,
    or whose node or bridge is gone (a node an upgrade removed), fails on every turn; it counts as
    absent so it is written again. Unreadable = no. */
function hasKosmosHook(workdir, hookName) {
  const e = readEntry(workdir, hookName);
  if (!e || !runsLive(e, 'PreInvocation') || !runsLive(e, 'Stop')) return false;
  // A tool hook, when present, must run too: a dead PreToolUse answers nothing, and agy reads
  // that as a DENY of ask_question (agyhooks.js), which is worse than no hook.
  return ['PreToolUse', 'PostToolUse'].every((ev) => !(ev in e) || runsLive(e, ev));
}

/** Did the entry being replaced carry the ask_question tool hooks? Only a current supervisor writes
    them, after checking agy is new enough, so a repair keeps them. */
function hadToolHooks(workdir, hookName) {
  const e = readEntry(workdir, hookName);
  return !!e && Array.isArray(e.PreToolUse) && e.PreToolUse.length > 0;
}

/**
 * `deps` (all injectable, for tests):
 *   names()           -> iterable of running agent names
 *   job(name)         -> { runner, claude (the runner binary) } or null
 *   workdir(name)     -> the folder the supervisor launches it in
 *   hasHook(workdir)  -> whether a working Kosmos entry is already there
 *   hadToolHooks(workdir) -> whether the entry being replaced had the tool hooks (optional; no)
 *   ensureHooks(workdir, nodeBin, bridge, withToolHooks) -> { ok, changed, why, enabled? }
 *   nodeBin, bridge   -> what the hook runs; bridgeExists() -> boolean
 * Resolves one row per antigravity agent visited: { name, ok, changed, why }.
 */
async function refreshRunningAgyHooks(deps) {
  const rows = [];
  let bridgeThere = false;
  try { bridgeThere = !!deps.bridgeExists(); } catch { bridgeThere = false; }
  if (!bridgeThere) return rows;
  let names;
  try { names = [...deps.names()]; } catch { return rows; }
  for (const name of names) {
    let job = null;
    try { job = deps.job(name); } catch { job = null; }
    // The runner is recorded as 'antigravity' (create.isNonClaudeRunner); `agy` is its binary.
    if (!job || job.runner !== 'antigravity') continue;
    let wd = null;
    try { wd = deps.workdir(name); } catch { wd = null; }
    if (!wd) { rows.push({ name, ok: false, changed: false, why: 'no working folder' }); continue; }
    let has = false;
    try { has = !!deps.hasHook(wd); } catch { has = false; }
    if (has) { rows.push({ name, ok: true, changed: false, why: 'already hooked' }); continue; }
    // The supervisor is another process and can write between this check and the write below.
    // If it does and this write lands second, its entry (which may carry the ask_question tool
    // hooks) is replaced by a Working/Idle-only one until the agent's next launch: the card
    // still reports Working and Idle, and only needs_you for a question is lost meanwhile. The
    // window is a board start racing an agy launch.
    let r;
    // Working/Idle hooks only here, not the ask_question tool hooks: this writes into a process
    // that may have started BEFORE the update, and the agy binary on disk (the only one that could
    // be asked its version) may be newer than the running one. The tool hooks are only safe on an
    // agy new enough for them (agyhooks MIN_TOOL_HOOKS), so they wait for a CURRENT supervisor,
    // which rewrites the entry with them when it next starts (the old supervisor's own relaunch
    // loop never touches hooks.json, so an agy crash alone does not bring them). The one
    // exception: repairing a broken entry that already HAD them, which only a current supervisor
    // writes, so this agy was already checked.
    let keepTools = false;
    try { keepTools = !!(deps.hadToolHooks && deps.hadToolHooks(wd)); } catch { keepTools = false; }
    try {
      r = deps.ensureHooks(wd, deps.nodeBin, deps.bridge, keepTools);
    } catch (err) {
      r = { ok: false, changed: false, why: String((err && err.message) || err) };
    }
    rows.push({ name, ok: !!(r && r.ok), changed: !!(r && r.changed), why: (r && r.why) || '' });
  }
  return rows;
}

/** The plist's recorded launch folder (argument 3): what the supervisor was started with, unless
    the job was rewritten since without a restart. Falls back to create.workerDir(name) (what
    plistFor writes there) only when argument 3 is missing; an unreadable plist has already
    skipped the agent (readJob returns null), so in practice this is a belt, not a path. */
function launchDir(create, name) {
  let read = null;
  try { read = create.plistArgs(name); } catch { read = null; }
  if (read && read.args[3]) return read.args[3];
  return create.workerDir(name);
}

/** `launchDir`, or null when that folder is not there. ensureHooks makes the folders above the file it
    writes, so a running agent whose folder was deleted or moved would get the folder back, empty. */
function existingLaunchDir(create, name) {
  const wd = launchDir(create, name);
  return (wd && fs.existsSync(wd)) ? wd : null;
}

/** What the board-start refresh is wired to: create.js for the agents and bridge, agyhooks for the write.
    Built apart from the run so a test can build it (it asks launchd nothing until `names` is called). */
function productionDeps() {
  const create = require('./create');
  const agyhooks = require('./agyhooks');
  const bridge = create.agyBridgePath();
  return {
    names: () => create.runningJobs(),
    job: (name) => create.readJob(name),
    workdir: (name) => existingLaunchDir(create, name),
    hasHook: (wd) => hasKosmosHook(wd, agyhooks.HOOK_NAME),
    hadToolHooks: (wd) => hadToolHooks(wd, agyhooks.HOOK_NAME),
    ensureHooks: agyhooks.ensureHooks,
    // Not process.execPath: a versioned Homebrew path dies at the next upgrade, and this entry
    // outlives the board in a running agent nobody restarts (allowance.stableNode's reason).
    // The supervisor resolves its node on its own (bin/agent-supervisor.sh) and spells it
    // differently (`$_eng/../../runtime/bin/node`, unnormalised), so the two entries never match
    // byte for byte; that is why only an ABSENT entry is written here.
    nodeBin: require('./allowance').stableNode(),
    bridge,
    bridgeExists: () => fs.existsSync(bridge),
  };
}

/** The production run. */
async function refreshAtBoardStart() {
  // agy hooks are Unix only (agyhooks' sh -c quoting) and Kosmos runs no agy agent on Windows.
  if (process.platform === 'win32') return [];
  return refreshRunningAgyHooks(productionDeps());
}

module.exports = { refreshRunningAgyHooks, refreshAtBoardStart, productionDeps, existingLaunchDir, hasKosmosHook, hadToolHooks, launchDir };
