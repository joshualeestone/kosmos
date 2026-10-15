'use strict';
/* #6205: close a check's browser/context without hanging the shared run queue.

   🛑 WHY. mobile-shots.js awaited ctx.close() and browser.close() with no time limit. When the engine process
   dies underneath a run (a webkit crash, the context closing on its own), those awaits never resolve: node stays
   alive at 0% CPU, its engine child idle, holding the shared run queue until a person stops it by pid. Observed
   2026-10-14 (#6205): a --strict run hit a page.goto timeout on webkit, the webkit context then closed on its
   own, and the process sat for 3h06m instead of failing in seconds.

   🔑 THE FIX. Race each close against a timer. If a browser close does not return within the limit (a wedged
   engine), SIGKILL the engine by its OWN pid -- never a pattern, never pkill. The pid is read from node's own
   child table at launch (ppid === ours), because Playwright's Browser from launch() exposes no process()
   accessor (only BrowserServer and ElectronApplication do, measured against playwright 1.62.1). A dead engine
   then fails the run in seconds rather than hanging it. */

const { execFileSync } = require('node:child_process');

// A healthy close is well under a second; a close past this bound means a wedged engine.
const CTX_CLOSE_MS = 10000;
const BROWSER_CLOSE_MS = 10000;

/* Resolve with `promise`, or reject (with a `timedOut` error) after `ms`. The timer is unref'd so it can never
   on its own keep the node process alive, and it is cleared the moment the promise settles. A late rejection of
   `promise` after the timer has already won is handled by Promise.race itself (it attaches a handler to every
   input), so it never surfaces as an unhandled rejection -- the #6022 class of teardown crash. */
function withTimeout(promise, ms, label) {
  let timer;
  const bomb = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error((label || 'operation') + ' did not return within ' + ms + 'ms'), { timedOut: true })), ms);
    if (timer && typeof timer.unref === 'function') timer.unref();
  });
  const settled = Promise.resolve(promise).finally(() => clearTimeout(timer));
  return Promise.race([settled, bomb]);
}

/* The pids node spawned directly (parent pid === `ppid`), read from ps. Used to force-kill a wedged engine by
   its own pid. `ps -A -o pid=,ppid=` is portable across macOS and Linux (-A = all processes on both; -e means
   "environment" on macOS, so it is NOT used); any failure returns []. */
function childPidsOf(ppid) {
  try {
    const out = execFileSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const kids = [];
    for (const line of out.split('\n')) {
      const m = line.trim().match(/^(\d+)\s+(\d+)$/);
      if (m && Number(m[2]) === Number(ppid)) kids.push(Number(m[1]));
    }
    return kids;
  } catch {
    return [];
  }
}

/* SIGKILL each pid, by pid (never a pattern). Returns the pids it signalled without error. A pid already gone
   throws ESRCH, which is exactly the goal, so it is swallowed. `kill` is injectable for the tests. */
function killPids(pids, kill) {
  const k = kill || ((pid) => process.kill(pid, 'SIGKILL'));
  const killed = [];
  for (const pid of pids || []) {
    try { k(pid); killed.push(pid); } catch { /* already gone, or not ours */ }
  }
  return killed;
}

/* Bound a browser teardown. If browser.close() does not return within `ms` (or rejects), SIGKILL the engine the
   launch added, so the run fails promptly instead of hanging. Never throws.

   🛑 #6205 (Liu Kang review): the engine often dies FIRST (the night this was filed, a webkit closed its own
   context before the close wedged), so a pid captured at launch may have been reused by the OS for an unrelated
   process by the time we kill, and on a shared box that could be another agent's. So re-read our live children
   at kill time and signal ONLY the captured pids that are STILL our children. A departed pid is never signalled,
   and another agent's process is never a child of this node, so it can never be hit. `childrenNow` is injectable
   for the tests; by default it re-reads childPidsOf(process.pid). */
async function closeBrowserBounded(browser, pids, opts) {
  const { ms = BROWSER_CLOSE_MS, kill, log = console.error, childrenNow } = opts || {};
  try {
    await withTimeout(browser.close(), ms, 'browser.close()');
  } catch (e) {
    const ours = (childrenNow || (() => childPidsOf(process.pid)))();
    const captured = pids || [];
    const live = captured.filter((p) => ours.includes(p));
    const dropped = captured.filter((p) => !ours.includes(p));
    const killed = killPids(live, kill);
    let msg = 'WARN  mobile-shots: ' + (e && e.message ? e.message : e) + '; ';
    if (killed.length) msg += 'force-killed the engine by pid (' + killed.join(', ') + ')';
    else if (!captured.length) msg += 'no engine pid was captured at launch';
    else msg += 'no captured engine pid is still our child, so nothing was killed';
    if (dropped.length) msg += ' (skipped ' + dropped.join(', ') + ': no longer our children)';
    log(msg);
  }
}

/* Bound a context close the same way. A context that will not close means the engine is wedged; swallow it and
   let the caller tear the browser down (which kills the engine). Never throws. */
async function closeContextBounded(ctx, opts) {
  const { ms = CTX_CLOSE_MS, log = console.error } = opts || {};
  try {
    await withTimeout(ctx.close(), ms, 'ctx.close()');
  } catch (e) {
    log('WARN  mobile-shots: ' + (e && e.message ? e.message : e) + '; abandoning this context');
  }
}

module.exports = { withTimeout, childPidsOf, killPids, closeBrowserBounded, closeContextBounded, CTX_CLOSE_MS, BROWSER_CLOSE_MS };
