'use strict';
/**
 * Leave when the process that started us is gone (#570).
 *
 * 🛑 WHY THIS EXISTS. Kosmos's Windows tasks run node under
 * `conhost.exe --headless`, so no window opens that a person could close.
 * Measured 2026-09-10: without that, each agent and the board opened a Windows
 * Terminal window, and closing it killed them with 0xC000013A. But `schtasks /End`
 * ends a task by terminating ITS process, which is now the headless conhost, and
 * node, its child, was measured still running 10s later. Kosmos's own stops rely
 * on `/End` (`win32job.end`, and the board's End -> wait -> Run restart). Without
 * this they would orphan the very process they meant to stop. With this watch in
 * place, node was measured exiting about 2s after `/End`.
 *
 * Under a task registered before the headless change, the parent is Task
 * Scheduler's svchost, which never exits, so the watch never fires. That makes
 * this safe for every task already on a box.
 */

/** How often the parent is checked. At one second, `/End` to exit measured about
    2s. That is far inside the 30s the board's restart waits for the old board to
    go, and each check is a single syscall. */
const PARENT_POLL_MS = 1000;

/**
 * Is that pid still on this machine? `kill(pid, 0)` sends no signal. ESRCH means
 * it is gone. Anything else (EPERM on a process we may not touch) means it is still
 * there, so a doubt fails toward staying up, never toward leaving.
 */
function aliveFromError(e) { return !(e && e.code === 'ESRCH'); }

/**
 * The same question with the doubt kept: 'alive', 'gone' (ESRCH), or 'unknown' when the check
 * itself fails some other way. EPERM is 'alive': the process exists and belongs to someone else.
 * engine/win32update.js needs the third answer, because its lock treats a verifiably running
 * owner and an unverifiable one differently.
 */
function pidState(pid, kill) {
  const signal = typeof kill === 'function' ? kill : (p, s) => process.kill(p, s);
  try { signal(pid, 0); return 'alive'; } catch (e) {
    if (e && e.code === 'ESRCH') return 'gone';
    if (e && e.code === 'EPERM') return 'alive';
    return 'unknown';
  }
}

/** pidState, with a doubt failing toward alive (aliveFromError's rule). */
function pidAlive(pid, kill) { return pidState(pid, kill) !== 'gone'; }

/**
 * Call `onGone` once, as soon as the parent process is gone.
 *
 * Never throws: not while arming, not on a check, and not from `onGone`. The timer
 * is unref'd, so the watch alone never keeps a process alive.
 *
 * @returns {{armed: boolean, stop: () => void}}
 */
function exitWhenParentGone(opts) {
  const o = opts || {};
  const parentPid = Number.isInteger(o.parentPid) ? o.parentPid : process.ppid;
  const isAlive = typeof o.isAlive === 'function' ? o.isAlive : pidAlive;
  const onGone = typeof o.onGone === 'function' ? o.onGone : () => process.exit(0);
  const every = Number.isFinite(o.pollMs) ? o.pollMs : PARENT_POLL_MS;
  const startTimer = o.setInterval || setInterval;
  const stopTimer = o.clearInterval || clearInterval;
  if (!Number.isInteger(parentPid) || parentPid <= 0) return { armed: false, stop() {} };

  let done = false;
  const timer = startTimer(() => {
    if (done) return;
    let alive;
    try { alive = isAlive(parentPid); } catch { alive = true; }
    if (alive) return;
    done = true;
    stopTimer(timer);
    try { onGone(parentPid); } catch { /* the watch must never throw into the process it guards */ }
  }, every);
  if (timer && typeof timer.unref === 'function') timer.unref();
  return { armed: true, timer, stop() { done = true; stopTimer(timer); } };
}

module.exports = { exitWhenParentGone, pidAlive, pidState, aliveFromError };
