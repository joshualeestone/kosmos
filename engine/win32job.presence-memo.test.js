'use strict';
/**
 * `presence` remembers a task's answer for a moment, and forgets it the instant
 * this process changes any task.
 *
 * 🛑 WHY. One status snapshot asked `presence` several times per agent (the job
 * verdict, "never recorded", "not yet started", "has a job"), each a synchronous
 * `schtasks /Query` on the board's only thread: ~17ms each on the fleet box, far
 * more on a slow laptop, on every status poll and every DM send. Seven agents
 * cost ~0.5s a poll.
 *
 *   node -r <no-schtasks-preload> --test engine/win32job.presence-memo.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'win32job-presence-'));
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');

const job = require('./win32job');

function countingRunner() {
  const calls = [];
  const fn = (args) => {
    calls.push(args[0]);
    if (args[0] === '/Query') return { ok: true, out: 'TaskName: \\Kosmos\\agent-raph\nStatus: Ready\n' };
    return { ok: true, out: 'SUCCESS' };
  };
  return { fn, calls, queries: () => calls.filter((c) => c === '/Query').length };
}

test.afterEach(() => { job.setPresenceTtl(null); job.setRunner(null); });
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

test('asked again within the window, presence answers from memory', () => {
  const r = countingRunner();
  job.setRunner(r.fn);
  job.setPresenceTtl(job.PRESENCE_TTL_MS);
  const a = job.presence('raph');
  const b = job.presence('raph');
  assert.deepEqual(b, a);
  assert.equal(a.registered, true);
  assert.equal(r.queries(), 1, 'one schtasks look for two asks');
});

test('any change this process makes to a task is seen at once', () => {
  const r = countingRunner();
  job.setRunner(r.fn);
  job.setPresenceTtl(job.PRESENCE_TTL_MS);
  job.presence('raph');
  job.end('raph');
  job.presence('raph');
  assert.equal(r.queries(), 2, 'a /End forgot what was remembered, so the next ask looked again');
});

test('a look that failed is not remembered', () => {
  let n = 0;
  job.setRunner((args) => { if (args[0] === '/Query') n += 1; return { ok: false, out: 'Access is denied.' }; });
  job.setPresenceTtl(job.PRESENCE_TTL_MS);
  assert.equal(job.presence('raph').known, false);
  assert.equal(job.presence('raph').known, false);
  assert.equal(n, 2, '"we could not look" is asked again, never served from memory');
});

test('under an injected runner the memory is OFF unless a test turns it on', () => {
  const r = countingRunner();
  job.setRunner(r.fn);
  job.presence('raph');
  job.presence('raph');
  assert.equal(r.queries(), 2, 'no stubbed answer outlives the step that set it');
});
