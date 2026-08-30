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
 * occurrences; the control figure that used to sit here was taken before a sibling
 * line in the same diff changed it, so it is stated as a bare zero rather than as
 * a ratio that decays). It has been removed rather
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

test('#1539: a sandboxed LAUNCH refuses to register, and registers NOTHING', () => {
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

  /**
   * 🛑 THE PRECONDITION THIS TEST WAS MISSING, AND IT IS THE ONLY TEST THAT CAN
   * REGISTER A REAL JOB. Tests 4, 8 and 9 all open by asserting the guard is
   * armed; this one did not, and the file header claimed the predicate was
   * "asserted FIRST on all four arms" - true of the predicate tests, which run
   * inside withOnlyLaunch() and therefore certify a LAUNCH-only environment, not
   * the four-knob environment this test runs in.
   *
   * ⚠️ If the guard ever regresses, this test bootstraps a real
   * com.kosmos.agent.sandboxprobe* into gui/501, and the sandbox tmpdir is removed
   * at process exit - deleting the plist out from under a live registration. That
   * is the 18-minute incident, produced by the test whose job is to prevent it.
   */
  /**
   * 🛑 ASSERT THE GUARD, NOT ONLY THE PREDICATE, AND THIS DISTINCTION IS THE WHOLE
   * SAFETY OF THIS TEST. An earlier version asserted `launchIsSandboxed()` alone.
   * That covers a PREDICATE regression and is blind to the likelier one: the guard
   * clause going inert. Measured - prefixing the guard with `false &&` leaves the
   * predicate returning true, so the precondition PASSED and the test walked into
   * `installJob` and registered a real job. That is the 18-minute incident exactly.
   *
   * ⇒ The predicate assertion is kept because it is cheap and catches the other
   * arm. The one below is the one that matters: it asks the guard to actually
   * refuse, using a harmless plist path that exists nowhere.
   */
  assert.equal(live.launchIsSandboxed(), true,
    'precondition: the predicate must read sandboxed');
  assert.equal(
    live.run('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, '/tmp/nope-1539.plist']).sandboxRefused,
    true,
    'precondition: the GUARD must actually REFUSE a bootstrap before this test is '
    + 'allowed to call installJob with no runner and no dry-run');

  const before = countKosmosJobs();
  const name = `sandboxprobe${Math.random().toString(36).slice(2, 8)}`;
  fs.mkdirSync(nodePath.join(process.env.AGENT_WORKFORCE_WORKERS, name), { recursive: true });

  const res = live.installJob(name, { claudeBin: '/bin/echo', tmuxBin: '/bin/echo' });

  const after = countKosmosJobs();
  /**
   * 🛑 try/finally, AND THE ORDER WAS THE WHOLE DEFECT. An earlier version put the
   * bootout AFTER this assertion, with a comment saying "this runs regardless". It
   * does not: `assert.equal` THROWS, and the cleanup below it was never reached -
   * dead in exactly the case it exists for. Measured, both arms: assert-then-if
   * leaves the cleanup unrun; try/finally runs it.
   *
   * ⇒ Without this, a guard regression registers a real job, the assertion throws,
   * the bootout never fires, and the sandbox TMPDIR is removed at process exit OUT
   * FROM UNDER A LIVE REGISTRATION. That is the 18-minute incident, reproduced by
   * the test written to prevent it and disarmed by statement order.
   */
  try {
    assert.equal(after, before,
      `a sandboxed installJob changed the real launchd domain: ${before} -> ${after}`);
  } finally {
    if (after !== before) {
      const { spawnSync } = require('node:child_process');
      spawnSync('/bin/launchctl',
        ['bootout', `gui/${process.getuid()}/com.kosmos.agent.${name}`],
        { encoding: 'utf8' });
    }
  }
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

  /**
   * ✅ CLEAN UP IF THE GUARD FAILED. If `after !== before` a real job was
   * registered, and the assertion above has already thrown. This runs regardless
   * so the machine is not left holding it - the previous version had no bootout
   * anywhere in the file, which is exactly how one ran for 18 minutes.
   */
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

    /**
     * CONTROL: the mutating verbs must be refused, so the passes above cannot be
     * passing because the guard is inert.
     *
     * 🛑 EVERY MUTATING VERB THIS FILE ISSUES, NOT JUST `bootstrap`. An earlier
     * version asserted `bootstrap` alone, and every assertion in the file used it -
     * so adding `enable` and `bootout` to the allowlist left ALL TESTS GREEN while
     * a real `launchctl enable` reached the operator's launchd. `installJob` issues
     * `enable` before `bootstrap`, and `rollBack` issues `bootout`.
     *
     * ⇒ The plan claimed "BOTH DIRECTIONS ARE HARMFUL, WHICH IS WHY bootout IS ON
     * THE LIST". Nothing failed if `bootout` left the list. A stated safety
     * property with no arm behind it.
     *
     * These are pure `run()` calls against a label that does not exist, so a
     * refusal is asserted without registering or tearing down anything.
     */
    for (const argv of [
      ['bootstrap', `gui/${process.getuid()}`, '/tmp/none-1539.plist'],
      ['enable', `gui/${process.getuid()}/com.kosmos.agent.nosuch1539`],
      ['bootout', `gui/${process.getuid()}/com.kosmos.agent.nosuch1539`],
      ['disable', `gui/${process.getuid()}/com.kosmos.agent.nosuch1539`],
      ['kickstart', `gui/${process.getuid()}/com.kosmos.agent.nosuch1539`],
    ]) {
      const m = live.run('/bin/launchctl', argv);
      assert.equal(m && m.sandboxRefused, true,
        `CONTROL: the mutating verb '${argv[0]}' was NOT refused, so the guard is `
        + 'inert for it and this test proves nothing');
    }
  } finally {
    delete require.cache[require.resolve('./create')];
  }
});

test('#1539: the refusal says WHY, so a future test that trips it is not left guessing', () => {
  /**
   * ⚠️ THE REFUSAL REACHES NO HUMAN AT ANY OF THE FOUR MUTATING CALL SITES, and an
   * earlier version of this said "two of the five", wrong twice: there are FOUR,
   * and NONE surfaces it. Both `bootstrap` sites read only `ok` and discard the
   * object;
   * the `enable` in `installJob` and the `bootout` in `rollBack` both wrap the
   * call in `try { run(...) } catch {}` and never read the return value, and
   * `sandboxRefused` is read nowhere in the repo. So the diagnostic sentence can
   * reach no human at those sites.
   *
   * ⇒ This asserts the message EXISTS and names the sandbox path and the fix.
   * That does not make it visible at any of them; making it visible is a behaviour
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


test('#1539: the DRY_RUN short-circuit answers AHEAD of the guard', () => {
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


test('#1539: sandboxing OTHER knobs does not refuse a REAL plist destination', () => {
  /**
   * 🛑 THIS IS THE CORRECTION FROM REVIEW SIX, AND IT REPLACES FOUR TESTS. An
   * earlier arm returned "sandboxed" whenever DATA/PROJECTS/WORKERS was set, on
   * the theory that somebody who sandboxed those meant to sandbox LAUNCH and
   * forgot. It returned BEFORE the path comparison, so it refused registrations
   * for plists genuinely going to the REAL LaunchAgents, and
   * `createAgentInner` rolled the whole creation back.
   *
   * `AGENT_WORKFORCE_HALF_SANDBOX_OK` is a DOCUMENTED user-facing override
   * (`sandbox.js:19`), so that was reachable by following the documentation.
   */
  withOnlyLaunch(() => {
    const saved = process.env.AGENT_WORKFORCE_HALF_SANDBOX_OK;
    try {
      delete process.env.AGENT_WORKFORCE_LAUNCH;
      process.env.AGENT_WORKFORCE_DATA = '/tmp/otherknobs-1539/data';

      /**
       * ⚠️ THE HATCH IS WHAT SEPARATES THESE TWO, and an earlier version of this
       * test asserted `allow` for the UNHATCHED case. That contradicted the gap
       * closure: an undeclared half-sandbox is a test that FORGOT LAUNCH and is
       * about to write a real plist. A DECLARED one is `setup.sh`'s production
       * shape, which always exports the hatch alongside the three.
       */
      process.env.AGENT_WORKFORCE_HALF_SANDBOX_OK = '1';
      assert.equal(create.launchIsSandboxed(), false,
        'a DECLARED half-sandbox with LAUNCH pointing at the REAL directory was '
        + 'refused; the plist is going somewhere real and the operator said the '
        + 'half-sandbox was deliberate, so the registration must be real too');

      /* CONTROL: redirect LAUNCH and it must be caught, so the two assertions
         above are about the plist DESTINATION and not about the guard being
         inert. */
      process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'LaunchAgents');
      assert.equal(create.launchIsSandboxed(), true,
        'CONTROL: a redirected plist destination must still be refused');
    } finally {
      if (saved === undefined) delete process.env.AGENT_WORKFORCE_HALF_SANDBOX_OK;
      else process.env.AGENT_WORKFORCE_HALF_SANDBOX_OK = saved;
    }
  });
});

test('#1539: a half-sandbox nobody DECLARED is treated as a sandbox', () => {
  /**
   * 🛑 THIS PINNED A GAP AS PERMANENTLY OPEN AND THE JUSTIFICATION WAS FALSE.
   * The old comment said the gap "CANNOT" be decided from the environment, because
   * a test that forgets LAUNCH is byte-identical to a real install.
   *
   * ⚠️ THAT IS TRUE OF A TEST THAT **SETS THE HATCH**, and false of this shape.
   * `install/setup.sh` ALWAYS exports `AGENT_WORKFORCE_HALF_SANDBOX_OK=1` alongside
   * the three (:2635-2637 with :2662), so a real install is always hatched and a
   * forgetful test is not. `sandbox.js` already computes the difference and calls
   * it `partial`. I applied an absolute to the wrong shape and pinned it into a
   * permanent comment, which is what would have stopped the next person closing it.
   *
   * 📌 It is NOT the arm removed in review six: that keyed on `audit().set`, which
   * ignores the hatch and therefore refused real installs.
   */
  withOnlyLaunch(() => {
    const saved = process.env.AGENT_WORKFORCE_HALF_SANDBOX_OK;
    try {
      delete process.env.AGENT_WORKFORCE_LAUNCH;
      delete process.env.AGENT_WORKFORCE_HALF_SANDBOX_OK;
      process.env.AGENT_WORKFORCE_DATA = '/tmp/gap-1539/data';
      process.env.AGENT_WORKFORCE_PROJECTS = '/tmp/gap-1539/projects';
      process.env.AGENT_WORKFORCE_WORKERS = '/tmp/gap-1539/workers';
      assert.equal(create.launchIsSandboxed(), true,
        'everything sandboxed but LAUNCH forgotten, and nobody declared the '
        + 'half-sandbox: this writes a REAL plist and must be refused');

      /* CONTROL, and it is the production shape: DECLARING the half-sandbox with
         the hatch must be allowed. setup.sh always sets it, so if this goes true
         every non-default-KOSMOS_HOME install rolls back every agent creation. */
      process.env.AGENT_WORKFORCE_HALF_SANDBOX_OK = '1';
      assert.equal(create.launchIsSandboxed(), false,
        'CONTROL: a DECLARED half-sandbox is the setup.sh production shape and '
        + 'must NOT be refused');
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
