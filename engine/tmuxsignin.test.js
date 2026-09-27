'use strict';
/* engine/tmuxsignin.js (#4195): the hidden-tmux plumbing agysignin (and musesignin, #3939) share.
   agysignin.test.js covers the socket, the gate and the timeout half of the delivery rule through the
   sign-in itself; these cover what it could not reach, measured by breaking each helper in turn:
   the kosmosInternal mark, the socket on every call, the signal half of the delivery rule, shell
   quoting, and forgetting the cached tmux path. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const sig = require('./tmuxsignin');
const gate = require('./live-execution');
const create = require('./create');

/* binPaths stood in for the length of one test, and put back whatever happens. */
function withBinPaths(fake, fn) {
  const real = create.binPaths;
  create.binPaths = fake;
  sig.forgetTmuxBin();
  try { return fn(); } finally { create.binPaths = real; sig.forgetTmuxBin(); gate.resetForTests(); }
}

test('#4195 a tmux that cannot be found is marked as Kosmos\'s own failure (kosmosInternal)', () => {
  withBinPaths(() => { throw new Error('no tmux here'); }, () => {
    gate.allowLiveExecution();
    let err;
    try { sig.runTmux('tmuxsignin-test', 'sock', ['has-session']); } catch (e) { err = e; }
    assert.ok(err, 'runTmux did not throw with no tmux');
    assert.equal(err.kosmosInternal, true, 'the failure to find tmux was not marked, so a screen reader would read it as the program exiting');
    assert.match(err.message, /Kosmos could not find tmux: no tmux here/);
  });
});

test('#4195 every tmux call goes to the sign-in\'s own socket', () => {
  /* /bin/echo stands in for tmux, so the call's argv comes back as its output (macOS or any Unix,
     like the tmux these sign-ins run). */
  withBinPaths(() => ({ tmuxBin: '/bin/echo' }), () => {
    gate.allowLiveExecution();
    const out = sig.runTmux('tmuxsignin-test', 'kosmos-x-signin-abc', ['capture-pane', '-p']);
    assert.equal(out.trim(), '-L kosmos-x-signin-abc capture-pane -p');
  });
});

test('#4195 with the live-execution gate closed, runTmux runs nothing and fails closed', () => {
  /* In a test process the gate's report throws; production's report only warns, so stand in for it
     to reach production's own branch: live() false, then "live execution is off", nothing run. */
  const realReport = gate.refuseOrWarn;
  const reported = [];
  gate.refuseOrWarn = (owner, file, args) => { reported.push([owner, file, args.join(' ')]); };
  try {
    withBinPaths(() => ({ tmuxBin: '/bin/echo' }), () => {
      gate.resetForTests();
      assert.throws(() => sig.runTmux('tmuxsignin-test', 'sock', ['kill-server']), /live execution is off/);
      assert.deepEqual(reported, [['tmuxsignin-test', '/bin/echo', '-L sock kill-server']], 'the gate was not told which sign-in wanted what');
    });
  } finally { gate.refuseOrWarn = realReport; }
});

test('#4195 a timed-out or killed tmux call has unknown delivery; any other failure does not', () => {
  assert.equal(sig.deliveryUnknown({ code: 'ETIMEDOUT' }), true);
  assert.equal(sig.deliveryUnknown({ signal: 'SIGTERM' }), true, 'a killed call was read as delivered-and-failed');
  assert.equal(sig.deliveryUnknown({ code: 'ENOENT' }), false);
  assert.equal(sig.deliveryUnknown({ status: 1 }), false);
  assert.equal(sig.deliveryUnknown(null), false);
  assert.equal(sig.deliveryUnknown(undefined), false);
});

test('#4195 shq quotes one argument so /bin/sh reads it back unchanged', () => {
  for (const v of ['plain', 'with space', "it's", "'", "a'b'c", '$HOME `x` "q" \\ ;']) {
    const back = execFileSync('/bin/sh', ['-c', 'printf %s ' + sig.shq(v)], { encoding: 'utf8' });
    assert.equal(back, v, 'shq did not survive the shell: ' + JSON.stringify(v));
  }
});

test('#4195 the tmux path is looked up once, and again after forgetTmuxBin', () => {
  let asked = 0;
  withBinPaths(() => { asked += 1; return { tmuxBin: '/bin/echo' }; }, () => {
    sig.tmuxBin(); sig.tmuxBin();
    assert.equal(asked, 1, 'the tmux path was looked up on every call');
    sig.forgetTmuxBin();
    sig.tmuxBin();
    assert.equal(asked, 2, 'forgetTmuxBin did not make the next call look again');
  });
});

test('#4195 homeSocket: a test\'s own socket wins, otherwise the prefix plus a hash of this account\'s home', () => {
  const env = 'KOSMOS_TMUXSIGNIN_TEST_SOCKET';
  const had = Object.prototype.hasOwnProperty.call(process.env, env);
  const prev = process.env[env];
  try {
    process.env[env] = 'test-socket';
    assert.equal(sig.homeSocket('kosmos-x-signin-', env), 'test-socket');
    delete process.env[env];
    const name = sig.homeSocket('kosmos-x-signin-', env);
    assert.match(name, /^kosmos-x-signin-[0-9a-f]{10}$/);
    assert.equal(name, sig.homeSocket('kosmos-x-signin-', env), 'the same home gave two names');
  } finally {
    if (had) process.env[env] = prev; else delete process.env[env];
  }
});

/* Every sign-in that runs in hidden tmux. Step 2 of #4195 adds 'musesignin.js' here. */
const CONSUMERS = ['agysignin.js'];
test('#4195 each sign-in takes its plumbing from tmuxsignin, not from a copy of its own', () => {
  for (const file of CONSUMERS) {
    const src = require('node:fs').readFileSync(path.join(__dirname, file), 'utf8');
    assert.match(src, /require\('\.\/tmuxsignin'\)/, file + ' does not use tmuxsignin');
    for (const copy of [/function shq\(/, /let tmuxBinCached/, /execFileSync\(bin, full/, /e\.code === 'ETIMEDOUT'/]) {
      assert.doesNotMatch(src, copy, file + ' has its own copy again: ' + copy);
    }
  }
});
