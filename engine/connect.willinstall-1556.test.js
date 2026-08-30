'use strict';
/**
 * WOULD CONNECTING CLAUDE HAVE TO DOWNLOAD IT FIRST? (#1556)
 *
 * 🛑 THE CLIENT ASKED AND THE SERVER NEVER ANSWERED. `frClaudeInstallNeeded()` reads
 * `willInstall` and FAILS OPEN when it is absent, so the 281MB download prompt was
 * shown to everybody, including people who already have a working Claude Code. The
 * consumer was correct; the field was unbuilt.
 *
 * 🛑 THE TWO ERRORS ARE NOT EQUAL, AND THAT ASYMMETRY IS THE DESIGN:
 *
 *   we say TRUE  and it was false  ->  one needless confirm dialog
 *   we say FALSE and it was true   ->  AN UNANNOUNCED 281MB DOWNLOAD
 *
 * Josh asked for the confirm step by name. So every arm below that could produce the
 * second answer is checked, and the cheap `accessSync` runs EVERY time so it can only
 * ever move the verdict toward "yes, we will install".
 *
 * ⭐ THE THIRD ARM IS THE WHOLE POINT AND IT IS THE ONE A SIMPLER FIX WOULD MISS. A
 * truncated or half-written launcher passes `X_OK` forever. "A file is there" is not
 * "it runs", and only `--version` separates them. A fix that checked existence alone
 * would report "installed" for a binary that cannot start, which is exactly the
 * harmful direction.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { mkTemp } = require('../test-support/tmpdir.js');
const SB = mkTemp('aw-willinstall-1556-');
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
process.env.AGENT_WORKFORCE_HOME = SB;

const connect = require('./connect');


/** A real executable, because the probe runs a real subprocess. */
function fakeClaude(name, body) {
  const p = path.join(SB, name);
  fs.writeFileSync(p, `#!/bin/sh\n${body}\n`);
  fs.chmodSync(p, 0o755);
  return p;
}

test('#1556: no binary means an install IS needed, decided without a probe', () => {
  delete process.env.AGENT_WORKFORCE_CLAUDE_BIN;
  connect.resetForTests();
  const started = Date.now();
  return connect.willInstall().then((w) => {
    assert.equal(w, true, 'a machine with no Claude was told no install is needed');
    /* The cheap half must answer alone. A 15s probe timeout here would mean the
       accessSync gate is not gating, and every status poll would pay for it. */
    assert.ok(Date.now() - started < 2000,
      'the missing-binary case took long enough to have spawned a probe');
  });
});

test('#1556: a binary that RUNS means no install is needed', async () => {
  process.env.AGENT_WORKFORCE_CLAUDE_BIN = fakeClaude('claude-good', 'echo "1.2.3"; exit 0');
  connect.resetForTests();
  assert.equal(await connect.willInstall(), false,
    'a working Claude was reported as needing a 281MB download');
});

test('#1556 THE POINT: a binary that EXISTS and does NOT run still needs an install', async () => {
  /* X_OK passes on this file. Only the probe can tell. A fix that checked existence
     alone would say "installed" here and start an unannounced download. */
  process.env.AGENT_WORKFORCE_CLAUDE_BIN = fakeClaude('claude-broken', 'exit 1');
  connect.resetForTests();
  assert.equal(await connect.willInstall(), true,
    'a broken launcher was reported as installed, which is the unannounced-download case');
});

test('#1556: the cache is ONE-SIDED, so a binary going missing is noticed at once', async () => {
  /* Cache a positive, then take the binary away WITHOUT clearing the cache. The cheap
     check must override it, because staying cached here is the harmful direction. */
  const bin = fakeClaude('claude-vanishing', 'exit 0');
  process.env.AGENT_WORKFORCE_CLAUDE_BIN = bin;
  connect.resetForTests();
  assert.equal(await connect.willInstall(), false, 'the fixture did not cache a positive');
  fs.rmSync(bin);
  assert.equal(await connect.willInstall(), true,
    'a cached positive survived the binary being deleted, so we would download nothing and start nothing');
});

test('#1556: the probe result IS cached, so a status poll does not spawn one every time', async () => {
  /* The route calls this on every /api/connect GET. Without a cache that is a
     subprocess per poll, which is the #1560 mistake in a new place. */
  process.env.AGENT_WORKFORCE_CLAUDE_BIN = fakeClaude('claude-slow', 'sleep 0.3; exit 0');
  connect.resetForTests();
  /* ⭐ COUNTED, NOT TIMED. This asserted `warm < cold / 2` against a sleeping
     fixture, which is a proxy for the property and a flaky one: the box this runs
     on already reports suite contention, and a stalled scheduler reds a correct
     cache. Counting probes asserts the actual claim -- "the second call did not
     re-probe" -- and cannot be moved by load. */
  let probes = 0;
  connect.setRunner(async () => { probes += 1; return { ok: true, stdout: '' }; });
  await connect.willInstall();
  assert.equal(probes, 1, 'the cold call did not run the probe');
  await connect.willInstall();
  assert.equal(probes, 1, `the second call re-probed: ${probes} probes for two calls`);
});

test('#1556 concurrent callers share ONE probe, they do not each start their own', async () => {
  /* 🛑 THE CACHE IS WRITTEN AFTER AN AWAIT, so before coalescing every caller
     arriving during a cold probe missed it and spawned its own `claude --version`.
     That is not hypothetical for any caller on a timer, and with a 15s timeout it
     is a pile of concurrent subprocesses rather than one.

     ⚠️ NOTE WHAT THIS TEST WOULD HAVE DONE BEFORE THE FIX: it fails at 8, not 1.
     Perturbation, measured: remove the in-flight guard and this goes red alone. */
  const sb = fakeClaude('claude-concurrent', 'exit 0');
  process.env.AGENT_WORKFORCE_CLAUDE_BIN = sb;
  connect.resetForTests();
  let probes = 0;
  connect.setRunner(async () => {
    probes += 1;
    await new Promise((r) => setTimeout(r, 30));   // still in flight when the others arrive
    return { ok: true, stdout: '' };
  });
  const answers = await Promise.all(Array.from({ length: 8 }, () => connect.willInstall()));
  assert.equal(probes, 1, `8 concurrent callers started ${probes} probes`);
  assert.deepEqual(answers, Array(8).fill(false), 'the shared probe did not reach every caller');
});
test('#1556: it never throws, whatever the binary does', async () => {
  /* A missing answer must never become a confident one. The route falls back to
     today's behaviour on a rejection, so a throw here would be a silent regression. */
  process.env.AGENT_WORKFORCE_CLAUDE_BIN = path.join(SB, 'not-a-thing-at-all');
  connect.resetForTests();
  assert.equal(await connect.willInstall(), true);
});

test('#1556 "never throws" covers the RESOLVER too, not just a missing file', async () => {
  /* ⚠️ THE DOC BLOCK PROMISES THIS FUNCTION NEVER THROWS, and the only test for it
     exercised a missing binary. `claudeBinPath()` calls into the runner resolver,
     which can throw, and it used to sit OUTSIDE the guard. So the stated property
     was not the property pinned. Perturbation: move `claudeBinPath()` back out of
     the try in connect.js and this arm rejects while the others stay green. */
  const runners = require('./runners.js');
  const orig = runners.resolveBin;
  runners.resolveBin = () => { throw new Error('resolver exploded'); };
  try {
    connect.resetForTests();
    assert.equal(await connect.willInstall(), true,
      'a resolver failure is an unknown, and every unknown here means an install is needed');
  } finally {
    runners.resolveBin = orig;
    connect.resetForTests();
  }
});
