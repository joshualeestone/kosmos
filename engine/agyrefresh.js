'use strict';
/**
 * kosmos#4353: write Kosmos's report hook for every Antigravity (agy) agent that is ALREADY
 * running, once, at board start.
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
 * Only RUNNING agents are visited: a stopped one gets its hook from the supervisor when it next
 * starts. Everything else is agyhooks.ensureHooks, unchanged: never in a git project, the
 * person's `enabled` flag kept, their other hooks untouched. Best effort; never throws.
 */
const { spawnSync } = require('node:child_process');

/**
 * `deps` (all injectable, for tests):
 *   names()           -> iterable of running agent names
 *   job(name)         -> { runner, claude (the runner binary), workdir } or null
 *   ensureHooks(workdir, nodeBin, bridge, withToolHooks) -> { ok, changed, why }
 *   toolHooksSafe(versionText) -> boolean
 *   versionOf(bin)    -> the binary's `--version` text, or '' (called once per binary)
 *   nodeBin, bridge   -> what the hook runs
 * Returns one row per agy agent: { name, ok, changed, why }.
 */
function refreshRunningAgyHooks(deps) {
  const rows = [];
  const versions = new Map();
  let names;
  try { names = [...deps.names()]; } catch { return rows; }
  for (const name of names) {
    let job = null;
    try { job = deps.job(name); } catch { job = null; }
    // The runner is recorded as 'antigravity' (create.isNonClaudeRunner); `agy` is its binary.
    if (!job || job.runner !== 'antigravity') continue;
    if (!job.workdir) { rows.push({ name, ok: false, changed: false, why: 'no working folder recorded' }); continue; }
    if (!versions.has(job.claude)) {
      let v = '';
      try { v = String(deps.versionOf(job.claude) || ''); } catch { v = ''; }
      versions.set(job.claude, v);
    }
    let r;
    try {
      r = deps.ensureHooks(job.workdir, deps.nodeBin, deps.bridge, deps.toolHooksSafe(versions.get(job.claude)));
    } catch (err) {
      r = { ok: false, changed: false, why: String((err && err.message) || err) };
    }
    rows.push({ name, ok: !!(r && r.ok), changed: !!(r && r.changed), why: (r && r.why) || '' });
  }
  return rows;
}

/** `<bin> --version`, first line, or '' (5 s cap: a hung binary must not hold the board). */
function versionOf(bin) {
  if (!bin) return '';
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 5000 });
  return r.status === 0 ? String(r.stdout || '').split('\n')[0] : '';
}

/** The production wiring: create.js for the agents and bridge, agyhooks for the write. */
function refreshAtBoardStart() {
  const create = require('./create');
  const agyhooks = require('./agyhooks');
  return refreshRunningAgyHooks({
    names: () => create.runningJobs(),
    job: (name) => create.readJob(name),
    ensureHooks: agyhooks.ensureHooks,
    toolHooksSafe: agyhooks.toolHooksSafe,
    versionOf,
    nodeBin: process.execPath,
    bridge: create.agyBridgePath(),
  });
}

module.exports = { refreshRunningAgyHooks, refreshAtBoardStart, versionOf };
