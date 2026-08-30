'use strict';

/**
 * #1598: engine/remove.js and engine/delete-leftover.js reached live launchctl /
 * tmux on a fresh require, because remove.js's dry-run default was OFF and
 * delete-leftover.js had none, so a test that forgot to inject a runner ran live
 * against the operator's own fleet. The fix moves the gate to explicit
 * authorization (engine/live-execution.js): fail closed unless production opts
 * in; a missed prod opt-in is LOUD but not fatal; an unseamed TEST run THROWS.
 *
 *   node --test engine.live-execution-1598.test.js
 *
 * 🛑 SAFETY: EVERY run() call below uses /bin/echo, never launchctl or tmux, so
 * even the AUTHORIZED arm, which really executes, cannot touch a live job or
 * pane. That is deliberate: the authorized/inert arm of a destructive-guard test
 * is the one that does the real thing (a live launchd job was started this way on
 * this machine while building this card), so the real thing here is a harmless
 * echo. Do not change these to a real launchctl/tmux command.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const liveExec = require('./engine/live-execution');
const remove = require('./engine/remove');
const leftover = require('./engine/delete-leftover');

test('#1598 live-execution: fail closed by default, opt-in flips it, reset closes it', () => {
  liveExec.resetForTests();
  assert.equal(liveExec.liveExecutionAllowed(), false, 'live execution was allowed before any opt-in');
  liveExec.allowLiveExecution();
  assert.equal(liveExec.liveExecutionAllowed(), true, 'allowLiveExecution did not authorize');
  liveExec.resetForTests();
  assert.equal(liveExec.liveExecutionAllowed(), false, 'resetForTests did not close the gate');
  assert.equal(liveExec.inTestProcess(), true, 'this suite runs under node --test, so inTestProcess must be true');
});

for (const [name, mod] of [['remove', remove], ['delete-leftover', leftover]]) {
  test(`#1598 ${name}.run(): throws in an unseamed test, warns+dry-runs on a missed prod opt-in, executes only when opted in, runner always wins`, () => {
    // A test process (execArgv has --test) with no runner and no opt-in must
    // THROW, not fake success, so a missing seam cannot pass as a fiction.
    mod.resetForTests();
    liveExec.resetForTests();
    assert.throws(
      () => mod.run('/bin/echo', ['LIVE_MARKER']),
      /test process|Refusing/,
      `${name}: an unseamed run in a test process did not refuse`,
    );

    // Simulated PRODUCTION (execArgv without --test): a missed opt-in must WARN
    // loudly and dry-run, never throw (a board that refuses to start is worse,
    // #310) and never execute.
    const savedArgv = process.execArgv;
    const origWrite = process.stderr.write;
    const errs = [];
    process.execArgv = [];
    process.stderr.write = (s) => { errs.push(String(s)); return true; };
    let prodRes;
    try { prodRes = mod.run('/bin/echo', ['LIVE_MARKER']); }
    finally { process.execArgv = savedArgv; process.stderr.write = origWrite; }
    assert.equal(prodRes.dryRun, true, `${name}: a missed prod opt-in did not fail closed`);
    assert.ok(!(prodRes.stdout && String(prodRes.stdout).includes('LIVE_MARKER')), `${name}: executed the command while unauthorized`);
    assert.match(errs.join(''), /live-execution/, `${name}: the missed prod opt-in was silent, not loud (#310)`);

    // Authorized: opting in lets it actually run (harmless echo). Proves the gate
    // is a real control, not an always-dry-run that would pass this test dead.
    mod.resetForTests();
    liveExec.allowLiveExecution();
    const live = mod.run('/bin/echo', ['LIVE_MARKER']);
    assert.match(String(live.stdout || ''), /LIVE_MARKER/, `${name}: the opt-in did not enable live execution`);

    // Runner injected: the test runner wins regardless of the gate.
    liveExec.resetForTests();
    mod.resetForTests();
    let seen = null;
    mod.setRunner((f, a) => { seen = [f, a]; return { ok: true, injected: true }; });
    const r = mod.run('/bin/echo', ['X']);
    assert.deepEqual(seen, ['/bin/echo', ['X']], `${name}: did not use the injected runner`);
    assert.equal(r.injected, true);

    // Leave the module and the gate closed for whatever runs next.
    mod.resetForTests();
    liveExec.resetForTests();
  });
}
