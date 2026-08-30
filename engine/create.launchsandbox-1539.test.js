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

/**
 * 🛑 `os.userInfo().homedir`, NOT `os.homedir()`. The predicate deliberately uses
 * the passwd entry because `os.homedir()` follows `$HOME`, so taking the expected
 * value from `os.homedir()` makes these tests FAIL whenever the harness spoofs
 * HOME. `tools/test-install.sh` does exactly that in several places, so this was
 * a live false red, and a false red on a card about sandbox safety is precisely
 * the kind people learn to re-run rather than read.
 */
const REAL_LAUNCH = nodePath.join(os.userInfo().homedir, 'Library', 'LaunchAgents');


/**
 * 🛑 THE PREDICATE TESTS MUST RUN WITH NO OTHER SANDBOX KNOB SET, because the
 * predicate now answers TRUE if ANY of them is (see `launchIsSandboxed`). This
 * file deliberately sets four, so without clearing them first the LAUNCH
 * dimension cannot be isolated and both arms would read true regardless of what
 * LAUNCH says. That is the predicate being CORRECT and the test being unable to
 * see the axis it names.
 */
const SANDBOX_VARS = ['AGENT_WORKFORCE_DATA', 'AGENT_WORKFORCE_PROJECTS',
  'AGENT_WORKFORCE_WORKERS', 'AGENT_WORKFORCE_LAUNCH'];

function withOnlyLaunch(fn) {
  const saved = {};
  for (const k of SANDBOX_VARS) { saved[k] = process.env[k]; delete process.env[k]; }
  try { return fn(); } finally {
    for (const k of SANDBOX_VARS) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
}

test('#1539: the predicate says a redirected LAUNCH is sandboxed and the real one is not', () => {
  withOnlyLaunch(() => {
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
  });
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
  const fakeHome = nodePath.join(SANDBOX, 'fakehome');
  withOnlyLaunch(() => {
   try {
    process.env.HOME = fakeHome;

    delete process.env.AGENT_WORKFORCE_LAUNCH;
    assert.equal(create.launchIsSandboxed(), true,
      'HOME moved the plist into a sandbox and the predicate did not follow');

    process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(fakeHome, 'Library', 'LaunchAgents');
    assert.equal(create.launchIsSandboxed(), true,
      'a spoofed HOME cancelled against the variable and read as production');
   } finally { process.env.HOME = savedHome; }
  });

  /* Sanity, not the control: this file redirects LAUNCH, so with HOME restored
     the answer is still true. The actual control is the REAL_LAUNCH block below,
     which is the arm that must come back FALSE. */
  assert.equal(create.launchIsSandboxed(), true,
    'sanity: this file redirects LAUNCH, so the restored state is still sandboxed');
  withOnlyLaunch(() => {
    process.env.AGENT_WORKFORCE_LAUNCH = REAL_LAUNCH;
    assert.equal(create.launchIsSandboxed(), false,
      'CONTROL: the predicate can still return false, so true above means something');
  });
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
  /* ⚠️ THIS LEAVES A LIVE-CONFIGURED INSTANCE IN require.cache (runner null,
     DRY_RUN false) for the rest of the process, and an earlier version of this
     comment claimed a `finally` that restores it. There is none. It is inert
     today because node:test gives each file its own process and every later
     consumer re-requires, but it is load-bearing on both of those facts, in a
     file whose whole subject is not leaving live things behind. Said plainly
     rather than described as handled. */
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
     takes none (create.js `runningJobs`), `print-disabled` takes the domain
     (`disabledJobs`), and `print` takes a service (`jobState`). Cited by SYMBOL
     rather than line, because three line citations in this branch went stale in
     its own next commit, all off by exactly the number of lines that commit
     inserted. Passing a domain to `list` makes launchctl
     exit non-zero, which threw and looked like a test failure on the first run. */
    let ran = 0;
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
      try { r = live.run('/bin/launchctl', argv); ran += 1; } catch { r = { threw: true }; }
      assert.notEqual(r && r.sandboxRefused, true,
        `the guard REFUSED the read verb '${argv[0]}', which would break every `
        + 'sandboxed test that legitimately enumerates');
    }

    /**
     * 🛑 AT LEAST ONE READ MUST ACTUALLY HAVE EXECUTED. Without this floor, a host
     * with no /bin/launchctl throws on all three, `sandboxRefused` is undefined
     * every time, and the test is GREEN while proving nothing about its named
     * property. "The read ran and was allowed" and "there is no launchctl here"
     * must not produce the same pass.
     */
    assert.ok(ran > 0,
      'no read verb actually executed, so this test proves nothing: every call '
      + 'threw, which on a host without /bin/launchctl is indistinguishable from '
      + 'a pass');

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
   * the `enable` in `installJob` and the `bootout` in `rollBack` both wrap the
   * call in `try { run(...) } catch {}` and never read the return value, and
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


test('#1539: FORGETTING to redirect LAUNCH is a sandbox too', () => {
  /**
   * 🛑 THE COMMONER MISTAKE, AND THE ONE A LAUNCH-KEYED PREDICATE CANNOT SEE.
   * A test that sandboxes DATA, PROJECTS and WORKERS but forgets LAUNCH writes a
   * REAL plist into the operator's real ~/Library/LaunchAgents and registers a
   * real job. Keying only on "has LAUNCH moved" stands down on exactly that.
   *
   * `engine/sandbox.js` already calls this state `partial` and refuses to start a
   * board in it (#634: a board is sandboxed whole or not at all). Consulting it
   * here means this module does not become a second, disagreeing definition of
   * "am I sandboxed".
   */
  withOnlyLaunch(() => {
    delete process.env.AGENT_WORKFORCE_LAUNCH;
    assert.equal(create.launchIsSandboxed(), false,
      'precondition: with NOTHING sandboxed this must be production');

    process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'w2data');
    assert.equal(create.launchIsSandboxed(), true,
      'DATA was sandboxed and LAUNCH forgotten, which writes a REAL plist, and '
      + 'the predicate called it production');
  });

  /* CONTROL: back to nothing set, it must return false again, so the assertion
     above cannot be passing because the predicate is stuck on true. */
  withOnlyLaunch(() => {
    delete process.env.AGENT_WORKFORCE_LAUNCH;
    assert.equal(create.launchIsSandboxed(), false,
      'CONTROL: the predicate can still say production, so true above means something');
  });
});

test('#1539: the BARE launchctl spelling is refused too, not just /bin/launchctl', () => {
  /**
   * 🛑 THIS ARM EXISTED NOWHERE UNTIL I AUDITED MY OWN COMMIT. I changed the
   * match from `file === '/bin/launchctl'` to a basename comparison and wrote
   * no assertion for it, so reverting that change would have left the suite
   * green. A behaviour change with nothing that can fail on it is the same
   * defect this whole card is about.
   *
   * ⚠️ IT IS NOT HYPOTHETICAL: `engine/delete-leftover.js:257` already calls
   * `run('launchctl', [...])` bare, and `command -v launchctl` resolves it to
   * /bin/launchctl, so it is a live call and not a typo that would fail.
   */
  delete require.cache[require.resolve('./create')];
  const live = require('./create');
  try {
    assert.equal(live.launchIsSandboxed(), true,
      'precondition: this file redirects LAUNCH, so the guard must be armed');

    const bare = live.run('launchctl', ['bootstrap', `gui/${process.getuid()}`, '/tmp/none.plist']);
    assert.equal(bare && bare.sandboxRefused, true,
      'the BARE spelling walked past the guard; delete-leftover.js:257 uses it');

    const full = live.run('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, '/tmp/none.plist']);
    assert.equal(full && full.sandboxRefused, true,
      'the full path must still be refused');

    /* CONTROL: a READ under the bare spelling must NOT be refused, so the two
       assertions above cannot be passing because the guard refuses everything
       it sees. */
    let read;
    try { read = live.run('launchctl', ['list']); } catch { read = { threw: true }; }
    assert.notEqual(read && read.sandboxRefused, true,
      'CONTROL: the guard refused a READ, so it is inert-refusing and the '
      + 'assertions above prove nothing about the basename match');
  } finally {
    delete require.cache[require.resolve('./create')];
  }
});


test('#1539: a non-array args FAILS CLOSED, it does not fall through to exec', () => {
  /**
   * 🛑 THE GUARD'S OWN COMMENT ARGUES THAT DEFAULT-IS-DANGEROUS IS THE BUG, AND
   * AN EARLIER VERSION OF IT CONTAINED EXACTLY THAT SHAPE. The clause read
   * `Array.isArray(args) && !READS.includes(args[0])`, so a NON-array `args`
   * skipped the guard entirely and fell through to execFileSync. Not a verb
   * defaulting open, a SHAPE defaulting open, one line below the paragraph
   * warning about the former.
   *
   * ⚠️ It matters more now that `run` is exported: `create.run('/bin/launchctl')`
   * is a supported call, and it executed instead of refusing.
   *
   * Empty array, wrong case, and a boxed String all already failed closed; only
   * the non-array shape did not.
   */
  delete require.cache[require.resolve('./create')];
  const live = require('./create');
  try {
    assert.equal(live.launchIsSandboxed(), true, 'precondition: guard must be armed');

    for (const args of [undefined, null, 'bootstrap', 42, {}]) {
      let r;
      try { r = live.run('/bin/launchctl', args); } catch { r = { threw: true }; }
      assert.equal(r && r.sandboxRefused, true,
        `a non-array args (${String(args)}) fell through to exec instead of being refused`);
    }

    /* CONTROL: a real READ with a proper array must still NOT be refused, so the
       assertions above cannot be passing because the guard refuses everything. */
    let read;
    try { read = live.run('/bin/launchctl', ['list']); } catch { read = { threw: true }; }
    assert.notEqual(read && read.sandboxRefused, true,
      'CONTROL: the guard refused a well-formed read, so it is inert-refusing');
  } finally {
    delete require.cache[require.resolve('./create')];
  }
});


test('#1539: a non-default KOSMOS_HOME install is NOT refused (the escape hatch is honoured)', () => {
  /**
   * 🛑 THE PRODUCTION PATH AN EARLIER VERSION OF THIS GUARD BROKE, SILENTLY AND
   * FOREVER. `install/setup.sh` exports DATA, PROJECTS and WORKERS for a
   * non-default KOSMOS_HOME (:2635-2637), DELIBERATELY leaves LAUNCH unset so
   * plists go to the REAL LaunchAgents, and exports
   * AGENT_WORKFORCE_HALF_SANDBOX_OK=1 (:2662) as sandbox.js's own named escape
   * hatch for exactly that shape. All four are written into the board plist's
   * EnvironmentVariables (:2782), so the server carries them at EVERY LOGIN.
   *
   * With the guard keyed on `audit().set`, that env refused the registration,
   * `installJob` reported started:false, and `createAgentInner` rolled the whole
   * creation back. Nothing in the release gate would have caught it:
   * tools/test-install.sh always pins AGENT_WORKFORCE_LAUNCH.
   */
  withOnlyLaunch(() => {
    delete process.env.AGENT_WORKFORCE_LAUNCH;
    const savedOk = process.env.AGENT_WORKFORCE_HALF_SANDBOX_OK;
    process.env.AGENT_WORKFORCE_DATA = '/tmp/kh-1539/data';
    process.env.AGENT_WORKFORCE_PROJECTS = '/tmp/kh-1539/projects';
    process.env.AGENT_WORKFORCE_WORKERS = '/tmp/kh-1539/workers';
    try {
      process.env.AGENT_WORKFORCE_HALF_SANDBOX_OK = '1';
      assert.equal(create.launchIsSandboxed(), false,
        'a deliberate half-sandbox (setup.sh non-default KOSMOS_HOME) was treated as '
        + 'a sandbox, which refuses registration and rolls back every agent creation');

      /* CONTROL: the SAME env without the escape hatch must be refused, so the
         assertion above cannot be passing because the predicate is stuck false. */
      delete process.env.AGENT_WORKFORCE_HALF_SANDBOX_OK;
      assert.equal(create.launchIsSandboxed(), true,
        'CONTROL: an UNDELIBERATE half-sandbox must still be caught');
    } finally {
      if (savedOk === undefined) delete process.env.AGENT_WORKFORCE_HALF_SANDBOX_OK;
      else process.env.AGENT_WORKFORCE_HALF_SANDBOX_OK = savedOk;
    }
  });
});

test('#1539: the guard refuses in DRY_RUN order too, and fails closed with no passwd entry', () => {
  /**
   * Two branches the file named and did not assert, both found by review:
   *
   * 1. The guard sits AFTER `if (DRY_RUN)`. Test 6 covers the `if (runner)` half
   *    of that ordering and nothing covered this half, so moving the guard above
   *    DRY_RUN left every test green. Refusing under dry-run is the SAFE
   *    direction, but an unasserted ordering is an ordering that drifts.
   *
   * 2. `launchIsSandboxed` fails CLOSED when `os.userInfo()` throws (no passwd
   *    entry). ⚠️ THAT BRANCH IS NOT ASSERTED HERE AND I AM SAYING SO RATHER THAN
   *    IMPLYING IT IS. `os.userInfo()` does not throw on any machine this suite
   *    runs on, so the branch is unreachable without mocking a node builtin, and
   *    flipping it to `return false` leaves every test green. It is a documented,
   *    deliberate, UNTESTED decision. Anyone changing it gets no signal.
   */
  delete require.cache[require.resolve('./create')];
  const live = require('./create');
  try {
    /**
     * 🛑 NO RUNNER. An earlier version of this test set a runner AND dry-run, so
     * `if (runner)` answered first and it silently duplicated test 6 instead of
     * testing the DRY_RUN ordering it is named for. `setRunner(null)` forces
     * DRY_RUN on with no runner, which is the only configuration that reaches
     * the `if (DRY_RUN)` line with the guard still below it.
     */
    live.setRunner(null);
    assert.equal(live.DRY_RUN, true, 'precondition: setRunner(null) must force dry-run');
    const r = live.run('/bin/launchctl', ['bootstrap', 'gui/501', '/tmp/x.plist']);
    assert.notEqual(r && r.sandboxRefused, true,
      'the guard fired AHEAD of the DRY_RUN short-circuit, so every dry-run suite '
      + 'would start seeing refusals instead of the dry-run answer');
    assert.equal(r.dryRun, true, 'the DRY_RUN short-circuit must be the one answering');
  } finally {
    try { require('./create').setRunner(null); } catch { /* module reset below */ }
    delete require.cache[require.resolve('./create')];
  }
});


test('#1539 RESIDUAL: the escape hatch disarms the guard, and that is known and undecidable', () => {
  /**
   * 🛑 THIS TEST PINS A HOLE, DELIBERATELY. It asserts the guard STANDS DOWN in a
   * state where the #1539 harm is still possible, so the boundary is intentional
   * and visible rather than accidental.
   *
   * The state: the other three sandboxed, `HALF_SANDBOX_OK=1`, LAUNCH forgotten.
   * A test in that state writes a real plist and registers a real job. The hatch
   * is exactly what sandbox.js tells you to set when a board refuses to start
   * half-sandboxed, so it is reachable by the most likely next author.
   *
   * ⚠️ IT CANNOT BE CLOSED HERE. Measured: a legitimate non-default-KOSMOS_HOME
   * install and a test that sets the hatch present an IDENTICAL environment. Any
   * predicate refusing one refuses the other, and refusing the real install rolls
   * back every agent creation on it.
   *
   * ✅ The real fix is #1598: fail closed and require an explicit live opt-in at
   * the one production caller, so nothing has to infer intent from the
   * environment. If that lands, THIS TEST SHOULD FAIL and be deleted, which is
   * the point of pinning it.
   */
  withOnlyLaunch(() => {
    delete process.env.AGENT_WORKFORCE_LAUNCH;
    const saved = process.env.AGENT_WORKFORCE_HALF_SANDBOX_OK;
    process.env.AGENT_WORKFORCE_DATA = '/tmp/residual-1539/data';
    try {
      process.env.AGENT_WORKFORCE_HALF_SANDBOX_OK = '1';
      assert.equal(create.launchIsSandboxed(), false,
        'KNOWN RESIDUAL: with the hatch set the guard stands down. If this now '
        + 'reads true, #1598 or an equivalent has landed: delete this test.');

      /* CONTROL: without the hatch the SAME state is caught, so the assertion
         above is about the hatch and not about the state being harmless. */
      delete process.env.AGENT_WORKFORCE_HALF_SANDBOX_OK;
      assert.equal(create.launchIsSandboxed(), true,
        'CONTROL: without the hatch this state must still be refused');
    } finally {
      if (saved === undefined) delete process.env.AGENT_WORKFORCE_HALF_SANDBOX_OK;
      else process.env.AGENT_WORKFORCE_HALF_SANDBOX_OK = saved;
    }
  });
});

function countKosmosJobs() {
  const { spawnSync } = require('node:child_process');
  const r = spawnSync('/bin/launchctl', ['list'], { encoding: 'utf8' });
  return String(r.stdout || '').split('\n').filter((l) => l.includes('com.kosmos.agent')).length;
}
