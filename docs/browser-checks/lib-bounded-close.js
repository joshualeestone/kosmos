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

/* Resolve with `promise`, or reject (with a `timedOut` error) after `ms`. The timer is the watchdog, so it is
   REF'd on purpose: a close that never settles must PRODUCE the timeout and let the caller react. An unref'd
   timer would not count toward keeping the loop alive, so if a hung close left nothing else pending, node would
   exit 0 with no verdict and the caller's own process.exit(code) would never run (#6205 review). The timer is
   cleared the moment the promise settles, so a healthy close adds no delay and leaves nothing lingering. A late
   rejection of `promise` after the timer has already won is handled by Promise.race itself (it attaches a handler
   to every input), so it never surfaces as an unhandled rejection -- the #6022 class of teardown crash. */
function withTimeout(promise, ms, label) {
  let timer;
  const bomb = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error((label || 'operation') + ' did not return within ' + ms + 'ms'), { timedOut: true })), ms);
  });
  const settled = Promise.resolve(promise).finally(() => clearTimeout(timer));
  return Promise.race([settled, bomb]);
}

/* The pid -> ppid map of every process, read from ps ONCE and parsed in one place (childPidsOf derives from it,
   so the read and the `/^(\d+)\s+(\d+)$/` parse are never duplicated). `ps -A -o pid=,ppid=` is portable across
   macOS and Linux (-A = all processes on both; -e means "environment" on macOS, so it is NOT used); any failure
   yields an empty map, so childPidsOf returns [] and descendantPids returns just the roots. */
function psParentMap() {
  const map = new Map();
  try {
    const out = execFileSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    for (const line of out.split('\n')) {
      const m = line.trim().match(/^(\d+)\s+(\d+)$/);
      if (m) map.set(Number(m[1]), Number(m[2]));
    }
  } catch { /* ps failed: empty map */ }
  return map;
}

/* The pids `ppid` spawned directly (its children), from one psParentMap read. Used to force-kill a wedged engine
   by its own pid. Empty on any ps failure. */
function childPidsOf(ppid) {
  const kids = [];
  for (const [pid, pp] of psParentMap()) if (pp === Number(ppid)) kids.push(pid);
  return kids;
}

/* Each pid in `roots` plus all its descendants, from a pid -> ppid map. An engine the launch added spawns the
   real browser and its helpers as GRANDCHILDREN (webkit and firefox launch through a wrapper, chromium spawns
   GPU and renderer helpers), so SIGKILLing only node's direct child would orphan them; walking the tree kills
   the engine the force-kill promises. A root with no entry in the map is still returned (so a reaped-root-only
   case still signals the root). Each pid is visited once, so a cycle cannot loop. */
function descendantPids(roots, parentMap) {
  const children = new Map();
  for (const [pid, ppid] of parentMap || new Map()) {
    if (!children.has(ppid)) children.set(ppid, []);
    children.get(ppid).push(pid);
  }
  const out = [];
  const seen = new Set();
  const stack = [...(roots || [])];
  while (stack.length) {
    const pid = stack.pop();
    if (seen.has(pid)) continue;
    seen.add(pid);
    out.push(pid);
    for (const kid of children.get(pid) || []) if (!seen.has(kid)) stack.push(kid);
  }
  return out;
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
   at kill time and signal ONLY the captured pids that are STILL our children, then reap each one's whole process
   tree (the engine is often a grandchild; see descendantPids). A departed pid is never a root, and another
   agent's process is never a child of this node, so it can never be hit. `childrenNow` and `parents` are
   injectable for the tests; by default they re-read childPidsOf(process.pid) and psParentMap(). */
async function closeBrowserBounded(browser, pids, opts) {
  const { ms = BROWSER_CLOSE_MS, kill, log = console.error, childrenNow, parents } = opts || {};
  try {
    await withTimeout(browser.close(), ms, 'browser.close()');
  } catch (e) {
    const ours = (childrenNow || (() => childPidsOf(process.pid)))();
    const captured = pids || [];
    const live = captured.filter((p) => ours.includes(p));
    const dropped = captured.filter((p) => !ours.includes(p));
    // Reap the whole tree under each live captured pid, not just the pid: the real engine is often a grandchild.
    const tree = live.length ? descendantPids(live, (parents || psParentMap)()) : [];
    const killed = killPids(tree, kill);
    let msg = 'WARN  mobile-shots: ' + (e && e.message ? e.message : e) + '; ';
    if (killed.length) msg += 'force-killed the engine process tree by pid (' + killed.join(', ') + ')';
    else if (!captured.length) msg += 'no engine pid was captured at launch';
    else msg += 'no captured engine pid is still our child, so nothing was killed';
    if (dropped.length) msg += ' (skipped ' + dropped.join(', ') + ': no longer our children)';
    log(msg);
  }
}

/* Bound a context close the same way. Returns true if the context closed within the bound, false if it timed
   out or the close rejected. A false means the engine is wedged, so the caller must stop using this browser and
   tear it down (which kills the engine) rather than opening another context on it -- an unbounded newContext on
   a wedged browser would reintroduce the hang (#6205 review). Never throws. */
async function closeContextBounded(ctx, opts) {
  const { ms = CTX_CLOSE_MS, log = console.error } = opts || {};
  try {
    await withTimeout(ctx.close(), ms, 'ctx.close()');
    return true;
  } catch (e) {
    log('WARN  mobile-shots: ' + (e && e.message ? e.message : e) + '; abandoning this context');
    return false;
  }
}

module.exports = { withTimeout, childPidsOf, psParentMap, descendantPids, killPids, closeBrowserBounded, closeContextBounded, CTX_CLOSE_MS, BROWSER_CLOSE_MS };
