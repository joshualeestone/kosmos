'use strict';
/**
 * #6231 item 7: remove.putBackAsync -- a stopped account move's Windows put-back run OFF the board's thread.
 *
 * It drives create.restoreAccountSteps (the win32 put-back as step generators) through the SAME async driver as
 * restartAsync, so the schtasks calls route through remove.js's async runner (not the blocking one that would freeze
 * the board), holds the agent in RESTARTING until the drive REALLY ends (not merely at the cap -- an abandoned command
 * may still be running, the #3418 interleave guard), and bounds itself by the same cap as a restart, resolving a
 * create.OUTCOME-shaped result or, at the cap, a REFUSED-shaped one so accountmove words it as a partial.
 *
 * create.restoreAccountSteps is STUBBED here with a controlled generator, so these pin putBackAsync's own driving /
 * cap / hold logic in isolation; the real restoreAccountSteps -> installSteps/taskEnabledSteps path is covered by
 * engine/create.win32-job-read.test.js.
 *
 *   node --test engine/remove.putback-async-6231.test.js
 */
require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

// Sandbox every root before requiring remove.js (it freezes store roots at require).
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'remove-putback-async-6231-'));
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'LaunchAgents');
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'support');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const remove = require('./remove');
const create = require('./create');
const realRAS = create.restoreAccountSteps;

const tick = () => new Promise((r) => setImmediate(r));
function reset() {
  remove.setRunner(null);
  remove.setAsyncRunner(null);
  create.restoreAccountSteps = realRAS;
  delete process.env.AGENT_WORKFORCE_ASYNC_RESTART_CAP_MS;
}
test.afterEach(reset);
test.after(() => { reset(); try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

test('#6231 item 7: putBackAsync drives restoreAccountSteps through the ASYNC runner and passes its result straight back, releasing the hold', async () => {
  const sync = [], asyncCalls = [];
  let drivenWith = null;
  remove.setRunner((file, args) => { sync.push([file].concat(args).join(' ')); return { ok: false, code: 99 }; }); // the blocking runner must never be asked
  remove.setAsyncRunner(async (file, args) => { asyncCalls.push([file].concat(args).join(' ')); return { ok: true, stdout: '' }; });
  create.restoreAccountSteps = function* (name, dir) {
    drivenWith = [name, dir];
    yield { exec: ['schtasks.exe', ['/Create', '/F', '/TN', 'Kosmos\\agent-' + name], { timeout: 1000 }] };
    return { outcome: create.OUTCOME.CREATED, because: null, account: { email: 'old@example.com' } };
  };
  const out = await remove.putBackAsync('al', '/acct/old');
  assert.deepEqual(drivenWith, ['al', '/acct/old'], 'the put-back drove restoreAccountSteps(name, dir)');
  assert.equal(out.outcome, create.OUTCOME.CREATED, 'the create result is passed straight back');
  assert.equal(out.account.email, 'old@example.com');
  assert.deepEqual(sync, [], 'no put-back command went through the blocking runner (that would freeze the board)');
  assert.ok(asyncCalls.some((c) => /schtasks\.exe \/Create/.test(c)), 'the /Create went through the async runner: ' + JSON.stringify(asyncCalls));
  assert.equal(remove.restartingNow(), false, 'the hold is released once the put-back settles');
});

test('#6231 item 7: putBackAsync holds the agent (restartingNow) while its put-back is in flight, and clears it only after it settles', async () => {
  let release;
  remove.setRunner(() => ({ ok: false, code: 99 }));
  remove.setAsyncRunner(() => new Promise((r) => { release = () => r({ ok: true, stdout: '' }); }));
  create.restoreAccountSteps = function* () {
    yield { exec: ['schtasks.exe', ['/Create'], {}] };
    return { outcome: create.OUTCOME.CREATED, because: null, account: null };
  };
  const p = remove.putBackAsync('bo', null);
  await tick();
  assert.equal(remove.restartingNow(), true, 'bo is held while its put-back writes -- this is what refuses a same-agent switch mid-put-back (contract 3b)');
  release();
  const out = await p;
  assert.equal(out.outcome, create.OUTCOME.CREATED);
  assert.equal(remove.restartingNow(), false, 'the hold clears only after the put-back settles');
});

test('#6231 item 7: a put-back whose generator throws rejects putBackAsync and still releases the hold', async () => {
  remove.setRunner(() => ({ ok: false, code: 99 }));
  remove.setAsyncRunner(async () => ({ ok: true, stdout: '' }));
  create.restoreAccountSteps = function* () { throw new Error('generator boom'); };
  await assert.rejects(remove.putBackAsync('al', '/acct/old'), /generator boom/, 'a throwing drive must reject, not swallow');
  assert.equal(remove.restartingNow(), false, 'the hold is released even when the drive throws (release is attached to driven)');
});

test('#6231 item 7: a drive that returns a falsy value WITHOUT abandonment resolves a synthetic REFUSED, never hangs', async () => {
  // Exercises the falsy-without-abandon guard: release() clears the cap timer the moment driven settles, so if the
  // generator returned nothing and we were NOT abandoned, `await capped` would hang forever without the guard.
  remove.setRunner(() => ({ ok: false, code: 99 }));
  remove.setAsyncRunner(async () => ({ ok: true, stdout: '' }));
  create.restoreAccountSteps = function* () { return undefined; };
  const out = await remove.putBackAsync('al', '/acct/old');
  assert.equal(out.outcome, create.OUTCOME.REFUSED, 'a falsy drive result is turned into a REFUSED, not a hang');
  assert.match(out.because, /did not return a result/);
  assert.equal(remove.restartingNow(), false, 'the hold is released');
});

test('#6231 item 7: a put-back that overruns its cap resolves a REFUSED-shaped result, and still releases the hold once the abandoned command ends', async () => {
  process.env.AGENT_WORKFORCE_ASYNC_RESTART_CAP_MS = '20';
  remove.setRunner(() => ({ ok: false, code: 99 }));
  // the async command settles only AFTER the cap, so the move is told "did not finish" first, and the hold releases
  // a little later when the abandoned command really ends (never bootstrapping over a switch the person made since).
  remove.setAsyncRunner(() => new Promise((r) => setTimeout(() => r({ ok: true, stdout: '' }), 80)));
  create.restoreAccountSteps = function* () {
    yield { exec: ['schtasks.exe', ['/Create'], {}] };
    return { outcome: create.OUTCOME.CREATED, because: null, account: null };   // never reached: abandoned at the cap
  };
  const out = await remove.putBackAsync('cy', '/acct/old');
  assert.equal(out.outcome, create.OUTCOME.REFUSED, 'the cap resolves a REFUSED-shaped result, not a false success');
  assert.match(out.because, /did not finish within \d+ seconds/);
  await new Promise((r) => setTimeout(r, 140));
  assert.equal(remove.restartingNow(), false, 'the hold is released once the abandoned command finally ends');
});
