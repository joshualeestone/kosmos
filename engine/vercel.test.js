'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const vercel = require('./vercel');

function fakeChild() {
  const c = new EventEmitter();
  c.stdout = new EventEmitter(); c.stderr = new EventEmitter();
  c.killed = false; c.kill = () => { c.killed = true; };
  return c;
}
const statusSaying = (code, text) => (args, done) => { assert.deepEqual(args.slice(0, 1), ['whoami']); done(code, text); };

test.beforeEach(() => { vercel.resetForTests(); process.env.AGENT_WORKFORCE_VERCEL_BIN = '/bin/echo'; });
test.after(() => { delete process.env.AGENT_WORKFORCE_VERCEL_BIN; });

test('state is what vercel says: missing tool, present but signed out, or signed in as somebody', async () => {
  process.env.AGENT_WORKFORCE_VERCEL_BIN = '/nonexistent/gh';
  assert.deepEqual(await vercel.state(), { gh: 'missing', connected: false, login: null, phase: 'idle', code: null, url: null, because: null });
  process.env.AGENT_WORKFORCE_VERCEL_BIN = '/bin/echo';
  vercel.setRunner(statusSaying(1, 'You are not logged into any GitHub hosts.'));
  assert.equal((await vercel.state()).connected, false);
  vercel.setRunner(statusSaying(0, 'joshualeestone-6084\n'));
  const s = await vercel.state();
  assert.equal(s.connected, true);
  assert.equal(s.login, 'joshualeestone-6084');
});

test('start launches the device flow and surfaces the one-time code and the URL the moment vercel prints them', async () => {
  vercel.setRunner(statusSaying(1, 'not logged in'));
  let child;
  vercel.setSpawner(() => { child = fakeChild(); return child; });
  const first = await vercel.start();
  assert.equal(first.phase, 'starting');
  assert.equal(first.code, null, 'no code has been printed yet');
  child.stderr.emit('data', '> NOTE: telemetry…\n');
  child.stderr.emit('data', '  Visit https://vercel.com/oauth/device?user_code=NZZS-VBSF\nWaiting for authentication...\n');
  const mid = await vercel.state();
  assert.equal(mid.phase, 'awaiting');
  assert.equal(mid.code, 'NZZS-VBSF');
  assert.equal(mid.url, 'https://vercel.com/oauth/device?user_code=NZZS-VBSF');
  // A second start while one is in flight is refused, not doubled.
  const again = await vercel.start();
  assert.match(again.refused, /already in progress/);
  // The person finishes on GitHub: gh exits 0, and the state is read back from vercel, not assumed.
  vercel.setRunner(statusSaying(0, 'her-team\n'));
  child.emit('exit', 0);
  await new Promise((r) => setTimeout(r, 10));
  const done = await vercel.state();
  assert.equal(done.phase, 'idle');
  assert.equal(done.connected, true);
  assert.equal(done.login, 'her-team');
  assert.equal(done.code, null, 'a finished flow shows no code');
});

test('a flow that dies says so, and cancel kills the child and clears the code', async () => {
  vercel.setRunner(statusSaying(1, 'not logged in'));
  let child;
  vercel.setSpawner(() => { child = fakeChild(); return child; });
  await vercel.start();
  child.stderr.emit('data', 'Visit https://vercel.com/oauth/device?user_code=AAAA-BBBB');
  child.emit('exit', 1);
  const failed = await vercel.state();
  assert.equal(failed.phase, 'failed');
  assert.match(failed.because, /did not finish/);
  // Start again after a failure is allowed; cancel mid-flight kills the child.
  await vercel.start();
  child.stderr.emit('data', 'Visit https://vercel.com/oauth/device?user_code=CCCC-DDDD');
  assert.equal((await vercel.state()).code, 'CCCC-DDDD');
  const after = await vercel.cancel();
  assert.equal(child.killed, true);
  assert.equal(after.phase, 'idle');
  assert.equal(after.code, null);
});

test('with vercel absent, start refuses in one sentence and spawns nothing', async () => {
  process.env.AGENT_WORKFORCE_VERCEL_BIN = '/nonexistent/gh';
  let spawned = 0;
  vercel.setSpawner(() => { spawned += 1; return fakeChild(); });
  const s = await vercel.start();
  assert.match(s.refused, /not on this Mac/);
  assert.equal(spawned, 0);
});
