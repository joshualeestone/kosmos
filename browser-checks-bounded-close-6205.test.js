'use strict';

/**
 * #6205: mobile-shots.js awaited ctx.close() and browser.close() with no time limit, so when the engine died
 * underneath a run (a webkit crash, the context closing on its own) the awaits never resolved and the process
 * sat for 3h06m, holding the shared run queue. lib-bounded-close.js races each close against a timer and, on a
 * wedged browser close, SIGKILLs the engine by its OWN pid (never a pattern). A dead engine then fails the run
 * in seconds.
 *
 * This proof needs NO browser: a fake context/browser whose close() never resolves stands in for the dead engine,
 * and the pid resolver (childPidsOf) is checked against a real spawned child process. The kill is injected so the
 * test never signals a real process it did not spawn.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const { spawn } = require('node:child_process');

const {
  withTimeout, childPidsOf, psParentMap, descendantPids, killPids, closeBrowserBounded, closeContextBounded,
  BROWSER_CLOSE_MS, CTX_CLOSE_MS,
} = require('./docs/browser-checks/lib-bounded-close.js');

// A controlled pid->ppid map for the kill tests, so descendantPids walks THIS, never the real `ps` table (a real
// low pid like 99 could have real children and make an injected-pid assertion flaky). `noKids` = no descendants.
const noKids = () => new Map();

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const never = () => new Promise(() => {});   // a close that never resolves: the dead engine

test('#6205 control: a never-resolving close genuinely never settles (so a pass below is the timer, not luck)', async () => {
  const outcome = await Promise.race([never().then(() => 'SETTLED'), delay(120).then(() => 'STILL-PENDING')]);
  assert.equal(outcome, 'STILL-PENDING', 'the fake close must not resolve on its own, or the bound is untested');
});

test('#6205 withTimeout: resolves with a fast value, rejects timedOut on a slow one', async () => {
  assert.equal(await withTimeout(Promise.resolve('ok'), 1000, 'fast'), 'ok');
  await assert.rejects(() => withTimeout(never(), 40, 'slow'), (e) => e && e.timedOut === true && /did not return within 40ms/.test(e.message));
});

test('#6205 closeBrowserBounded: a wedged browser.close() returns within the bound AND force-kills the engine pid', async () => {
  const killed = [];
  const fakeBrowser = { close: () => never() };
  const t0 = Date.now();
  await closeBrowserBounded(fakeBrowser, [424242], { ms: 40, kill: (pid) => killed.push(pid), log: () => {}, childrenNow: () => [424242], parents: noKids });
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 2000, 'a wedged close must not hang; returned in ' + elapsed + 'ms');
  assert.deepEqual(killed, [424242], 'the engine pid captured at launch, still our child, must be SIGKILLed when the close wedges');
});

test('#6205 closeBrowserBounded: a healthy close resolves normally and kills nothing', async () => {
  const killed = [];
  let closed = false;
  const fakeBrowser = { close: async () => { closed = true; } };
  await closeBrowserBounded(fakeBrowser, [424242], { ms: 1000, kill: (pid) => killed.push(pid), log: () => {} });
  assert.equal(closed, true, 'a healthy close still runs');
  assert.deepEqual(killed, [], 'a close that returned must not trigger a kill');
});

test('#6205 closeBrowserBounded: a close that REJECTS (dead connection) also force-kills, and never throws', async () => {
  const killed = [];
  const fakeBrowser = { close: async () => { throw new Error('Target page, context or browser has been closed'); } };
  await closeBrowserBounded(fakeBrowser, [99, 100], { ms: 1000, kill: (pid) => killed.push(pid), log: () => {}, childrenNow: () => [99, 100], parents: noKids });
  assert.deepEqual(killed.sort((a, b) => a - b), [99, 100], 'a rejecting close means a dead engine: kill its pids (still ours)');
});

test('#6205 closeBrowserBounded: a captured pid no longer our child is NOT signalled (pid-reuse guard, Liu Kang #6205)', async () => {
  // The engine often dies FIRST (tonight webkit closed its own context), so a pid captured at launch can be reused
  // by the OS for an unrelated process, maybe another agent's on this shared box. At kill time only pids still in
  // our live child set may be signalled. Here 11 is still ours; 22 departed (and its number may now be someone else's).
  const killed = [];
  await closeBrowserBounded({ close: () => never() }, [11, 22], {
    ms: 40, kill: (pid) => killed.push(pid), log: () => {}, childrenNow: () => [11, 999, 1000], parents: noKids,
  });
  assert.deepEqual(killed, [11], 'only a captured pid still our child is killed; a departed pid (22, possibly reused) must never be signalled');
});

test('#6205 closeContextBounded: a wedged ctx.close() returns false within the bound and swallows (never throws)', async () => {
  const t0 = Date.now();
  const okWedged = await closeContextBounded({ close: () => never() }, { ms: 40, log: () => {} });
  assert.ok(Date.now() - t0 < 2000, 'a wedged context close must not hang');
  assert.equal(okWedged, false, 'a timed-out close must return false so the caller stops using the wedged browser (#6205 review)');
  // a healthy context close still runs, does not throw, and returns true
  let closed = false;
  const okHealthy = await closeContextBounded({ close: async () => { closed = true; } }, { ms: 1000, log: () => {} });
  assert.equal(closed, true);
  assert.equal(okHealthy, true, 'a clean close must return true');
});

test('#6205 killPids: kills each pid by pid and swallows an already-gone pid', () => {
  const seen = [];
  const got = killPids([1, 2, 3], (pid) => { if (pid === 2) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' }); seen.push(pid); });
  assert.deepEqual(seen, [1, 3]);
  assert.deepEqual(got, [1, 3], 'a pid whose kill throws (already gone) is not reported as killed, and does not abort the loop');
});

test('#6205 childPidsOf: finds a real child by ppid, by its own pid (the resolver the kill relies on)', async () => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 100000)'], { stdio: 'ignore' });
  try {
    assert.ok(typeof child.pid === 'number' && child.pid > 0, 'spawned a child with a pid');
    let kids = [];
    for (let i = 0; i < 20 && !kids.includes(child.pid); i += 1) { kids = childPidsOf(process.pid); if (!kids.includes(child.pid)) await delay(25); }
    assert.ok(kids.includes(child.pid), 'childPidsOf(our pid) must include the child we just spawned (got ' + kids.join(',') + ')');
    assert.deepEqual(childPidsOf(child.pid), [], 'the spawned leaf has no children of its own (ppid direction: nothing reports to it)');
  } finally {
    child.kill('SIGKILL');
  }
});

test('#6205 descendantPids: returns each root plus all descendants, is cycle-safe, and returns a root absent from the map', () => {
  // 9 -> 11; 11 -> {33, 44}; 33 -> 55; and an unrelated 7 -> 77. Reaping root 11 must take the whole engine tree.
  const parents = new Map([[11, 9], [33, 11], [44, 11], [55, 33], [77, 7]]);
  assert.deepEqual(descendantPids([11], parents).sort((a, b) => a - b), [11, 33, 44, 55], 'the root and every descendant, nothing under an unrelated parent');
  assert.deepEqual(descendantPids([424242], parents), [424242], 'a root with no entry in the map is still returned');
  const cyclic = new Map([[1, 2], [2, 1]]);
  assert.deepEqual(descendantPids([1], cyclic).sort((a, b) => a - b), [1, 2], 'a cycle must not loop forever');
});

test('#6205 closeBrowserBounded: force-kill reaps the engine process TREE, not just the direct child (webkit/firefox wrapper)', async () => {
  // Captured pid 11 is still our child; under it a wrapper spawned 33 and 44, and 33 spawned helper 55.
  const killed = [];
  await closeBrowserBounded({ close: () => never() }, [11], {
    ms: 40, kill: (pid) => killed.push(pid), log: () => {},
    childrenNow: () => [11], parents: () => new Map([[11, process.pid], [33, 11], [44, 11], [55, 33]]),
  });
  assert.deepEqual(killed.sort((a, b) => a - b), [11, 33, 44, 55], 'the whole engine tree under the captured pid must be SIGKILLed, so a grandchild engine is not orphaned');
});

test('#6205 closeBrowserBounded: the DEFAULT resolvers (real childPidsOf + psParentMap) find and kill a real spawned child', async () => {
  // No childrenNow/parents injected: this exercises the real ps-backed path end to end. The kill is still injected
  // so the test signals nothing it did not spawn; the real child is reaped by the finally.
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 100000)'], { stdio: 'ignore' });
  try {
    let kids = [];
    for (let i = 0; i < 40 && !kids.includes(child.pid); i += 1) { kids = childPidsOf(process.pid); if (!kids.includes(child.pid)) await delay(25); }
    assert.ok(kids.includes(child.pid), 'the real child must appear in our child table first (got ' + kids.join(',') + ')');
    const killed = [];
    await closeBrowserBounded({ close: () => never() }, [child.pid], { ms: 40, kill: (pid) => killed.push(pid), log: () => {} });
    assert.ok(killed.includes(child.pid), 'the real default resolvers must identify the real child as still ours and kill it (got ' + killed.join(',') + ')');
  } finally {
    child.kill('SIGKILL');
  }
});

test('#6205 psParentMap: reads a non-empty pid->ppid map that includes a real spawned child pointing at us', async () => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 100000)'], { stdio: 'ignore' });
  try {
    let map = new Map();
    for (let i = 0; i < 40 && map.get(child.pid) !== process.pid; i += 1) { map = psParentMap(); if (map.get(child.pid) !== process.pid) await delay(25); }
    assert.ok(map.size > 1, 'the process table is not empty');
    assert.equal(map.get(child.pid), process.pid, 'the spawned child must map to our pid as its parent');
  } finally {
    child.kill('SIGKILL');
  }
});

test('#6205 defaults are a real, bounded number of ms', () => {
  assert.ok(Number.isFinite(BROWSER_CLOSE_MS) && BROWSER_CLOSE_MS > 0 && BROWSER_CLOSE_MS <= 60000);
  assert.ok(Number.isFinite(CTX_CLOSE_MS) && CTX_CLOSE_MS > 0 && CTX_CLOSE_MS <= 60000);
});

test('#6205 wiring: mobile-shots.js routes every close through the bounded helpers (no bare await close left)', () => {
  const src = fs.readFileSync(nodePath.join(__dirname, 'docs', 'browser-checks', 'mobile-shots.js'), 'utf8');
  assert.match(src, /require\('\.\/lib-bounded-close\.js'\)/, 'mobile-shots must require the bounded-close lib');
  assert.match(src, /childPidsOf\(process\.pid\)/, 'it must capture the engine pid(s) at launch');
  assert.match(src, /closeBrowserBounded\(browser, enginePids\)/, 'the finally must bound the browser close with the captured pids');
  assert.match(src, /closeContextBounded\(ctx\)/, 'every per-screen context close must be bounded');
  // the whole point: no unbounded await close may survive in mobile-shots.js (the lib is where the real close lives)
  assert.doesNotMatch(src, /await\s+ctx\.close\(\)/, 'a bare unbounded await ctx.close() would reintroduce the hang');
  assert.doesNotMatch(src, /await\s+browser\.close\(\)/, 'a bare unbounded await browser.close() would reintroduce the hang');
});
