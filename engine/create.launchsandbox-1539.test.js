/**
 * #1539: `AGENT_WORKFORCE_LAUNCH` sandboxes where a plist is WRITTEN, not the
 * `launchctl` REGISTRATION.
 *
 * A test that redirected that variable, believing itself sandboxed, bootstrapped
 * three real agents into the operator's own user domain: three tmux sessions,
 * three `claude --dangerously-skip-permissions` processes with cwd in $HOME, and
 * three loaded launchd jobs.
 *
 * 🛑 WHY THE END-TO-END ARM IS SAFE TO RUN, STATED BECAUSE IT WOULD NOT HAVE
 * BEEN BEFORE. `run()`'s guard is only reachable with NO injected runner and NO
 * dry-run, which is precisely the configuration that started those agents. The
 * predicate is therefore asserted FIRST, on all four arms, so a broken predicate
 * fails here rather than by registering something. If that ordering is ever
 * inverted, this file can start real agents again.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { mkTemp } = require('../test-support/tmpdir');

const SANDBOX = mkTemp('launchsandbox1539-');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'LaunchAgents');
process.env.AGENT_WORKFORCE_HOME = nodePath.join(SANDBOX, 'home');
fs.mkdirSync(process.env.AGENT_WORKFORCE_LAUNCH, { recursive: true });

const create = require('./create');

const REAL_LAUNCH = nodePath.join(os.homedir(), 'Library', 'LaunchAgents');

test('#1539: the predicate says a redirected LAUNCH is sandboxed and the real one is not', () => {
  const saved = process.env.AGENT_WORKFORCE_LAUNCH;
  try {
    delete process.env.AGENT_WORKFORCE_LAUNCH;
    assert.equal(create.launchIsSandboxed(), false, 'unset must mean production');
    process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'LaunchAgents');
    assert.equal(create.launchIsSandboxed(), true, 'a redirected dir must read as sandboxed');
    process.env.AGENT_WORKFORCE_LAUNCH = REAL_LAUNCH;
    assert.equal(create.launchIsSandboxed(), false, 'the real dir is not a sandbox');
    /* A trailing slash is the same directory. Without path.resolve this reads as
       sandboxed and every real install would be refused, which is the failure
       direction that breaks production rather than a test. */
    process.env.AGENT_WORKFORCE_LAUNCH = `${REAL_LAUNCH}/`;
    assert.equal(create.launchIsSandboxed(), false, 'a trailing slash is the same path');
  } finally { process.env.AGENT_WORKFORCE_LAUNCH = saved; }
});

test('#1539: a sandboxed LAUNCH refuses to register, and registers NOTHING', async () => {
  /**
   * The configuration that started three real agents: redirected LAUNCH, no
   * injected runner, not dry-run. The assertion is the launchd domain itself,
   * not the return value, because the return value is what was trusted before.
   */
  /**
   * 🛑 A FRESH MODULE AND NO SETTER CALLS, WHICH IS THE ONLY WAY TO REACH THE
   * DANGEROUS CONFIGURATION. `setRunner(null)` FORCES dry-run on, and
   * `setDryRun(false)` THROWS without a runner, so neither setter can produce
   * it. What produces it is calling NEITHER: `DRY_RUN` initialises from
   * `AGENT_WORKFORCE_DRY_RUN === '1'`, which nothing sets, so a module that is
   * merely required and used runs LIVE.
   *
   * ⇒ That is precisely how three real agents were started: one added
   * `installJob` call in a file that never touched the seams, because no
   * existing test needed to.
   */
  delete require.cache[require.resolve('./create')];
  const live = require('./create');
  const before = countKosmosJobs();
  const name = `sandboxprobe${Math.random().toString(36).slice(2, 8)}`;
  fs.mkdirSync(nodePath.join(process.env.AGENT_WORKFORCE_WORKERS, name), { recursive: true });

  const res = live.installJob(name, { claudeBin: '/bin/echo', tmuxBin: '/bin/echo' });

  const after = countKosmosJobs();
  assert.equal(after, before,
    `a sandboxed installJob changed the real launchd domain: ${before} -> ${after}`);
  /**
   * ⚠️ `ok: true` IS CORRECT HERE AND MY FIRST ASSERTION WAS WRONG ABOUT IT.
   * installJob deliberately returns ok with `started: false` when a bootstrap
   * fails, because the plist on disk is what brings the agent back at the next
   * login, and its `because` says exactly that. Asserting `!ok` was me testing
   * my expectation rather than the contract.
   *
   * ⇒ The guard's observable effect is `started: false` PLUS an unchanged
   * launchd domain. The domain is the assertion that matters; `started` is the
   * one a caller reads.
   */
  assert.equal(res.started, false,
    'a sandboxed installJob claimed it had STARTED the agent');
  assert.match(String(res.because || ''), /could not start it just now/,
    'the caller is not told the agent was left unstarted');
});

test('#1539 CONTROL: READS are not blocked, so a sandboxed test can still ask what is running', () => {
  // Blocking print/list would break sandboxed tests that legitimately enumerate,
  // and would make the guard look like it worked for the wrong reason.
  assert.doesNotThrow(() => create.runningJobs(), 'runningJobs must still answer under a sandbox');
  assert.doesNotThrow(() => create.disabledJobs(), 'disabledJobs must still answer under a sandbox');
});

test('#1539 CONTROL: an injected runner still wins, so existing tests are unaffected', () => {
  // The guard sits AFTER the runner check. If that order ever inverts, every
  // suite that injects a runner starts seeing refusals instead of its stub.
  const seen = [];
  create.setRunner((file, args) => { seen.push(`${file} ${(args || [])[0]}`); return { ok: true, stdout: '' }; });
  try {
    const name = `runnerprobe${Math.random().toString(36).slice(2, 8)}`;
    fs.mkdirSync(nodePath.join(process.env.AGENT_WORKFORCE_WORKERS, name), { recursive: true });
    create.installJob(name, { claudeBin: '/bin/echo', tmuxBin: '/bin/echo' });
    assert.ok(seen.some((s) => s.includes('launchctl')),
      'the injected runner never saw a launchctl call, so the guard is short-circuiting it');
  } finally { create.setRunner(null); }
});

function countKosmosJobs() {
  const { spawnSync } = require('node:child_process');
  const r = spawnSync('/bin/launchctl', ['list'], { encoding: 'utf8' });
  return String(r.stdout || '').split('\n').filter((l) => l.includes('com.kosmos.agent')).length;
}
