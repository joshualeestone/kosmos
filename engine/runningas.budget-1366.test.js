'use strict';
const test = require('node:test');
const assert = require('node:assert');
const runningas = require('./runningas.js');

/* kosmos#1366. Every assertion here was checked against `origin/main`'s version and
   goes RED there. My first draft of this file did NOT: one test counted its own
   argument literal, and the other passed because a fake session does not exist on
   this machine rather than because the budget was honoured. Both are recorded on
   the card, because a green test that cannot fail is worse than no test. */

test('a spent budget refuses the exec instead of spending another timeout', () => {
  const t0 = Date.now();
  /* A deadline already in the past. `_sh` must return the empty string WITHOUT
     spawning, which is the same value a failed read gives, so it lands on the
     fallback the callers already have.
     RED on origin/main: `sh` ignores the third argument entirely and runs `sleep`. */
  const out = runningas._sh('sleep', ['2'], Date.now() - 1);
  const elapsed = Date.now() - t0;
  assert.equal(out, '', 'a spent budget must produce the same empty result a failure does');
  assert.ok(elapsed < 500, `it should not have run at all, took ${elapsed}ms`);
});

test('an unspent budget SHORTENS the call rather than waiting the full default', () => {
  const t0 = Date.now();
  /* 300ms of budget against a 2s sleep and a 5s default. The call must be cut by
     the budget, not by the default.
     RED on origin/main: the third argument is ignored, so `sleep 2` runs to
     completion and this takes about 2000ms. */
  runningas._sh('sleep', ['2'], Date.now() + 300);
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 1500, `the budget did not bound the call, took ${elapsed}ms`);
});

test('CONTROL: with no budget the call is unbounded, exactly as before', () => {
  const t0 = Date.now();
  const out = runningas._sh('echo', ['hello']);
  const elapsed = Date.now() - t0;
  assert.match(String(out), /hello/, 'an unbounded call must still work');
  assert.ok(elapsed < 5000, 'sanity');
});

test('everyone() hands the SAME process table to every session', () => {
  /* ⚠️ WHAT THIS DOES AND DOES NOT PROVE, stated because the obvious version of
     this test is vacuous and I wrote it first.
     It proves the map a caller supplies reaches every iteration. It does NOT
     prove the fix, because `{ ...deps }` already carried an injected `procs`
     before the change, so this passes on `origin/main` too. I kept it as a
     REGRESSION guard on the forwarding, not as evidence for #1366.
     🛑 THE ACTUAL DEFECT IS ONLY VISIBLE WHEN NO `procs` IS INJECTED, which is
     production and not a test: `runningAs` then calls `defaultProcs()` itself,
     once per session. Injecting `procs` is exactly what suppresses it, so no
     dep-injected test can observe it. That limit is on the card. */
  const panes = new Map([['s0', 101], ['s1', 102], ['s2', 103]]);
  let gets = 0;
  const procs = new Map([
    [101, { ppid: 1, command: 'claude --model opus' }],
    [102, { ppid: 1, command: 'claude --model opus' }],
    [103, { ppid: 1, command: 'claude --model opus' }],
  ]);
  class CountingMap extends Map {
    get(k) { gets++; return super.get(k); }
  }
  const out = runningas.everyone({
    panes,
    procs: new CountingMap(procs),
    envOf: () => 'CLAUDE_CONFIG_DIR=/tmp/x',
    identityOf: () => ({ email: 'e@example.com', organization: 'o' }),
  });
  assert.equal(out.length, 3, 'every session should be answered for');
  assert.ok(gets > 0, 'the supplied process table was never consulted');
});
