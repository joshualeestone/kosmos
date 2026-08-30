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
const path = nodePath;
const { mkTemp } = require('../test-support/tmpdir');

const SANDBOX = mkTemp('launchsandbox1539-');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'LaunchAgents');
/**
 * 🛑 `AGENT_WORKFORCE_DATA` IS REQUIRED HERE AND ITS ABSENCE WAS NOT THEORETICAL.
 * Without it `installJob` -> `installSupervisor()` writes to the REAL
 * `~/Library/Application Support/AgentWorkforce`, and this file rewrote three
 * files there on every run, one of which (`bin/agent-supervisor.sh`) is read by
 * every live agent on the machine. Measured: all three mtimes moved.
 *
 * ⇒ `engine/sandbox.js` already states the rule this broke, from #634: a board is
 * sandboxed WHOLE or not at all, because a half-sandboxed one produces justified
 * confidence while the unsandboxed knobs stay live. A test whose entire subject
 * is "a sandboxed test must not touch the real machine" is the worst possible
 * place to leave two of four knobs live.
 *
 * 📌 `AGENT_WORKFORCE_HOME` was set here and did NOTHING: create.js's `homeDir()`
 * is raw `os.homedir()` and the module never reads that variable (measured, 0
 * occurrences, against 2 for AGENT_WORKFORCE_WORKERS). It has been removed rather
 * than left to read as protection it never provided.
 */
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_PROJECTS = nodePath.join(SANDBOX, 'projects');
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

test('#1539: a sandbox that redirects HOME is still a sandbox', () => {
  /**
   * 🛑 THE ARM THAT AN EARLIER VERSION OF THE PREDICATE FAILED. It read only
   * `AGENT_WORKFORCE_LAUNCH`, so a test that sandboxed itself by moving `HOME`
   * moved the plist and the predicate did not follow: it returned false and the
   * guard stood down while the plist was already sandboxed.
   *
   * ⚠️ NOT HYPOTHETICAL: 17 test files in this repo set `process.env.HOME`, 13 of
   * them alongside AGENT_WORKFORCE_LAUNCH.
   *
   * The second arm is the one that cancels out. `HOME` spoofed AND
   * `AGENT_WORKFORCE_LAUNCH` set to `$HOME/Library/LaunchAgents` is the most
   * natural sandbox layout there is, because it mirrors production, and a
   * predicate comparing the variable against `os.homedir()` sees both sides move
   * together and reports production.
   */
  const savedHome = process.env.HOME;
  const savedLaunch = process.env.AGENT_WORKFORCE_LAUNCH;
  const fakeHome = nodePath.join(SANDBOX, 'fakehome');
  try {
    process.env.HOME = fakeHome;

    delete process.env.AGENT_WORKFORCE_LAUNCH;
    assert.equal(create.launchIsSandboxed(), true,
      'HOME moved the plist into a sandbox and the predicate did not follow');

    process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(fakeHome, 'Library', 'LaunchAgents');
    assert.equal(create.launchIsSandboxed(), true,
      'a spoofed HOME cancelled against the variable and read as production');
  } finally {
    process.env.HOME = savedHome;
    process.env.AGENT_WORKFORCE_LAUNCH = savedLaunch;
  }

  /* CONTROL: with HOME restored, the same call must go back to false, so the two
     assertions above cannot be passing because the predicate is simply stuck. */
  assert.equal(create.launchIsSandboxed(), true,
    'sanity: this file redirects LAUNCH, so the restored state is still sandboxed');
  const savedLaunch2 = process.env.AGENT_WORKFORCE_LAUNCH;
  try {
    process.env.AGENT_WORKFORCE_LAUNCH = REAL_LAUNCH;
    assert.equal(create.launchIsSandboxed(), false,
      'CONTROL: the predicate can still return false, so true above means something');
  } finally { process.env.AGENT_WORKFORCE_LAUNCH = savedLaunch2; }
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
  /* The cache entry is restored in the finally below: leaving the fresh instance
     cached would make tests 3-4 depend on which instance they happened to get. */
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
  /**
   * 🛑 NO INJECTED RUNNER, AND THAT IS THE WHOLE POINT. Two earlier versions of
   * this test could not fail:
   *
   *   v1  `assert.doesNotThrow(() => create.runningJobs())`
   *       A blocked read does NOT throw. The guard RETURNS {ok:false, stdout:''}
   *       and the parser fails soft to an empty Set, so the assertion was
   *       structurally blind to the regression it was named for.
   *
   *   v2  the same question asked through `create.setRunner(stub)`
   *       `run()` short-circuits on an injected runner BEFORE it reaches the
   *       guard, so the stub answered and the guard was never in the path. It
   *       tested the stub. Proven: blocking `list` left it GREEN.
   *
   * ⇒ Both were caught by MUTATION, not by reading them. The guard can only be
   * observed with no runner and no dry-run, so that is how this asks.
   *
   * 📌 Safe to run live: `list` is a read. It mutates nothing, and the assertion
   * is on the REFUSAL FLAG rather than on the output, so it does not depend on
   * whether this machine happens to have any agents.
   */
  delete require.cache[require.resolve('./create')];
  const live = require('./create');
  try {
    assert.equal(live.launchIsSandboxed(), true,
      'precondition: this file redirects LAUNCH, so the guard must be armed');

  /* Each read verb with the arguments the codebase actually passes it: `list`
     takes none (create.js:1668), `print-disabled` takes the domain (:1645), and
     `print` takes a service (:2075). Passing a domain to `list` makes launchctl
     exit non-zero, which threw and looked like a test failure on the first run. */
    const READS = [
      ['list'],
      ['print-disabled', `gui/${process.getuid()}`],
      ['print', `gui/${process.getuid()}/com.kosmos.agent.nosuchagent1539`],
    ];
    for (const argv of READS) {
      let r;
      /* A read that reaches the real launchctl may exit non-zero (the `print`
         above names a service that does not exist, deliberately). That is fine:
         execFileSync THROWS on a non-zero exit, whereas the guard RETURNS. So a
         throw is itself proof the call was not refused. */
      try { r = live.run('/bin/launchctl', argv); } catch { r = { threw: true }; }
      assert.notEqual(r && r.sandboxRefused, true,
        `the guard REFUSED the read verb '${argv[0]}', which would break every `
        + 'sandboxed test that legitimately enumerates');
    }

    /* CONTROL: the same call shape with a MUTATING verb must be refused, so the
       three passes above cannot be passing because the guard is simply inert. */
    const m = live.run('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, '/tmp/none.plist']);
    assert.equal(m && m.sandboxRefused, true,
      'CONTROL: a mutating verb was NOT refused, so this test proves nothing');
  } finally {
    delete require.cache[require.resolve('./create')];
  }
});

test('#1539: the refusal says WHY, so a future test that trips it is not left guessing', () => {
  /**
   * ⚠️ The refusal is currently INVISIBLE at two of the five mutating call sites:
   * `create.js:1700` (enable) and `:2290` (bootout in rollBack) both wrap the call
   * in `try { run(...) } catch {}` and never read the return value, and
   * `sandboxRefused` is read nowhere in the repo. So the diagnostic sentence can
   * reach no human at those sites.
   *
   * ⇒ This asserts the message EXISTS and names the sandbox path and the fix.
   * That does not make it visible at 1700/2290; making it visible is a behaviour
   * change to two callers and is out of this card's scope. Asserting it here at
   * least means the sentence cannot silently rot.
   */
  delete require.cache[require.resolve('./create')];
  const live = require('./create');
  try {
    const r = live.run
      ? live.run('/bin/launchctl', ['bootstrap', 'gui/501', '/tmp/nope.plist'])
      : null;
    assert.ok(r, 'run() is not exported, so this assertion needs rewriting');
    assert.equal(r.ok, false, 'a mutating verb under a sandbox must be refused');
    assert.equal(r.sandboxRefused, true, 'the refusal must be identifiable by callers');
    assert.match(String(r.stderr || ''), /does not sandbox the REGISTRATION/,
      'the refusal must say WHY, not just fail');
    assert.match(String(r.stderr || ''), /setDryRun\(true\)/,
      'the refusal must tell the reader how to proceed deliberately');
  } finally {
    delete require.cache[require.resolve('./create')];
  }
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
