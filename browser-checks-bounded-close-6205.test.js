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
  withTimeout, childPidsOf, killPids, closeBrowserBounded, closeContextBounded, BROWSER_CLOSE_MS, CTX_CLOSE_MS,
} = require('./docs/browser-checks/lib-bounded-close.js');

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
  await closeBrowserBounded(fakeBrowser, [424242], { ms: 40, kill: (pid) => killed.push(pid), log: () => {}, childrenNow: () => [424242] });
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
  await closeBrowserBounded(fakeBrowser, [99, 100], { ms: 1000, kill: (pid) => killed.push(pid), log: () => {}, childrenNow: () => [99, 100] });
  assert.deepEqual(killed, [99, 100], 'a rejecting close means a dead engine: kill its pids (still ours)');
});

test('#6205 closeBrowserBounded: a captured pid no longer our child is NOT signalled (pid-reuse guard, Liu Kang #6205)', async () => {
  // The engine often dies FIRST (tonight webkit closed its own context), so a pid captured at launch can be reused
  // by the OS for an unrelated process, maybe another agent's on this shared box. At kill time only pids still in
  // our live child set may be signalled. Here 11 is still ours; 22 departed (and its number may now be someone else's).
  const killed = [];
  await closeBrowserBounded({ close: () => never() }, [11, 22], {
    ms: 40, kill: (pid) => killed.push(pid), log: () => {}, childrenNow: () => [11, 999, 1000],
  });
  assert.deepEqual(killed, [11], 'only a captured pid still our child is killed; a departed pid (22, possibly reused) must never be signalled');
});

test('#6205 closeContextBounded: a wedged ctx.close() returns within the bound and swallows (never throws)', async () => {
  const t0 = Date.now();
  await closeContextBounded({ close: () => never() }, { ms: 40, log: () => {} });
  assert.ok(Date.now() - t0 < 2000, 'a wedged context close must not hang');
  // a healthy context close still runs, and does not throw
  let closed = false;
  await closeContextBounded({ close: async () => { closed = true; } }, { ms: 1000, log: () => {} });
  assert.equal(closed, true);
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
    assert.ok(!childPidsOf(child.pid + 0).includes(process.pid), 'our own pid is not a child of the child (sanity: ppid direction)');
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
