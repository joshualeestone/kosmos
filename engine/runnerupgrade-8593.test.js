'use strict';
/*
 * kosmos#8593: the board's runner-upgrade sweep (engine/runnerupgrade.js), with every input injected: no board, no
 * download, no process table. The rules it holds: gated off under test and by the brake, only a stale runner with no
 * install running, at most TRIES tries per pin per board run, and on Windows a wait (an agent running, or no answer)
 * is never a try, including an install that met a running agent at its own last check.
 *
 *   node --test engine/runnerupgrade-8593.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeTick, TRIES } = require('./runnerupgrade');

const PIN = '0.169.0';

/* A runners stand-in: a stale managed Codex at 0.149.1, no job running. `busy` is what the Windows check answers;
   `waits` makes install() hand back a job that settles as a wait (what runners.install does when an agent started
   during the download). */
function fake({ stale = true, installing = false, liveJob = null, busy = false, checkThrows = false, waits = false } = {}) {
  const calls = { install: 0, asked: [] };
  const runners = {
    resolveBin: () => ({ present: true, managed: true, stale, installedVersion: stale ? '0.149.1' : undefined }),
    installing: () => installing,
    status: () => ({ openai: { job: liveJob } }),
    manifestFor: () => ({ version: PIN }),
    managedRoot: () => 'C:\\runners',
    managedProcessRunning: (dir) => { calls.asked.push(dir); return checkThrows ? Promise.reject(new Error('CIM')) : Promise.resolve(busy); },
    install: () => {
      calls.install += 1;
      const job = { phase: 'downloading' };
      Object.defineProperty(job, 'settled', { value: Promise.resolve().then(() => {
        job.phase = 'failed';
        if (waits) Object.defineProperty(job, 'waited', { value: true, enumerable: false });
      }) });
      return job;
    },
  };
  return { runners, calls };
}
function tickFor(runners, over = {}) {
  const lines = [];
  const tick = makeTick({ runners, platform: 'win32', allowed: () => true, braked: () => false,
    write: (l) => lines.push(l), warn: (l) => lines.push(l), ...over });
  return { tick, lines };
}
const settle = () => new Promise((r) => setImmediate(r));

test('off: not allowed (under test, before the opt-in) or the operator brake is on; nothing is asked or installed', async () => {
  for (const over of [{ allowed: () => false }, { braked: () => true }, { allowed: () => { throw new Error('x'); } }]) {
    const { runners, calls } = fake();
    const { tick } = tickFor(runners, over);
    assert.equal(await tick(), 'off');
    assert.equal(calls.install, 0); assert.deepEqual(calls.asked, []);
  }
});

test('idle: not stale, an install running, or a job still in flight; nothing is installed and no try is spent', async () => {
  for (const opts of [{ stale: false }, { installing: true }, { liveJob: { phase: 'downloading' } }]) {
    const { runners, calls } = fake(opts);
    const { tick } = tickFor(runners);
    assert.equal(await tick(), 'idle', JSON.stringify(opts));
    assert.equal(calls.install, 0);
  }
});

test('Mac and Linux: a stale runner starts an upgrade at once, without asking about running agents', async () => {
  for (const platform of ['darwin', 'linux']) {
    const { runners, calls } = fake({ busy: true });
    const { tick } = tickFor(runners, { platform });
    assert.equal(await tick(), 'started');
    assert.equal(calls.install, 1);
    assert.deepEqual(calls.asked, [], 'the Windows check is Windows only');
  }
});

test('Windows: no agent running starts the upgrade, asking about the managed openai folder', async () => {
  const { runners, calls } = fake({ busy: false });
  const { tick, lines } = tickFor(runners);
  assert.equal(await tick(), 'started');
  assert.equal(calls.install, 1);
  assert.deepEqual(calls.asked, [require('node:path').join('C:\\runners', 'openai')]);
  assert.match(lines.join(''), /0\.149\.1 -> 0\.169\.0: downloading/);
});

test('Windows: an agent running, no answer, or a check that throws is a wait, and waiting forever spends no try', async () => {
  for (const opts of [{ busy: true }, { busy: null }, { checkThrows: true }]) {
    const { runners, calls } = fake(opts);
    const { tick, lines } = tickFor(runners);
    for (let i = 0; i < TRIES + 3; i++) assert.equal(await tick(), 'waiting', JSON.stringify(opts));
    assert.equal(calls.install, 0, 'nothing downloaded while it waits');
    assert.match(lines.join(''), opts.busy === true ? /waiting \(an agent is running on it\)/ : /waiting \(could not check\)/);
    // The agent stops: the tries are all still there.
    runners.managedProcessRunning = () => Promise.resolve(false);
    assert.equal(await tick(), 'started', 'a wait never used up a try');
  }
});

test('at most TRIES failed tries per pin per board run, then capped', async () => {
  const { runners, calls } = fake({ busy: false });
  const { tick } = tickFor(runners);
  for (let i = 0; i < TRIES; i++) { assert.equal(await tick(), 'started'); await settle(); }
  assert.equal(await tick(), 'capped');
  assert.equal(calls.install, TRIES);
});

test('Windows: an install that met a running agent at its own last check hands its try back', async () => {
  const { runners, calls } = fake({ busy: false, waits: true });
  const { tick } = tickFor(runners);
  for (let i = 0; i < TRIES + 2; i++) { assert.equal(await tick(), 'started', `look ${i + 1}`); await settle(); }
  assert.equal(calls.install, TRIES + 2, 'a wait inside install() did not count against the cap');
});

test('a throw inside the tick is warned, never thrown', async () => {
  const { runners } = fake();
  runners.resolveBin = () => { throw new Error('boom'); };
  const { tick, lines } = tickFor(runners);
  assert.equal(await tick(), 'idle');
  assert.match(lines.join(''), /\[runner-upgrade\] boom/);
});
