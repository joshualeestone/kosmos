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
 * ONLY WHERE NO KOSMOS ENTRY EXISTS. An agent the supervisor has already hooked is left to the
 * supervisor: the board's node path is not spelled the way the supervisor spells it, and
 * rewriting the entry at every board start (then back at every launch) would churn the file of
 * a running agent for nothing. Only running agents are visited; a stopped one is hooked when it
 * starts. Nothing is written when the bridge the hook would run is missing: agy reads an empty
 * answer from a PreToolUse hook as a DENY, which is worse than "Can't tell".
 * Never throws.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

/** Does `<workdir>/.agents/hooks.json` already carry an entry named `hookName`? Unreadable = no. */
function hasKosmosHook(workdir, hookName) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(workdir, '.agents', 'hooks.json'), 'utf8'));
    return !!(j && typeof j === 'object' && Object.prototype.hasOwnProperty.call(j, hookName));
  } catch { return false; }
}

/**
 * `deps` (all injectable, for tests):
 *   names()           -> iterable of running agent names
 *   job(name)         -> { runner, claude (the runner binary) } or null
 *   workdir(name)     -> the folder the supervisor launches it in
 *   hasHook(workdir)  -> whether a Kosmos entry is already there
 *   ensureHooks(workdir, nodeBin, bridge, withToolHooks) -> { ok, changed, why }
 *   toolHooksSafe(versionText) -> boolean
 *   versionOf(bin)    -> Promise of the binary's `--version` text, or '' (once per binary)
 *   nodeBin, bridge   -> what the hook runs; bridgeExists() -> boolean
 * Resolves one row per antigravity agent visited: { name, ok, changed, why }.
 */
async function refreshRunningAgyHooks(deps) {
  const rows = [];
  let bridgeThere = false;
  try { bridgeThere = !!deps.bridgeExists(); } catch { bridgeThere = false; }
  if (!bridgeThere) return rows;
  const versions = new Map();
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
    if (!versions.has(job.claude)) {
      let v = '';
      try { v = String((await deps.versionOf(job.claude)) || ''); } catch { v = ''; }
      versions.set(job.claude, v);
    }
    let r;
    try {
      r = deps.ensureHooks(wd, deps.nodeBin, deps.bridge, deps.toolHooksSafe(versions.get(job.claude)));
    } catch (err) {
      r = { ok: false, changed: false, why: String((err && err.message) || err) };
    }
    rows.push({ name, ok: !!(r && r.ok), changed: !!(r && r.changed), why: (r && r.why) || '' });
  }
  return rows;
}

/** `<bin> --version`, the first line of what it printed whatever its exit status (as the
    supervisor reads it: `head -n 1`), or ''. Asynchronous, and killed after 5 s, so a hung
    binary never holds the board. */
function versionOf(bin) {
  return new Promise((resolve) => {
    if (!bin) { resolve(''); return; }
    execFile(bin, ['--version'], { timeout: 5000, killSignal: 'SIGKILL', encoding: 'utf8' }, (_err, stdout) => {
      resolve(String(stdout || '').split('\n')[0]);
    });
  });
}

/** The production wiring: create.js for the agents and bridge, agyhooks for the write. */
function refreshAtBoardStart() {
  const create = require('./create');
  const agyhooks = require('./agyhooks');
  const bridge = create.agyBridgePath();
  return refreshRunningAgyHooks({
    names: () => create.runningJobs(),
    job: (name) => create.readJob(name),
    workdir: (name) => create.workerDir(name),   // the plist's launch folder (plistFor argument 3)
    hasHook: (wd) => hasKosmosHook(wd, agyhooks.HOOK_NAME),
    ensureHooks: agyhooks.ensureHooks,
    toolHooksSafe: agyhooks.toolHooksSafe,
    versionOf,
    nodeBin: process.execPath,
    bridge,
    bridgeExists: () => fs.existsSync(bridge),
  });
}

module.exports = { refreshRunningAgyHooks, refreshAtBoardStart, versionOf, hasKosmosHook };
