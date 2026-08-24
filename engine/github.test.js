'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const github = require('./github');

function fakeChild() {
  const c = new EventEmitter();
  c.stdout = new EventEmitter(); c.stderr = new EventEmitter();
  c.killed = false; c.kill = () => { c.killed = true; };
  return c;
}
const statusSaying = (code, text) => (args, done) => { assert.deepEqual(args.slice(0, 2), ['auth', 'status']); done(code, text); };

test.beforeEach(() => { github.resetForTests(); process.env.AGENT_WORKFORCE_GH_BIN = '/bin/echo'; });
test.after(() => { delete process.env.AGENT_WORKFORCE_GH_BIN; });

test('state is what gh says: missing tool, present but signed out, or signed in as somebody', async () => {
  process.env.AGENT_WORKFORCE_GH_BIN = '/nonexistent/gh';
  assert.deepEqual(await github.state(), { gh: 'missing', connected: false, login: null, phase: 'idle', code: null, url: null, because: null });
  process.env.AGENT_WORKFORCE_GH_BIN = '/bin/echo';
  github.setRunner(statusSaying(1, 'You are not logged into any GitHub hosts.'));
  assert.equal((await github.state()).connected, false);
  github.setRunner(statusSaying(0, 'github.com\n  ✓ Logged in to github.com account joshualeestone (keyring)\n'));
  const s = await github.state();
  assert.equal(s.connected, true);
  assert.equal(s.login, 'joshualeestone');
});

test('start launches the device flow and surfaces the one-time code and the URL the moment gh prints them', async () => {
  github.setRunner(statusSaying(1, 'not logged in'));
  let child;
  github.setSpawner(() => { child = fakeChild(); return child; });
  const first = await github.start();
  assert.equal(first.phase, 'starting');
  assert.equal(first.code, null, 'no code has been printed yet');
  child.stderr.emit('data', '\n! First copy your one-time code: 14D6-67D8\n');
  child.stderr.emit('data', 'Open this URL to continue in your web browser: https://github.com/login/device\n');
  const mid = await github.state();
  assert.equal(mid.phase, 'awaiting');
  assert.equal(mid.code, '14D6-67D8');
  assert.equal(mid.url, 'https://github.com/login/device');
  // A second start while one is in flight is refused, not doubled.
  const again = await github.start();
  assert.match(again.refused, /already in progress/);
  // The person finishes on GitHub: gh exits 0, and the state is read back from gh, not assumed.
  github.setRunner(statusSaying(0, '✓ Logged in to github.com account her (keyring)'));
  child.emit('exit', 0);
  await new Promise((r) => setTimeout(r, 10));
  const done = await github.state();
  assert.equal(done.phase, 'idle');
  assert.equal(done.connected, true);
  assert.equal(done.login, 'her');
  assert.equal(done.code, null, 'a finished flow shows no code');
});

test('a flow that dies says so, and cancel kills the child and clears the code', async () => {
  github.setRunner(statusSaying(1, 'not logged in'));
  let child;
  github.setSpawner(() => { child = fakeChild(); return child; });
  await github.start();
  child.stderr.emit('data', 'one-time code: AAAA-BBBB\nhttps://github.com/login/device');
  child.emit('exit', 1);
  const failed = await github.state();
  assert.equal(failed.phase, 'failed');
  assert.match(failed.because, /did not finish/);
  // Start again after a failure is allowed; cancel mid-flight kills the child.
  await github.start();
  child.stderr.emit('data', 'one-time code: CCCC-DDDD\nhttps://github.com/login/device');
  assert.equal((await github.state()).code, 'CCCC-DDDD');
  const after = await github.cancel();
  assert.equal(child.killed, true);
  assert.equal(after.phase, 'idle');
  assert.equal(after.code, null);
});

test('with gh absent, start refuses in one sentence and spawns nothing', async () => {
  process.env.AGENT_WORKFORCE_GH_BIN = '/nonexistent/gh';
  let spawned = 0;
  github.setSpawner(() => { spawned += 1; return fakeChild(); });
  const s = await github.start();
  assert.match(s.refused, /not on this Mac/);
  assert.equal(spawned, 0);
});
