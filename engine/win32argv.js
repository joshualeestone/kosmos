'use strict';
/**
 * The argument vector a Windows agent's Scheduled Task runs, parsed in ONE place.
 *
 * 🔑 POSITIONAL, APPEND-ONLY, EVERY NEW ONE OPTIONAL AND DEFAULTED -- the Mac's
 * contract for `agent-supervisor.sh`, adopted deliberately. There is ONE
 * supervisor for every agent (the per-agent-copy version "shipped every bug N
 * times"), so the per-agent facts have to arrive as arguments, and a task
 * registered last week must keep working when a new argument is added. NEVER
 * REORDER THESE; add to the end.
 *
 *   argv:  <name> <cwd> [model] [configDir] [runner] [claudeBin] [world]
 *
 * 🛑 `claudeBin` IS ARGUMENT SIX, AND IT WAS ADDED BECAUSE THE TASK PATH LOST IT
 * (7c-2). `create.js` resolves the runner's absolute path (`runners.resolveBin`,
 * with the PATHEXT candidates #570 added) and used to hand it straight to
 * `win32launch.launch`. Once the TASK became the launcher, the only facts that
 * survive into the agent are the ones on this line -- and the resolved path was
 * not one of them, so every task-started agent fell back to a bare `claude` and
 * depended on the logon PATH carrying `%USERPROFILE%\.local\bin`. A task
 * registered before this argument existed passes five arguments, gets
 * `undefined`, and falls back as it always did.
 *
 * 🛑 `world` IS ARGUMENT SEVEN (#1704), FOR THE SAME REASON. Task Scheduler's Exec
 * action carries no environment, so the Kosmos an agent belongs to has to ride on
 * this line or it is lost, and an agent of a named Kosmos would read the DEFAULT
 * world's store: its sender token, its session record and its board token, every
 * one refused or unseen by the board that made it (#2827). It is written only
 * for a named world (win32job.taskExec), so a default-world task's line is
 * unchanged, and a task registered before it existed is a default-world agent,
 * which is exactly what it was.
 *
 * ⚠️ A LEAF, WITH NO REQUIRES, because the anchored boot shim parses the world
 * with this BEFORE it loads any module that freezes store.ROOT -- the world's
 * roots have to be in the environment first (win32anchor.BOOT_JS).
 */
function specFromArgv(argv) {
  const a = Array.isArray(argv) ? argv : [];
  const at = (i) => (typeof a[i] === 'string' && a[i] !== '' && a[i] !== '-' ? a[i] : undefined);
  return {
    name: at(0),
    cwd: at(1),
    model: at(2),
    configDir: at(3),
    runner: at(4) || 'claude',
    claudeBin: at(5),
    world: at(6),
  };
}

module.exports = { specFromArgv };
