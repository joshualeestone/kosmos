'use strict';

/**
 * #1598: fail-closed authorization for the modules that run live `launchctl` and
 * `tmux` (engine/remove.js, engine/delete-leftover.js). Their `run()` went live
 * on a fresh require, because remove.js's dry-run default was OFF and
 * delete-leftover.js had none, and nothing on this box sets
 * `AGENT_WORKFORCE_DRY_RUN`. So a test that required either module and forgot to
 * inject a runner reached live `execFileSync`, and the targets are real: on this
 * machine that is ten live launchd jobs including the board, and eighteen live
 * tmux sessions, one per fleet agent. A booted launchd job returns at next
 * login; a killed tmux session and its context do not.
 *
 * 🔑 THE GATE IS ON EXPLICIT INTENT, NOT ON WHICH BINARY OR VERB. #1539's guard
 * matched `file === '/bin/launchctl'` and enumerated five verbs; both were
 * narrower than the class. delete-leftover.js spells `launchctl` bare, and the
 * same `run()` also does `tmux kill-session`, which no launchctl-shaped guard
 * can see. Authorization cannot be inferred from the command; it is stated.
 *
 * Production states its intent once (server.js calls `allowLiveExecution()` in
 * its real-start path, NOT at module load, because tests require server.js as a
 * module and a load-time opt-in would arm live execution in every route test).
 * Everything else fails closed.
 *
 * ⚠️ THE TWO FAILURE DIRECTIONS ARE HANDLED DIFFERENTLY, ON PURPOSE:
 *
 *  - A PRODUCTION run that missed the opt-in must NOT be fatal. A board that
 *    refuses to start because it could not authorize a removal is strictly worse
 *    than one running on the previous supervisor (#310: fifteen of sixteen agents
 *    had no job, found by a restart; Renet's constraint). So production WARNS
 *    loudly on stderr and dry-runs. Loud, not fatal.
 *
 *  - A TEST that forgot to install a seam must THROW, not dry-run. A silent
 *    dry-run lets the test assert against a fiction (it believes the job was
 *    booted; nothing was). Refusing surfaces the missing seam (PigeonPete's
 *    finding, safebin-1598). Keyed on `process.execArgv` containing `--test`,
 *    NOT on NODE_TEST_CONTEXT: that env var is INHERITED by child processes, so
 *    a real server a test spawns would carry it and a guard keyed on the env
 *    would fire inside a server that legitimately needs launchctl. execArgv is
 *    per-process and is not inherited, so it separates the three cases, measured:
 *        test process       execArgv has --test
 *        server it spawns   execArgv does NOT
 *        production         execArgv does NOT
 */

let allowed = false;

/** Production opt-in. Called once, from server.js's real-start path. */
function allowLiveExecution() { allowed = true; }

/** The gate every guarded `run()` consults before going live. */
function liveExecutionAllowed() { return allowed; }

/** Put the gate back to fail-closed. For tests, harmless in production. */
function resetForTests() { allowed = false; }

/** True only in a `node --test` process itself, not in a child it spawns. */
function inTestProcess() {
  try { return process.execArgv.some((a) => String(a).startsWith('--test')); }
  catch { return false; }
}

/**
 * Called by a guarded `run()` when it is about to go live but is NOT authorized
 * and has no runner. In a test process it THROWS (refusing to fake success past
 * a missing seam); in production it WARNS loudly and returns, so the caller
 * fails closed to a dry-run rather than stopping the board.
 */
function refuseOrWarn(moduleName, file, args) {
  const cmd = file + ' ' + (Array.isArray(args) ? args.join(' ') : '');
  if (inTestProcess()) {
    throw new Error(
      moduleName + ' tried to execute "' + cmd + '" for real inside a test '
      + 'process with no runner and no opt-in. Install a seam first: setRunner(fn), '
      + 'or setDryRun(true) where available. Refusing rather than faking success, '
      + "because this reaches the operator's live launchd and tmux.",
    );
  }
  process.stderr.write(
    '[live-execution] ' + moduleName + ': not authorized to run live, dry-running "'
    + cmd + '" and doing nothing. Production must call '
    + 'live-execution.allowLiveExecution() at startup.\n',
  );
}

module.exports = {
  allowLiveExecution, liveExecutionAllowed, resetForTests, refuseOrWarn, inTestProcess,
};
