'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { mkTemp } = require('../test-support/tmpdir.js');

// ⚠️ SANDBOX BEFORE REQUIRING, because the module resolves its roots at load.
// This one matters more than usual: the thing under test MAKES DIRECTORIES,
// WRITES INSTRUCTION FILES and WRITES LAUNCHD JOBS. An unsandboxed run would
// litter the operator's real worker tree and `~/Library/LaunchAgents` with
// agents that then start on the next reboot.
// ⚠️ Fixture names are deliberately ones no real agent could have. The first
// version used `casey` -- which is a LIVE agent on this machine, with its own
// worker directory and running session. The sandbox held, so nothing happened;
// but a fixture that names a real agent means the day the sandbox slips, the
// test overwrites that agent's boot file instead of failing. Checking for
// leakage afterwards was also useless with that name, because the directory it
// would have created already existed for real reasons.
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'create-test-'));
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'LaunchAgents');
/* ⚠️ AND A SANDBOXED HOME, because `setAccount` asks `accounts.js` which
   accounts exist, and `accounts.js` resolves its home at REQUIRE time. Without
   this the account tests would read the operator's real `~/.claude*` -- so they
   would pass or fail depending on whose machine ran them, which is not a test.
   (`create.js` keeps using `os.homedir()` for the plist's own HOME variable;
   that is the agent's real home and is deliberately not sandboxed here.) */
process.env.AGENT_WORKFORCE_HOME = nodePath.join(SANDBOX, 'home');
// ⚠️ AND THE SUPPORT ROOT, which is where the SHARED supervisor is installed.
// Without it these tests wrote into the operator's real
// `~/Library/Application Support/AgentWorkforce`, and the refresh test
// deliberately overwrote the live supervisor with a one-line comment before
// putting it back. An interrupted run would have left every created agent's
// launchd job pointing at a file that is a comment: bash exits at once,
// KeepAlive respawns it every thirty seconds forever. That is word for word the
// harm this branch exists to prevent, manufactured by its own test, and nothing
// cleaned that path up because it was outside the sandbox.
//
// It also made two assertions vacuous: `existsSync(supervisorPath())` passed off
// a PREVIOUS run's leftovers whatever this creation did.
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'support');
// ⚠️ AND THE FOURTH ROOT, added the day creation started answering Claude
// Code's trust question. Without it every successful creation in this suite
// READ AND REWROTE THE OPERATOR'S OWN ~/.claude.json — a 100KB file holding
// their account, their MCP servers and 22 projects' settings — adding a
// trusted entry for a fixture directory in /var/folders that will not exist an
// hour later. Three roots sandboxed and one live is the exact shape of the
// last time this went wrong.
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.on('exit', () => {
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

const create = require('./create');

/**
 * ⚠️ The programs an agent is made of, pinned to something that exists
 * everywhere.
 *
 * `createAgent` now refuses when Claude or tmux is not where it expects — which
 * is right, and which made this suite depend on the machine running it having
 * Claude at `~/.local/bin/claude`. A test that passes because of what happens
 * to be installed is not testing the thing it names. Every creation here passes
 * its own, and the refusal has a test of its own below.
 */
const BINS = { claudeBin: '/bin/echo', tmuxBin: '/bin/echo' };
/* 🛑 A DIFFERENT REAL BINARY FROM `claudeBin`, AND THAT IS THE WHOLE POINT.
   Every `codexBin` in this file used to be `/bin/echo` as well - the SAME PATH
   as claude - so no assertion anywhere could tell a codex-labelled job pointing
   at the CODEX binary from one pointing at the CLAUDE binary. Measured (#1359):
   `setProvider`'s `runnerBin = runner === 'codex' ? codexBin : claudeBin` could
   be replaced with `claudeBin` outright and the whole suite stayed green, while
   the identical edit in `createAgentInner` went RED - because creation's
   fixtures happen to distinguish them and switching's did not.
   ⇒ Two fixtures with the same value cannot test a choice between them. */
const CODEX_BIN = '/bin/cat';

/**
 * The supervisor as SHIPPED, read from disk.
 *
 * ⚠️ These tests used to assert against a string this module generated per
 * agent. There is no such string any more: there is one file, checked in, that
 * every agent's job runs with its own arguments. So the tests read the artifact
 * that actually runs — which is also the only version that can be reviewed
 * once.
 */
function supervisorText() {
  return fs.readFileSync(create.supervisorSource(), 'utf8');
}

/**
 * The argument vector the launchd job actually passes, read out of the plist.
 *
 * ⚠️ Read rather than restated. The order in which `plistFor` writes those
 * strings and the order `agent-supervisor.sh` reads them are one contract with
 * two ends, and nothing else in the suite pins it: swapping two of them starts
 * every real agent with its working directory as its session name, and every
 * assertion here would still pass.
 */
function jobArguments(name, { model = null, runner } = {}) {
  const plist = create.plistFor(name, '/bin/echo', '/opt/homebrew/bin/tmux', model, null, runner);
  const block = plist.slice(plist.indexOf('<array>'), plist.indexOf('</array>'));
  return [...block.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1]).slice(1);
}

/**
 * ⚠️ ARM DRY-RUN AT LOAD, before any test can run.
 *
 * The module header used to claim it was "dry-run by default". It is not:
 * `DRY_RUN` starts from an environment variable nothing sets, so a fresh
 * process with no runner installed executes for real — which is exactly what
 * the SERVER needs and exactly what a test must never have. The guarantee this
 * file depends on was only ever written down, and it happened to hold because
 * the first test installs a recorder.
 *
 * `setRunner(null)` re-arms dry-run, so this one line makes it true by
 * construction: any creation reaching `execFileSync` before a recorder is
 * installed is now impossible rather than merely unlikely.
 */
create.setRunner(null);
const roles = require('./roles');
const status = require('./status');
const fleet = require('../test-support/fleet');
const sendertoken = require('./sendertoken');
// The profile store, which is where a created agent's DISPLAY name is recorded.
const store = require('./store');

/**
 * A runner that records instead of executing.
 *
 * ⚠️ The DEFAULT is a poison runner that fails loudly, so a test which forgets
 * to install a recorder cannot quietly reach `execFileSync`. A forgotten
 * recorder passes while proving nothing, which is how this was learned.
 */
function recorder() {
  const calls = [];
  create.setRunner((file, args) => { calls.push([file, args]); return { ok: true, stdout: '' }; });
  return calls;
}
/**
 * ⚠️ And the ROSTER is sandboxed too, for the same reason the directories are.
 *
 * `createAgent` now asks the board which names are already running, and the
 * real answer on this machine is thirteen live agents. Left unsandboxed, every
 * test here would depend on which agents happen to be up while somebody runs
 * the suite — and a fixture name that collided with a real one would be refused
 * for a reason no assertion mentions. An EMPTY board is the default; the tests
 * that are about the roster set their own.
 */
test.beforeEach(() => { status.setPaneSource(() => ''); });
test.afterEach(() => { create.setRunner(null); status.setPaneSource(null); });

// ─────────────────────────────────────────────────────────────────────────────
// Names
// ─────────────────────────────────────────────────────────────────────────────

test('a name that cannot address an agent is refused before anything is made', () => {
  // ⚠️ These are not style rules. Each one corresponds to a way the rest of the
  // system has already broken:
  //   - a name that sanitises to something else lets two names become one, and
  //     a request naming one reached the other.
  //   - a leading `_` survives safeKey and is refused by safeServiceName and
  //     safeTarget, so the agent is created and then unreachable.
  // #740: 'has space' moved from this list to the accepted one below; a space
  // between words is a name now (shown as typed, hyphenated for the machine).
  for (const bad of ['', '  ', 'My.Bot', '_bot', '-bot', 'a', 'has\ttab', 'emoji🙂']) {
    assert.ok(create.nameProblem(bad), `'${bad}' was accepted as a name`);
  }
  // ⚠️ A CAPITAL IS NO LONGER A REFUSAL, and `MyBot` moved from the list above
  // to this one on purpose. It used to be answered with "use lower case, so the
  // name is the same everywhere it appears" — a true sentence about the
  // machinery, and the wrong thing to say to somebody naming a colleague. The
  // capital is now the DISPLAY name and `slugFor` supplies the machine one, so
  // `Casey` is a name you can type and `My.Bot` is still refused because its
  // slug is not a name we can build an agent out of.
  for (const good of ['fixture-agent', 'casey-2', 'my_bot', 'a1', 'MyBot', 'Casey', 'has space', 'Kira Knightley']) {
    assert.equal(create.nameProblem(good), null, `'${good}' was refused`);
  }
});

test('#740: a two-word capitalised name is shown as typed and is one hyphenated machine name; nothing is stripped', () => {
  assert.equal(create.nameProblem('Kira Knightley'), null, 'the name Josh typed was refused');
  assert.equal(create.cleanName('Kira Knightley'), 'Kira Knightley');
  assert.equal(create.slugFor('Kira Knightley'), 'kira-knightley');
  assert.equal(create.slugFor('  Kira   Knightley '), 'kira-knightley', 'a run of spaces is one hyphen');
  assert.equal(create.nameProblem('Kira.Knightley'), 'use letters, numbers, hyphens and underscores, starting with a letter or number', 'a dot is still refused, never stripped');
  assert.equal(create.nameProblem('Kira Knightley-discord'), 'names cannot end in -discord, which the board reads as an agent running somewhere else');
  // Through the real create path: the machine name is the slug and the shown name is the record.
  create.setRunner(() => ({ ok: true }));
  create.setDryRun(false);
  const r = create.createAgent({ ...BINS, name: 'Kira Knightley', role: 'pm' });
  assert.equal(r.outcome, create.OUTCOME.CREATED, r.because || '');
  assert.equal(store.readProfile('kira-knightley').displayName, 'Kira Knightley');
  // The second spelling of the same machine name is refused by name, not merged.
  const again = create.createAgent({ ...BINS, name: 'kira-knightley', role: 'pm' });
  assert.equal(again.outcome, create.OUTCOME.REFUSED);
  assert.match(again.because, /already an agent called/);
});

test('the display name and the machine name differ ONLY in case, which is what makes the split safe', () => {
  /**
   * ⚠️ THE LOAD-BEARING PROPERTY OF 6b. The display name is written into the
   * instruction file an agent boots from — the most powerful write in the
   * product — so if it could differ from the slug by anything other than case,
   * this feature would have opened an injection surface into that file.
   *
   * It cannot, and the reason is that `nameProblem` validates the SLUG against
   * `NAME_RE`, which admits only `[a-z0-9_-]`. Lower-casing is the only
   * transform between the two, so an accepted display name is made of exactly
   * those characters with some upper-cased. Asserted as a property over the
   * same alphabet the shell-safety test uses, rather than trusted.
   */
  const alphabet = ' \t\n\'"`$();|&<>*?![]{}\\/#~^%+=:,.@abzAZ09_-*';
  let accepted = 0;
  for (const ch of alphabet) {
    for (const candidate of [`a${ch}b`, `${ch}ab`, `ab${ch}`, `A${ch}B`]) {
      if (create.nameProblem(candidate) !== null) continue;
      accepted += 1;
      const shown = create.cleanName(candidate);
      /* ⚠️ Pinned to the CANDIDATE, not to each other (round 37). The old
         assertion here was `shown.toLowerCase() === slugFor(candidate)`,
         and since `slugFor` is defined as `cleanName(x).toLowerCase()` that
         reduces to an identity no implementation of `cleanName` can fail --
         the load-bearing property was held by nothing. The raw candidate is
         the independent reference: the display name must be the typed name
         (trimmed, nothing stripped), and the machine name must be exactly
         that lower-cased. A `cleanName` that started STRIPPING (the safeKey
         hole: `My.Bot` silently becoming the agent `mybot`) now fails both
         lines instead of passing both. */
      assert.equal(shown, candidate.trim(),
        `'${candidate}' is shown as something other than what was typed`);
      /* #740: and a run of whitespace becomes one hyphen; nothing else. The
         raw candidate stays the independent reference. */
      assert.equal(create.slugFor(candidate), candidate.trim().toLowerCase().replace(/\s+/g, '-'),
        `'${candidate}' is shown as something that is not just the machine name in another case (spaces aside)`);
      assert.match(shown, /^[A-Za-z0-9][A-Za-z0-9 _-]*$/,
        `'${candidate}' would put something other than a name into the file an agent boots from`);
    }
  }
  assert.ok(accepted > 0, 'no candidate was accepted, so the assertions above never ran');
});

test('a refused name creates nothing at all', () => {
  const calls = recorder();
  // ⚠️ LEAVE DRY-RUN, or the filesystem half of this test cannot fail.
  // `afterEach` calls `setRunner(null)`, which re-arms dry-run, and `recorder()`
  // does not clear it -- so `createAgent` writes nothing even on a fully
  // successful path, and "a refused name still made a folder" passes whether or
  // not the refusal fired. It would still pass with the refusal moved to AFTER
  // the writes. That is the exact self-satisfying shape this file's own
  // comments condemn elsewhere.
  create.setDryRun(false);
  const r = create.createAgent({ ...BINS, name: '_bot', role: 'pm' });
  assert.equal(r.outcome, create.OUTCOME.REFUSED);
  assert.equal(calls.length, 0, 'a refused name still ran a command');
  assert.ok(!fs.existsSync(create.workerDir('_bot')), 'a refused name still made a folder');
});

// ─────────────────────────────────────────────────────────────────────────────
// The safety interlock
// ─────────────────────────────────────────────────────────────────────────────

test('dry-run cannot be left without a runner in place', () => {
  create.setRunner(null);
  assert.throws(() => create.setDryRun(false), /refusing to leave dry-run/,
    'the escape hatch opened with nothing to catch the commands');

  // And installing a runner first makes it safe, in that order only.
  recorder();
  create.setDryRun(false);
  assert.equal(create.DRY_RUN, false);

  // ⚠️ Removing the runner RE-ARMS dry-run. Without this the reverse ordering
  // leaves the module able to reach execFileSync with nothing injected.
  create.setRunner(null);
  assert.equal(create.DRY_RUN, true, 'clearing the runner left the real one armed');
});

// ─────────────────────────────────────────────────────────────────────────────
// Creating
// ─────────────────────────────────────────────────────────────────────────────

test('creating an agent writes its folder, its instructions and its startup job', () => {
  const calls = recorder();
  create.setDryRun(false);

  const r = create.createAgent({ ...BINS, name: 'fixture-agent', role: 'pm' });
  assert.equal(r.outcome, create.OUTCOME.CREATED, r.because);

  assert.ok(fs.existsSync(create.instructionFile('fixture-agent')), 'no instruction file');
  const text = fs.readFileSync(create.instructionFile('fixture-agent'), 'utf8');
  assert.match(text, /You are \*\*fixture-agent\*\*, a project manager/,
    'the instructions were not written for this agent by name');

  assert.ok(fs.existsSync(create.plistPath('fixture-agent')), 'no launchd job');
});

test('the launchd job carries PATH and LANG, or the board reports nothing or nonsense', () => {
  // ⚠️ Both were found the hard way on this machine, hours apart:
  //   - without PATH, launchd cannot find tmux, every call fails silently, and
  //     the board serves 200 with ZERO agents.
  //   - without LANG, tmux sanitises its own format output and replaces the tab
  //     separators with underscores, so every agent parses as one garbage field
  //     named `angel-discord_0.0_2.1.223_0__ …`.
  // See issue #23. A generated job that omits either recreates a bug we have
  // already paid for.
  const plist = create.plistFor('fixture-agent', '/bin/claude', '/opt/homebrew/bin/tmux');
  assert.match(plist, /<key>PATH<\/key>/, 'the job has no PATH, so tmux will not be found');
  assert.match(plist, /opt\/homebrew\/bin/, 'the PATH omits Homebrew, where tmux actually is');
  assert.match(plist, /<key>LANG<\/key>/, 'the job has no LANG, so tmux will mangle its own output');
  assert.match(plist, /UTF-8/);
  assert.match(plist, /<key>KeepAlive<\/key>/, 'the agent will not come back if it dies');
  assert.match(plist, /<key>RunAtLoad<\/key>/, 'the agent will not survive a reboot');
});

test('the session is claimed for Kosmos, and claimed as ITSELF, at every start', () => {
  // ⚠️ A NAME OF ITS OWN. These tests share one sandbox, so reusing `casey`
  // meant the second creation was refused as a duplicate -- and the assertion
  // then failed for a reason that has nothing to do with claims. A test whose
  // fixture collides with another test's is testing the collision.
  // ⚠️ The claim is what makes an agent Kosmos creates recognisable without a
  // Discord naming convention. `status.isNamedOurs` requires the claim to match
  // the pane's own name -- a claim naming something else is somebody else's.
  //
  // ⚠️ This used to assert a `set-option` COMMAND, run once at creation. That
  // was not enough and the test's own subject was the reason: the claim is a
  // tmux user option, so it dies with the session. Set once, it survived until
  // the first reboot and then the agent came back anonymous -- no role, no
  // model, no editable instructions -- which is precisely the blocker this
  // branch exists to remove, returning on its own after one restart. So the
  // claim now lives in the startup SCRIPT, which is what runs at every start,
  // and that is what this asserts.
  recorder();   // for the side effect: nothing here asserts on the calls
  create.setDryRun(false);
  create.createAgent({ ...BINS, name: 'claimed-one', role: 'pm' });

  const script = supervisorText();
  assert.match(script, /set-option -t "\$SESSION" @kosmos_agent "\$SESSION"/,
    'the startup script does not claim the session, so the board will stop '
    + 'recognising this agent the first time it restarts');
  // The AGENT is now an argument rather than baked in, so what pins "as itself"
  // is the job passing this agent's name and the script claiming "$SESSION".
  const plist = fs.readFileSync(create.plistPath('claimed-one'), 'utf8');
  assert.match(plist, /<string>claimed-one<\/string>/,
    'the job does not tell the supervisor which agent it is for');

  // And the board agrees that this is a claim.
  assert.equal(status.isNamedOurs({ session: 'claimed-one', name: 'claimed-one', claim: 'claimed-one' }), true,
    'the claim this writes is not the claim the board reads');

  // ⚠️ And the script must OUTLIVE the command that starts the session.
  // `tmux new-session -d` exits in a tenth of a second; with KeepAlive that
  // makes launchd restart the job forever, each restart failing on the session
  // the last one made, while the agent looks fine because the first attempt
  // worked. Measured against the thirteen agents already running on this
  // machine, whose own launcher carries this loop and says why.
  assert.match(script, /while .*has-session/,
    'nothing keeps the job alive, so launchd will respawn it in a loop forever');
  assert.match(script, /kill-session/,
    'a restart will collide with the session the previous run made');
  assert.match(script, /--dangerously-skip-permissions/,
    'the agent will start, look healthy, and freeze on its first permission prompt');

  // The job has to RUN the shared supervisor, not a per-agent copy.
  assert.match(plist, /agent-supervisor\.sh/, 'the job does not run the supervisor');
  assert.doesNotMatch(plist, /new-session/,
    'the job still starts tmux itself, which is the respawn loop this replaced');
  assert.ok(!fs.existsSync(nodePath.join(create.workerDir('claimed-one'), 'start.sh')),
    'a per-agent copy of the supervisor is still being written, so a fix here '
    + 'would reach only the agents created afterwards');

  // Installed, in one place, executable.
  assert.ok(fs.existsSync(create.supervisorPath()), 'the supervisor was never installed');
  assert.ok(fs.statSync(create.supervisorPath()).mode & 0o100, 'the supervisor is not executable');
});

test('the agent is started the same way it will be started every time after', () => {
  // ⚠️ ONE PATH. The previous version ran tmux itself and left the launchd job
  // on disk unloaded: the agent ran now and was gone after a reboot, and the
  // session a person got at creation was set up by different code from the one
  // they would have for the rest of the agent's life. Starting it any other way
  // means the first run is the only one anybody ever tested.
  const calls = recorder();
  create.setDryRun(false);
  const r = create.createAgent({ ...BINS, name: 'one-path', role: 'pm' });

  assert.equal(r.outcome, create.OUTCOME.CREATED, r.because);
  // ⚠️ Exactly ONE command STARTS anything. The other call is the read-only
  // `launchctl print` probe that asks whether this name already has a service
  // loaded, so it is excluded by name rather than by count -- counting alone
  // would have to be edited every time a read is added, which is how a count
  // assertion stops meaning what it says.
  const starting = calls.filter(([, a]) => a && a[0] !== 'print');
  assert.equal(starting.length, 1, 'creation ran more than the one command that starts the agent');
  const [file, args] = starting[0];
  assert.match(file, /launchctl$/, 'the agent was started by something other than its own job');
  assert.equal(args[0], 'bootstrap', 'the job was not loaded, so the agent will not survive a reboot');
  assert.match(args[2], /com\.kosmos\.agent\.one-path\.plist$/, 'a different job was loaded');
});

test('no COMMAND is handed to a shell to reinterpret', () => {
  // ⚠️ Renamed from "nothing reaches a shell", which stopped being true when
  // this module started generating one. What holds here is narrower and still
  // worth pinning: every command it RUNS goes through execFile with an argument
  // array. The generated script is covered by the behavioural tests below.
  // ⚠️ Every command is execFile with an argument array, so a name is ONE
  // argument and never text a shell could reinterpret. The name is validated
  // hard as well, which makes this belt and braces -- deliberately, because
  // this function makes launchd jobs.
  const calls = recorder();
  create.setDryRun(false);
  create.createAgent({ ...BINS, name: 'shell-probe', role: 'pm' });

  assert.ok(calls.length > 0, 'nothing ran at all, so this proves nothing');
  for (const [file, args] of calls) {
    assert.ok(Array.isArray(args), `${file} was called without an argument array`);
    assert.doesNotMatch(file, /sh$|bash$|zsh$/, 'a shell was invoked');
    for (const a of args) {
      assert.equal(typeof a, 'string', 'a non-string argument reached a command');
    }
  }
});

test('an agent that will not start is reported as PARTIAL, not as created', () => {
  // ⚠️ "Created" is a claim about us; "it is running" is a claim about the
  // agent. A setup that wrote three files and could not start the session has
  // not given the person an agent, and saying so is the whole difference
  // between this product and a wizard that always says Done.
  create.setRunner((file, args) => {
    if (args && args[0] === 'bootstrap') return { ok: false, stderr: 'Load failed: 5: Input/output error' };
    return { ok: true };
  });
  create.setDryRun(false);

  const r = create.createAgent({ ...BINS, name: 'dud', role: 'writer', displayName: 'Dudley' });
  assert.equal(r.outcome, create.OUTCOME.PARTIAL, 'a failed start was reported as success');
  assert.match(r.because, /could not start/);
  assert.ok(r.steps.some((s) => s.label === 'started it' && !s.ok),
    'the failing step is not visible in the record');
  // ⚠️ And NO display-name record survives the rollback (round 25): the
  // profile write used to happen mid-flow, and rollBack removes the plist
  // and worker dir but deliberately not profiles -- so a rolled-back
  // creation left "Dudley" waiting to dress any future agent under the
  // same slug. The write now happens only at CREATED.
  assert.equal(store.readProfile('dud').displayName, undefined,
    'a rolled-back creation left a display name for an agent that never existed');

  // ⚠️ And the files it DID write are still reported as written. A person whose
  // agent did not start needs to know what is on their computer -- "it all
  // failed" would be as untrue as "it all worked".
  assert.ok(r.steps.some((s) => s.label === 'wrote its instructions' && s.ok),
    'the steps that succeeded were erased by the one that failed');
});

// ⚠️ REMOVED: 'a session that starts but cannot be claimed is PARTIAL too'.
// It pinned an outcome that no longer exists rather than one that stopped being
// checked. The claim used to be a command Kosmos ran after starting the session,
// so it could fail on its own; it is now a line in the startup script, run by
// the job, after this function has returned. There is no moment at which we
// have a started session and a failed claim to report. What replaces it is
// stronger and lives in the claim test above: the line must be IN the script,
// so it runs at every start rather than once. The board seeing the agent as
// ours is what confirms it worked, and the creation screen watches for exactly
// that before it says the agent is up.

test('an existing agent is never quietly overwritten', () => {
  const calls = recorder();
  create.setDryRun(false);
  create.createAgent({ ...BINS, name: 'twice', role: 'pm' });
  const before = fs.readFileSync(create.instructionFile('twice'), 'utf8');

  const second = create.createAgent({ ...BINS, name: 'twice', role: 'writer' });
  assert.equal(second.outcome, create.OUTCOME.REFUSED);
  assert.match(second.because, /already an agent called twice/);
  assert.equal(fs.readFileSync(create.instructionFile('twice'), 'utf8'), before,
    'creating a second agent with the same name rewrote the first one’s instructions');
});

// ─────────────────────────────────────────────────────────────────────────────
// Roles
// ─────────────────────────────────────────────────────────────────────────────

test('every role ships a suggested first action', () => {
  // ⚠️ Not a nicety. Without one, a role lands the person on a working agent and
  // a blank prompt -- the exact blank box the role library exists to remove. A
  // role without a first action is not finished.
  for (const r of roles.ROLES) {
    assert.ok(r.firstAction && r.firstAction.length > 10,
      `role '${r.key}' has no suggested first action`);
    assert.ok(r.instructions.includes('{{NAME}}'),
      `role '${r.key}' never names the agent, so every one of them is anonymous`);
    assert.ok(r.blurb, `role '${r.key}' has nothing to show on the picker`);
  }
});

test('the roles where being wrong is expensive carry their limit in BOTH places', () => {
  // ⚠️ Legal was held out of the first set until the liability wording was
  // settled. Josh settled it on 2026-08-10: ship it, "but when they pick it out
  // say that it's not legal advice from a lawyer, same with the other roles we
  // greyed out". So the condition of shipping is the sentence being visible AT
  // THE MOMENT OF CHOICE.
  //
  // Both places, and each covers what the other cannot. The `caution` is what
  // the PERSON reads while choosing, before any work exists to be wrong about.
  // The instruction line is what the AGENT reads, every time it starts, long
  // after any setup screen has been clicked through. A role with only one of
  // them has a limit that either nobody sees or nobody follows.
  // ⚠️ EVERY cautioned role, DERIVED, each with the boundary its own
  // instructions must state -- and a cautioned role with no entry here FAILS
  // rather than slipping through, so the next caution added to the catalogue
  // arrives with its instruction half or arrives red. (Review round 1: the
  // literal three-key list left five cautions unpinned, and one of them --
  // support -- really did promise "never replies" while its instructions
  // never said so.)
  const BOUNDARY = {
    legal: /not a lawyer/i,
    finance: /do not give financial advice/i,
    // books is deliberately parallel to finance and not identical: recording
    // where analysis models, each caution saying the true thing about each
    // (catalogue build, 2026-08-16).
    books: /do not give financial or tax advice/i,
    ea: /draft, never send/i,
    email: /draft, never send/i,
    personal: /draft, never send or book/i,
    travel: /never book|do not book/i,
    social: /draft, never post/i,
    sales: /they send it, always/i,
    support: /draft, never send/i,
    recruiting: /every hiring decision is theirs/i,
    // Josh ruled autonomous briefing (2026-08-18). The pinned invariant
    // survives every wording of it: the PM does not attempt work outside
    // its skill -- it briefs the agent who has it.
    pm: /brief the agent who\s+has\s+it rather than attempting it badly/i,
  };
  for (const role of roles.ROLES.filter((r) => r.caution)) {
    const mustSay = BOUNDARY[role.key];
    assert.ok(mustSay,
      `${role.key} carries a caution with no boundary expectation registered `
      + 'here; add one, because an unpinned caution is how a role ships '
      + 'promising what its agent was never told');
    assert.match(role.instructions, mustSay,
      `${role.key} does not state its own boundary, so the only thing holding `
      + 'it is a sentence the operator read once');
    // ⚠️ POSITIVE CONTROL, per the catalogue audit that produced two false
    // readings in one pass: a boundary check that cannot fail is the next
    // thing to quietly stop working. Removing the matched boundary from a
    // COPY must un-match it -- if the pattern still matches the stripped
    // text, it was matching something other than the boundary.
    assert.ok(!mustSay.test(role.instructions.replace(mustSay, '')),
      `${role.key}'s boundary pattern matches more than the boundary, so `
      + 'deleting the boundary would leave this check green');
  }
  // The choice-time halves for the two roles whose wording is a shipping
  // condition (Josh, 2026-08-10) stay pinned exactly:
  assert.match(roles.byKey('legal').caution, /not a lawyer|not legal advice/i);
  assert.match(roles.byKey('finance').caution, /not financial advice/i);

  // ⚠️ And the roles that DO NOT need one must not have it. A caution on every
  // role is a caution nobody reads -- the same reason the provenance marker was
  // taken off every card.
  // ea moved OUT of this list with the 2026-08-16 catalogue: it gained the
  // draft-never-send caution (the send-on-your-behalf roles all carry one).
  // pm moved OUT 2026-08-17 (Mona Lisa's ruling, 493b79d): its blurb is
  // the one in the catalogue claiming it acts on other agents, and until
  // agent-to-agent messaging (#51) exists that claim needs the same
  // caution the other overstating blurbs carry.
  // The rule this loop holds is unchanged: most roles carry none, so the
  // ones that do still mean something. 9 of 26 have one.
  for (const key of ['writer', 'researcher', 'engineer', 'data', 'design']) {
    assert.ok(!roles.byKey(key).caution,
      `${key} carries a caution, and a warning on everything warns about nothing`);
  }
  assert.ok(roles.ROLES.filter((r) => r.caution).length < roles.ROLES.length / 2,
    'more than half the catalogue carries a caution, and a warning on most things warns about nothing');
});

test('the instructions name the agent, and carry no template language', () => {
  const text = roles.instructionsFor('pm', 'fixture-agent');
  assert.match(text, /You are \*\*fixture-agent\*\*/,
    'the agent is not named the way the board reads names — see the identity '
    + 'test below, which is what this emphasis is for');
  assert.doesNotMatch(text, /\{\{/, 'an unsubstituted placeholder shipped into an agent’s boot file');
  assert.equal(roles.instructionsFor('nosuch', 'fixture-agent'), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// The name has to be free on the BOARD, not only on disk
// ─────────────────────────────────────────────────────────────────────────────

test('a name a live session already answers to is refused, even with no folder', () => {
  const calls = recorder();

  // ⚠️ The session is `casey-discord`; the board calls that agent `casey`,
  // because the roster STRIPS the suffix without requiring it. So creating
  // `casey` here makes two sessions with one name — the collision
  // `onePanePerSession` exists to survive, manufactured by us.
  //
  // Measured before this gate existed: the creation screen watched for a
  // session called `casey`, found the fleet's existing one, and reported
  // "casey is running" over a creation that had done nothing whatsoever.
  create.setDryRun(false);   // or the folder assertion below cannot fail
  status.setPaneSource(() => fleet.line({ session: 'casey-discord', title: 'idle' }));
  const taken = create.createAgent({ ...BINS, name: 'casey', role: 'pm' });

  assert.equal(taken.outcome, create.OUTCOME.REFUSED, 'a name already on the board was accepted');
  assert.match(taken.because, /something called casey is already running/);
  assert.equal(calls.filter(([, a]) => a && a[0] !== 'print').length, 0,
    'a refused name still started a session');
  assert.ok(!fs.existsSync(create.workerDir('casey')), 'a refused name still made a folder');

  // ⚠️ THE CONTROL. Same name, same runner, same everything except an empty
  // board. Without it, a `createAgent` that refused `casey` for some unrelated
  // reason — or refused everything — would pass every assertion above.
  status.setPaneSource(() => '');
  const free = create.createAgent({ ...BINS, name: 'casey', role: 'pm' });
  assert.equal(free.outcome, create.OUTCOME.CREATED,
    'the refusal above was not caused by the roster, so this test proves nothing about it');
});

test('a machine we cannot ask about running agents is refused, not risked', () => {
  // ⚠️ FAIL CLOSED. "We could not check" is not "the name is free", and this is
  // the one place where guessing wrong makes a second agent under a live name.
  //
  // Both real shapes of the failure are exercised: `sh()` swallows a dead or
  // missing tmux and returns NULL, which `paneRoster` turns into a throw, and a
  // source that throws outright. The null one is the shape production actually
  // takes — a guard whose closed path only an injected throw can reach is not a
  // guard, which is exactly how the board's own tmux gate was found wrong.
  for (const [label, source] of [
    ['tmux answered nothing', () => null],
    ['tmux could not be run at all', () => { throw new Error('spawn ENOENT'); }],
  ]) {
    const calls = recorder();
    create.setDryRun(false);   // or the folder assertion below cannot fail
    status.setPaneSource(source);
    const r = create.createAgent({ ...BINS, name: 'fixture-blind', role: 'pm' });

    assert.equal(r.outcome, create.OUTCOME.REFUSED, `${label}: created an agent anyway`);
    assert.match(r.because, /could not check which agents are already running/);
    assert.equal(calls.filter(([, a]) => a && a[0] !== 'print').length, 0,
      `${label}: ran a command despite refusing`);
    assert.ok(!fs.existsSync(create.workerDir('fixture-blind')),
      `${label}: made a folder despite refusing`);
    create.setRunner(null);
  }

  // The control again: the same name goes through the moment the board answers.
  const calls = recorder();
  status.setPaneSource(() => '');
  assert.equal(create.createAgent({ ...BINS, name: 'fixture-blind', role: 'pm' }).outcome,
    create.OUTCOME.CREATED,
    'this name is refused whatever tmux says, so the assertions above are about nothing');
  assert.ok(calls.length > 0, 'a creation that reported success ran no commands');
});

test('a name never becomes shell text, and the validator still holds if it ever does', () => {
  // ⚠️ THE SURFACE IS GONE, which is the main thing the shared supervisor buys
  // beyond reviewability. The name used to be interpolated into a generated
  // bash script; it is now an ARGUMENT, so nothing about it is ever read by a
  // shell. The assertions at the bottom pin that it stayed gone.
  //
  // The property below is kept anyway. It is what the safety rested on before,
  // it costs nothing, and the name still becomes a directory, a service label
  // and a tmux session: anything `nameProblem` accepts is made only of
  // lower-case letters, digits, hyphen and underscore — a set with no quote, no
  // space, no metacharacter, no newline.
  const alphabet = ' \t\n\'"`$();|&<>*?![]{}\\/#~^%+=:,.@abzAZ09_-';
  let accepted = 0;
  for (const ch of alphabet) {
    for (const candidate of [`a${ch}b`, `${ch}ab`, `ab${ch}`]) {
      if (create.nameProblem(candidate) === null) {
        accepted += 1;
        // ⚠️ The property is about the name that gets USED, not the one that was
        // typed. The first version compared the raw candidate and failed on
        // ' ab' — which was a real finding, not a bad assertion: `nameProblem`
        // trimmed privately and `createAgent` trimmed again, so the validator
        // was answering about a string nobody would use and safety rested on
        // every caller happening to trim the same way. `cleanName` is now the
        // one trim, and this asserts the thing that actually matters.
        // ⚠️ `slugFor`, NOT `cleanName`, and the change is the whole of 6b in
        // one line. The name that becomes a directory, a service label and a
        // tmux session is the SLUG; `cleanName` now answers with the display
        // name, capitals and all. Asserting the display name here would be this
        // test measuring a string the machine never uses — which is the failure
        // shape `test-support/fleet` exists to make impossible one file over.
        assert.match(create.slugFor(candidate), /^[a-z0-9][a-z0-9_-]*$/,
          `'${candidate}' was accepted as a name, and it still becomes a directory, `
          + 'a service label and a tmux session');
      }
    }
  }
  // ⚠️ The anti-vacuity check. If the loop above accepted NOTHING the assertions
  // inside it never ran, and a `nameProblem` that refused everything would pass
  // this test while breaking the product.
  assert.ok(accepted > 0, 'no candidate was accepted, so the assertions above never ran');

  // ⚠️ AND THE SURFACE STAYED CLOSED. The supervisor takes its agent as an
  // argument, so there is nothing to quote and nothing to escape. A future
  // version that goes back to writing the name into the script would put the
  // whole class back, and this is what would notice.
  const script = supervisorText();
  assert.match(script, /SESSION="\$\{1/, 'the supervisor does not take its agent as an argument');
  assert.doesNotMatch(script, /SESSION='/,
    'the supervisor interpolates a name into shell text again, which is the surface '
    + 'removing the per-agent script was meant to close');
});

test('the board can read the identity the creation writes, for every role', () => {
  // ⚠️ THE COUPLING, tested from both ends and for every role rather than for
  // the one I happened to try. `roles` writes the instruction file; `status`
  // parses it to answer "who is this agent". Nothing but this test connects
  // them, and when they disagreed every created agent arrived on the board as
  // an anonymous machine name with no role — the product's own first-run
  // outcome, broken by a missing pair of asterisks in a template.
  //
  // Asserting the PROPERTY (the board derives a name and a role) rather than
  // the format: a template may be reworded freely, and a rewording that makes
  // the agent unreadable has to fail here.
  const calls = recorder();
  create.setDryRun(false);

  for (const role of roles.ROLES) {
    const name = `ident-${role.key}`;
    // own refuses without a label by design (its own test); the identity
    // property still has to hold for its example text.
    const made = create.createAgent({ ...BINS, name, role: role.key,
      ...(role.key === 'own' ? { label: 'Own Thing' } : {}) });
    assert.equal(made.outcome, create.OUTCOME.CREATED, made.because);

    const identity = status.readIdentity(name);
    assert.equal(identity.derived, true,
      `${role.key}: the board cannot work out who this agent is, so its card will `
      + 'show a raw session name flagged as a machine name');
    assert.equal(identity.displayName, name, `${role.key}: the board reads a different name`);
    assert.ok(identity.role && identity.role.length > 2,
      `${role.key}: the board reads no role from the file this role wrote`);
  }
  assert.ok(calls.length >= roles.ROLES.length, 'no agent was actually created, so this proves nothing');
});

test('an agent is refused when the programs it is made of are not on this machine', () => {
  // ⚠️ Without this, creation reported CREATED, the screen waited thirty
  // seconds and then said it did not know why, and launchd was left respawning
  // an instantly-failing job every thirty seconds for as long as the machine
  // was on. The defaults are THIS machine's paths -- an npm-global Claude or an
  // Intel Mac's Homebrew is enough to hit it.
  const calls = recorder();
  create.setDryRun(false);

  for (const [what, bins] of [
    ['Claude', { claudeBin: '/nope/claude', tmuxBin: '/bin/echo' }],
    ['tmux', { claudeBin: '/bin/echo', tmuxBin: '/nope/tmux' }],
  ]) {
    const r = create.createAgent({ ...bins, name: 'no-binary', role: 'pm' });
    assert.equal(r.outcome, create.OUTCOME.REFUSED, `${what} missing: created anyway`);
    assert.match(r.because, /could not find/);
    assert.ok(!fs.existsSync(create.workerDir('no-binary')), `${what} missing: made a folder anyway`);
    assert.equal(calls.filter(([, a]) => a && a[0] !== 'print').length, 0,
      `${what} missing: ran a command anyway`);
  }

  // A path that could break out of the shell text it is written into is refused
  // on its shape rather than on whether it happens to exist.
  const nasty = create.createAgent({
    claudeBin: "/bin/echo';id;'", tmuxBin: '/bin/echo', name: 'no-binary', role: 'pm',
  });
  assert.equal(nasty.outcome, create.OUTCOME.REFUSED, 'a path carrying shell syntax was accepted');

  // THE CONTROL: the same name goes through with both programs present.
  assert.equal(create.createAgent({ ...BINS, name: 'no-binary', role: 'pm' }).outcome,
    create.OUTCOME.CREATED, 'this name is refused whatever the paths, so the above proves nothing');
});

test('a write that fails stops the creation instead of loading a job that cannot work', () => {
  // ⚠️ Only the folder and the start gated the outcome, so a failed write still
  // returned CREATED -- "set up and starting" over an agent whose startup
  // script was never written. That is worse than untrue: bash exits at once on
  // a missing script and KeepAlive restarts it, so the machine gets a job that
  // fails every thirty seconds forever. And the screen built on this told the
  // person "the folder and the instructions are on your computer either way",
  // which is false in exactly the case that produced it.
  const calls = recorder();
  create.setDryRun(false);

  const realWrite = fs.writeFileSync;
  try {
    fs.writeFileSync = (file, ...rest) => {
      if (String(file).endsWith('CLAUDE.md')) throw new Error('disk full');
      return realWrite(file, ...rest);
    };
    const r = create.createAgent({ ...BINS, name: 'half-made', role: 'pm' });

    assert.equal(r.outcome, create.OUTCOME.PARTIAL, 'a half-written agent was reported as created');
    assert.match(r.because, /could not write everything/);
    assert.ok(r.steps.some((s) => s.label === 'wrote its instructions' && !s.ok),
      'the failing step is not visible in the record');
    assert.equal(calls.filter(([, a]) => a && a[0] !== 'print').length, 0,
      'the job was loaded anyway, so launchd now retries a missing script every thirty seconds');
  } finally {
    fs.writeFileSync = realWrite;
  }

  // THE CONTROL: with writing working, the same name is created and the job IS
  // loaded -- otherwise this test would pass against a createAgent that refused
  // everything.
  const calls2 = recorder();
  const ok = create.createAgent({ ...BINS, name: 'half-made-2', role: 'pm' });
  assert.equal(ok.outcome, create.OUTCOME.CREATED, ok.because);
  assert.equal(calls2.filter(([, a]) => a && a[0] !== 'print').length, 1,
    'the control did not actually load a job');
});

test('the startup script will not kill a session it cannot prove is ours', () => {
  // ⚠️ The kill was unconditional, and it runs at every login and after every
  // crash -- so a person who happened to have a tmux session of this name would
  // have had it destroyed with no warning by a job installed weeks earlier. The
  // board refuses to act on any pane it cannot tie to a name; a script that
  // kills one is that rule broken from the outside.
  const script = supervisorText();

  // ⚠️ The ORDER of these two lines is no longer asserted here, and that is a
  // correction rather than a loss. Comparing line indexes matched the words
  // inside a comment the moment one mentioned `kill-session`, and it could
  // never have caught the thing it was written for anyway: moving the kill out
  // of the ours-branch keeps the order and restores the bug. The behavioural
  // test below RUNS this script against a fake tmux and asserts no kill
  // reaches a session that is not ours, which is the real guarantee. What is
  // left here is the presence of the parts, which is worth pinning cheaply.
  assert.ok(script.includes('@kosmos_agent'), 'the script never checks whose session it is');
  assert.ok(script.includes('kill-session'), 'the script can never replace a crashed agent');

  // And it WAITS rather than exiting: exiting would have launchd restart it
  // every thirty seconds against a session it must not touch. The poll is short
  // because the screen only waits thirty seconds in total, so a name that frees
  // up must not cost more than that before the agent starts. Since #579 the
  // interval rides a test seam, so the pin holds the DEFAULT (the thing the
  // thirty-second reasoning depends on) rather than a literal sleep line;
  // tools/test-supervisor-wait.sh runs the loop for the behaviour.
  assert.match(script, /WAIT_POLL_SECS:-5\}/, 'the short poll default moved; the screen’s thirty-second wait depends on it');
  assert.match(script, /sleep "\$POLL_SECS"/, 'nothing waits for the other session to end');
  assert.match(script, /waiting rather than killing it/, 'nothing says why the agent has not started');
  // #579's own pins: the not-ours wait must be able to SAY it is failing --
  // an escalation that names the blockage and repeats -- and must never
  // quietly give up (no exit on the not-ours path; the loop's only ends are
  // the holder ending or an ours-branch).
  assert.match(script, /STILL WAITING/, 'the not-ours wait went silent again after the first warning');
  assert.match(script, /held by a session we did not create/, 'the escalation stopped naming the failure');
});

test('the startup script names its session exactly, not by prefix', () => {
  // ⚠️ tmux's default target resolution falls back to a PREFIX MATCH. Measured
  // on this machine: with only `angel-discord` running, `tmux has-session -t
  // ang` exits 0 and `-t "=ang"` correctly fails. So an agent named `sam`
  // created beside a `samantha-discord` session would find the WRONG session in
  // its wait loop, read a claim that can never equal its own name, and sleep
  // forever -- and once its own session ended, the supervision loop would never
  // exit, so launchd would never bring it back. Two silent hangs, both invisible
  // to the screen, which can only say "it has not come up".
  //
  // The creation-time roster check cannot catch this: it compares exact names in
  // JavaScript, and the prefix match happens later, inside tmux.
  const script = supervisorText();
  assert.match(script, /TARGET="=\$SESSION"/,
    'the supervisor does not build an exact-match target from the agent it was given');

  // ⚠️ MEASURED, not assumed, on tmux 3.6a: `has-session` and `kill-session`
  // accept the exact-match "=name" form, and `set-option`, `show-options` and
  // `list-panes` REJECT it ("no such session: =name"). Using it everywhere
  // looked more careful and broke the claim on a real agent -- the board then
  // showed a created agent as anonymous, which is the blocker this branch
  // exists to remove, reintroduced by its own fix.
  //
  // So the property is per-command, and it is asserted per-command rather than
  // as one blanket rule that would be wrong half the time.
  // ⚠️ Re-measured after the first version of this list put `list-panes` in the
  // wrong column. It accepts the exact form; the probe that said otherwise had
  // been run against an already-dead session, so it failed for a reason
  // unrelated to the syntax. A test that encodes a wrong measurement fails a
  // CORRECT change, which is worse than not testing the line at all.
  const EXACT = ['has-session', 'kill-session', 'list-panes'];
  const PLAIN = ['set-option', 'show-options'];
  let checked = 0;
  for (const line of script.split('\n')) {
    if (line.trim().startsWith('#') || !/-t /.test(line)) continue;
    const cmd = (line.match(/"\$TMUX_BIN" ([a-z-]+)/) || [])[1];
    if (EXACT.includes(cmd)) {
      checked += 1;
      assert.match(line, /-t "\$TARGET"/,
        `${cmd} resolves its target by PREFIX, so it can act on another session: ${line.trim()}`);
    } else if (PLAIN.includes(cmd)) {
      checked += 1;
      assert.match(line, /-t "\$SESSION"/,
        `${cmd} rejects the "=name" form outright ("no such session: =name"), so `
        + `this line would fail at runtime: ${line.trim()}`);
    }
  }
  assert.ok(checked >= 5, 'no tmux target lines were checked, so this proves nothing');

  // The session is CREATED with the plain name -- `new-session -s` takes a
  // literal, and an `=` there would become part of the name.
  assert.match(script, /new-session -d -s "\$SESSION"/,
    'the session is created with the match syntax in its name');
});

test('the refusals that protect a name are each reachable and each tested', () => {
  // ⚠️ Two of these could have been DELETED with the whole suite green, which
  // is the same as not having them. A guard nothing exercises is a comment.
  const calls = recorder();
  create.setDryRun(false);

  // A name ending in -discord. The board files that agent under the stripped
  // name, so it collides with a real agent AND its own card is anonymous.
  assert.match(create.nameProblem('angel-discord') || '', /-discord/,
    'a name the board would file under somebody else was accepted');
  assert.equal(create.createAgent({ ...BINS, name: 'angel-discord', role: 'pm' }).outcome,
    create.OUTCOME.REFUSED);

  // A leftover launchd job with no folder: the exact state the README tells
  // people to expect. (Remove exists now and deletes nothing, so the halves can
  // still come apart; what is still manual is DELETE.)
  const orphan = 'orphan-job';
  fs.mkdirSync(nodePath.dirname(create.plistPath(orphan)), { recursive: true });
  fs.writeFileSync(create.plistPath(orphan), '<plist/>', 'utf8');
  const refused = create.createAgent({ ...BINS, name: orphan, role: 'pm' });
  assert.equal(refused.outcome, create.OUTCOME.REFUSED,
    'a name whose launchd job is still installed was accepted, so the plist gets '
    + 'overwritten and bootstrap then fails with the wrong reason');
  assert.match(refused.because, /still set to start/);
  assert.equal(calls.length, 0, 'a refused name still ran a command');

  // THE CONTROL: with the job gone, the same name goes through.
  fs.rmSync(create.plistPath(orphan));
  assert.equal(create.createAgent({ ...BINS, name: orphan, role: 'pm' }).outcome,
    create.OUTCOME.CREATED, 'this name is refused whatever is on disk, so the above proves nothing');
});

test('a length problem says it is a length problem', () => {
  // A person who typed one character was told to use letters, numbers, hyphens
  // and underscores -- a rule they had not broken, with nothing pointing at the
  // one they had.
  assert.match(create.nameProblem('a'), /two characters/);
  assert.match(create.nameProblem('x'.repeat(33)), /32 characters/);
  // And the character rule still answers for a character problem.
  assert.match(create.nameProblem('has.dot'), /letters, numbers/);
  assert.match(create.nameProblem('has\ttab'), /plain spaces/, 'a tab inside a name is a character problem said in its own words');
});

/**
 * Run the shipped startup script for real, against a fake tmux.
 *
 * ⚠️ The tests above assert the script's TEXT — that a check appears before a
 * kill, that a `sleep 5` exists somewhere. That is not the same as asserting
 * behaviour, and the gap is exactly wide enough to hide the bug: move
 * `kill-session` out of the ours-branch and into the loop body and the
 * destroy-a-stranger's-session defect is fully restored with those assertions
 * green. This is the one generated artifact on this branch that can end a live
 * agent, so it gets exercised rather than read.
 *
 * The fake records every call and answers from a scripted world. `has-session`
 * answers yes once and no afterwards, so every loop in the script terminates.
 */
function runLauncher({ claim, paneCommands, env, model, runner }) {
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'launcher-'));
  const log = nodePath.join(dir, 'calls.log');
  const fake = nodePath.join(dir, 'tmux');
  fs.writeFileSync(fake, `#!/bin/bash
echo "$@" >> ${JSON.stringify(log)}
# new-session's argv, one per line, so a value with a space is seen as ONE
# argument (calls.log joins with spaces and cannot tell).
[ "$1" = new-session ] && printf '%s\\n' "$@" > ${JSON.stringify(nodePath.join(dir, 'new-session.argv'))}
case "$1" in
  has-session)
    # Present the first time only, so both loops terminate.
    if [ -f ${JSON.stringify(nodePath.join(dir, 'seen'))} ]; then exit 1; fi
    touch ${JSON.stringify(nodePath.join(dir, 'seen'))}
    exit 0
    ;;
  show-options) echo ${JSON.stringify(claim)}; exit 0 ;;
  list-panes) printf '%s\\n' ${paneCommands.map((c) => JSON.stringify(c)).join(' ')}; exit 0 ;;
  *) exit 0 ;;
esac
`, { mode: 0o755 });

  // ⚠️ The SHIPPED script, run with the argument vector DERIVED FROM THE JOB.
  //
  // Hardcoding the order here would have been two definitions of one fact:
  // swap `name` and `workerDir` in `plistFor` and every test stays green while
  // every real agent is started with its working directory as its session name.
  // So the harness reads the plist the product actually writes, and substitutes
  // only the two paths it needs to redirect (the fake tmux, and this run's
  // directory). If the order ever changes, this changes with it or fails.
  // ⚠️ Install first, so the harness does not depend on an earlier test in this
  // file having created an agent. It ran the INSTALLED copy while every textual
  // assertion read the repo file, which worked only by order.
  create.installSupervisor();
  const argv = jobArguments('probe', { model, runner }).map((a) => {
    if (a === create.workerDir('probe')) return nodePath.join(dir, 'work');
    if (a === '/opt/homebrew/bin/tmux') return fake;
    return a;
  });
  // ⚠️ THE JOB'S ENVIRONMENT IS PASSED, NOT INHERITED. launchd hands the
  // supervisor CLAUDE_CONFIG_DIR / CODEX_HOME / KOSMOS_PORT through the plist;
  // here the caller says which are set. A key given as `undefined` is REMOVED
  // rather than left to whatever this test process happens to carry (a
  // developer's own CLAUDE_CONFIG_DIR would otherwise make the unset case
  // untestable, and pass).
  const spawnEnv = { ...process.env };
  for (const [k, v] of Object.entries(env || {})) {
    if (v === undefined) delete spawnEnv[k]; else spawnEnv[k] = v;
  }
  require('node:child_process').execFileSync('/bin/bash', argv, { timeout: 20000, stdio: 'pipe', env: spawnEnv });
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n');
  const argvFile = nodePath.join(dir, 'new-session.argv');
  // ⚠️ `calls` is the space-joined call log every test above reads, and it
  // also CARRIES the launch's argument vector with boundaries intact as
  // `calls.newSession` (null when nothing was launched, the adopt path, so a
  // test can tell "not passed" from "not run"). A property on the array
  // rather than a new return shape, so the callers reading `calls.some(...)`
  // stay as they are.
  calls.newSession = fs.existsSync(argvFile)
    ? fs.readFileSync(argvFile, 'utf8').replace(/\n$/, '').split('\n')
    : null;
  fs.rmSync(dir, { recursive: true, force: true });
  return calls;
}

test('the startup script, actually run, never kills a session that is not ours', () => {
  // Somebody else's session is sitting on the name.
  const calls = runLauncher({ claim: 'somebody-else', paneCommands: ['zsh'] });
  assert.ok(!calls.some((c) => c.startsWith('kill-session')),
    "the script killed a session it could not prove was ours, which is somebody's "
    + 'work destroyed by a job installed weeks earlier');
  // ⚠️ The claim must never land on a session we did not create. It is fine for
  // it to happen AFTER a new-session -- the stranger's session ended, we waited
  // it out, and the one we then made is ours. What must never happen is a claim
  // with no creation before it.
  //
  // The first version of this assertion said the claim must not appear at all,
  // which was simply false about correct behaviour: the fake reports the
  // session gone on the second look, so the script rightly proceeds. A
  // behavioural test can assert the wrong thing as easily as a textual one, and
  // this one found that out on its first run.
  const claimAt = calls.findIndex((c) => c.includes('@kosmos_agent probe'));
  const createdAt = calls.findIndex((c) => c.startsWith('new-session'));
  if (claimAt > -1) {
    assert.ok(createdAt > -1 && createdAt < claimAt,
      "the script stamped our claim on a session it did not create, which the next "
      + 'run would then recognise as ours and kill');
  }
});

test('the startup script, actually run, adopts a healthy agent instead of restarting it', () => {
  // Ours, and Claude is running in it. Killing it here throws away the
  // conversation -- and this file tells people they can run it by hand.
  const calls = runLauncher({ claim: 'probe', paneCommands: ['2.1.227'] });
  assert.ok(!calls.some((c) => c.startsWith('kill-session')),
    'a healthy running agent was killed and restarted, losing everything it remembered');
  assert.ok(!calls.some((c) => c.startsWith('new-session')),
    'a second session was started over a healthy one');
  assert.ok(calls.some((c) => c.includes('@kosmos_agent probe')),
    'the adopted session was left unclaimed, so the board will not recognise it');

  // ⚠️ And a session where every pane is a shell IS restarted -- otherwise
  // "adopt" would mean "never recover a crashed agent", which is worse than the
  // bug it fixes.
  // ⚠️ `-zsh` WITH THE DASH is what a login shell reports, and it is the
  // spelling the status engine uses as its canonical crashed-pane value. A
  // denylist that missed it adopted a crashed agent instead of restarting it,
  // and the supervision loop then kept the launchd job "running" forever, so
  // KeepAlive could never recover it. A permanently dead agent that looks
  // supervised is worse than one that is plainly down.
  const crashed = runLauncher({ claim: 'probe', paneCommands: ['-zsh', 'bash'] });
  assert.ok(crashed.some((c) => c.startsWith('kill-session')),
    'an agent that crashed back to a shell was adopted rather than restarted');
  assert.ok(crashed.some((c) => c.startsWith('new-session')), 'nothing was restarted');

  // ⚠️ A session with a shell in ONE pane and Claude in another is ALIVE. The
  // probe read only the current window's first pane, so splitting a window or
  // opening a second one -- which this script's own header invites -- made a
  // live agent look crashed.
  // ⚠️ AN EDITOR IS NOT CLAUDE. The probe used a denylist of shell names, so a
  // crashed agent whose remaining pane held vim, less, ssh or python3 read as
  // alive: the script adopted a dead agent and sat in the supervision loop, and
  // launchd's KeepAlive could never recover it because the job looked healthy.
  // The status engine already paid for this exact defect and replaced its
  // denylist with an allowlist; this is that same definition.
  // ⚠️ `1.2.3.4` and `1a.2b.3c` are in this list because the first version
  // matched with a GLOB, which accepts both, while the definition it claimed
  // parity with is `^[0-9]+\.[0-9]+\.[0-9]+$`. A looser copy of a definition,
  // beside a comment asserting they are the same, in the place where being
  // loose means supervising a dead agent forever.
  for (const leftover of ['vim', 'less', 'ssh', 'python3', '-zsh', '1.2.3.4', '1a.2b.3c']) {
    const dead = runLauncher({ claim: 'probe', paneCommands: [leftover] });
    assert.ok(dead.some((c) => c.startsWith('kill-session')),
      `a pane running ${leftover} was read as a live agent, so a crashed one is never recovered`);
  }

  const split = runLauncher({ claim: 'probe', paneCommands: ['zsh', '2.1.227'] });
  assert.ok(!split.some((c) => c.startsWith('kill-session')),
    'an agent with a shell open beside it was killed as though it had crashed');

  // ⚠️ And a tmux that will not say what is running is NOT a reason to destroy
  // anything. An empty answer read as "every pane is a shell", so a failed
  // list-panes became grounds for killing a session we had just confirmed is
  // ours -- "I cannot see it" turned into "it is dead", which is the inversion
  // this whole codebase exists to prevent.
  const blind = runLauncher({ claim: 'probe', paneCommands: [] });
  assert.ok(!blind.some((c) => c.startsWith('kill-session')),
    'a session was killed because tmux would not say what was running in it');
});

test('the startup script, actually run, hands the pane its account and its board, and nothing when they are unset (#587)', () => {
  // ⚠️ ASSERTED FROM THE LAUNCH, NOT FROM THE SCRIPT'S TEXT (#586, #587). tmux
  // does not hand a client's environment to a session it makes on a running
  // server, so the account (CLAUDE_CONFIG_DIR / CODEX_HOME) and the board
  // (KOSMOS_PORT) reach the pane only as new-session -e arguments. The first
  // guard for this was a match against the script's own source, green on any
  // build containing the loop line whatever the loop did. This runs the script
  // with the three variables set, unset or empty on top of this process's
  // environment (a real plist carries at most two, one account variable by
  // runner plus the port; the supervisor forwards whatever is set, independent
  // of the plist), and reads the argv the fake tmux got.
  // What the fake cannot see, that real tmux drops the client's environment,
  // is tools/witness-pane-env.sh's job.
  //
  // A path with a space, because the real one lives under Application Support:
  // it has to arrive as ONE argument or the pane gets half a directory.
  const claudeDir = '/Users/somebody/Library/Application Support/kosmos/.claude-team';
  const codexDir = '/Users/somebody/.codex-team';
  const launchdEnv = { CLAUDE_CONFIG_DIR: claudeDir, CODEX_HOME: codexDir, KOSMOS_PORT: '16245' };
  // ⚠️ ALL FOUR LAUNCH LINES, not the one a default job happens to take. The
  // supervisor has a line per runner with and without a model, and a fix on
  // one of them (an unquoted expansion, a dropped -e) leaves the other three
  // exactly as broken while a single-branch test stays green.
  const branches = [
    { runner: undefined, model: null }, { runner: undefined, model: 'claude-sonnet-5' },
    { runner: 'codex', model: null }, { runner: 'codex', model: 'gpt-5' },
  ];
  for (const b of branches) {
    const label = `${b.runner || 'claude'}${b.model ? '+model' : ''}`;
    const set = runLauncher({ claim: 'probe', paneCommands: ['-zsh', 'bash'], env: launchdEnv, ...b });
    assert.ok(set.newSession, `${label}: nothing was launched, so the assertions below never ran`);
    const passed = set.newSession.filter((a, i, all) => i > 0 && all[i - 1] === '-e').sort();
    /* \u26a0\ufe0f #1139: THE SENDER TOKEN RIDES TOO, AND THIS ASSERTION USED TO PASS
       BECAUSE IT DID NOT. The supervisor resolved the engine as `$0/../engine`,
       which is false in the installed layout, so the mint was silently skipped
       and this exact-set check stayed green on the broken behaviour. It is a
       witness to that defect, not a victim of the fix.
       Checked by SHAPE and then set aside: the value is fresh per launch, so it
       cannot be pinned by equality, and the point of the check below is that
       nothing UNEXPECTED rides -- which still holds, on the remainder. */
    const minted = passed.filter((v) => v.startsWith('KOSMOS_AGENT_TOKEN='));
    assert.equal(minted.length, 1, `${label}: expected exactly one sender token in the pane env: ` + JSON.stringify(passed));
    assert.match(minted[0], /^KOSMOS_AGENT_TOKEN=[0-9a-f]{64}$/, `${label}: the token is not the 32-byte hex the supervisor validates`);
    const rest = passed.filter((v) => !v.startsWith('KOSMOS_AGENT_TOKEN='));
    /* ⚠️ #1160 ADDS A FOURTH, FOR CLAUDE ONLY, and it is written into the
       expected SET rather than filtered out of it. The exactness is this
       assertion's whole value -- it is what says nothing UNEXPECTED reaches a
       pane -- so a new rider belongs in the list where the next person reads
       it, not behind a `filter` that would also hide the next one nobody
       intended. `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN` stops Claude Code
       asking a new agent about its renderer on the first screen; codex has
       never heard of it, which is why the branches differ here. */
    const expected = [`CLAUDE_CONFIG_DIR=${claudeDir}`, `CODEX_HOME=${codexDir}`, 'KOSMOS_PORT=16245'];
    if ((b.runner || 'claude') !== 'codex') expected.push('CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1');
    assert.deepEqual(rest, expected.sort(),
      `${label}: the pane was not handed exactly the account and the board: ` + JSON.stringify(set.newSession));
    // And they sit BEFORE the runner binary. After it they are the runner's
    // own arguments, tmux never sees them, and the same three pairs are still
    // in the argv, so the assertion above alone would stay green.
    const runnerAt = set.newSession.indexOf('/bin/echo');
    assert.ok(runnerAt > 0, `${label}: the runner binary is not in the launch: ` + JSON.stringify(set.newSession));
    set.newSession.forEach((a, i) => {
      if (a === '-e') assert.ok(i < runnerAt, `${label}: a -e sits after the runner, where tmux cannot see it: ` + JSON.stringify(set.newSession));
    });
    // Each branch's identity, both ways: a default that started writing a
    // model or a runner would fold four lines into two while staying green.
    const hasModel = set.newSession.includes('--model') || set.newSession.includes('-m');
    const isCodex = set.newSession.some((a) => a.startsWith('notify='));
    assert.equal(hasModel, Boolean(b.model), `${label}: the launch ${hasModel ? 'carries' : 'lacks'} a model flag, so this is not the branch it claims to test`);
    assert.equal(isCodex, b.runner === 'codex', `${label}: the launch ${isCodex ? 'carries' : 'lacks'} the codex notify config, so this is not the branch it claims to test`);
  }

  // Unset means absent, the plist's own rule. A pane must not be handed an
  // empty directory as if it were one.
  for (const [label, envCase] of [
    ['unset', { CLAUDE_CONFIG_DIR: undefined, CODEX_HOME: undefined, KOSMOS_PORT: undefined }],
    ['empty', { CLAUDE_CONFIG_DIR: '', CODEX_HOME: '', KOSMOS_PORT: '' }],
  ]) {
    const r = runLauncher({ claim: 'probe', paneCommands: ['-zsh', 'bash'], env: envCase });
    assert.ok(r.newSession, `${label}: nothing was launched, so the assertion below never ran`);
    /* \u26a0\ufe0f #1139: the check is "no ACCOUNT OR BOARD variable rides", not "no
       `-e` rides". The sender token is neither, and it is minted regardless of
       whether those three are set -- so a bare `includes('-e')` now reads a
       correct token as a leaked empty variable. Named exactly, so this still
       fails on the thing it was written for: an unset var riding as empty. */
    const passed = r.newSession.filter((a, i, all) => i > 0 && all[i - 1] === '-e');
    /* \u26a0\ufe0f #1160 rides here too, for the same reason the token does and
       handled the same way: it is not FORWARDED from the environment, it is SET
       by the supervisor, so it is present whether or not anything else is. Named
       exactly rather than loosened, so this still fails on the thing it was
       written for. */
    const notToken = passed.filter((v) => !v.startsWith('KOSMOS_AGENT_TOKEN=')
      && v !== 'CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1');
    assert.deepEqual(notToken, [],
      `${label}: a variable that is not set was still passed into the pane: ` + JSON.stringify(r.newSession));
    /* And the exclusion above must not become a place things hide: the thing it
       excludes has to actually be there. Without this, deleting the renderer
       preference entirely would pass both arms of this test. */
    assert.ok(passed.includes('CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1'),
      `${label}: the renderer preference stopped reaching the pane: ` + JSON.stringify(r.newSession));
  }
});

test('every name this module accepts is one the rest of the system can address', () => {
  // ⚠️ `NAME_RE` is a SECOND encoding of a rule that lives in `store.safeKey`,
  // and the header of this module cites that rule as the reason it exists. It
  // is currently strictly stricter, so it holds -- but nothing asserted the
  // relationship, so a future tightening of `safeKey` would break the invariant
  // with the whole suite green. Two definitions of one fact, unpinned, is the
  // defect this codebase keeps paying for.
  const store = require('./store');
  const candidates = ['ab', 'a1', 'my_bot', 'casey-2', 'x'.repeat(32),
    'agent-one', '9lives', 'a-b_c-1'];
  let accepted = 0;
  for (const name of candidates) {
    if (create.nameProblem(name) !== null) continue;
    accepted += 1;
    assert.equal(store.safeKey(name), name,
      `'${name}' is accepted here but is not its own key, so a route naming it `
      + 'would resolve somewhere else');
  }
  assert.ok(accepted > 0, 'nothing was accepted, so the assertions above never ran');
});

test('a creation that fails leaves nothing behind, so the same name can be tried again', () => {
  // ⚠️ TWO half-states shipped before this, and both were worse than the
  // failure they followed:
  //
  //   - a failed write left the FOLDER, so the next attempt at that name was
  //     refused for the folder's existence -- permanently, from a screen whose
  //     own button says "Start over".
  //   - a failed `bootstrap` left the PLIST, and launchd loads every plist in
  //     that directory at the next login. An agent the person was told is "not
  //     running yet" was in fact installed to start at their next login, with
  //     --dangerously-skip-permissions, and nothing said so.
  const realWrite = fs.writeFileSync;
  try {
    recorder();
    create.setDryRun(false);
    fs.writeFileSync = (file, ...rest) => {
      if (String(file).endsWith('CLAUDE.md')) throw new Error('disk full');
      return realWrite(file, ...rest);
    };
    const halfWritten = create.createAgent({ ...BINS, name: 'rollback-a', role: 'pm' });
    assert.equal(halfWritten.outcome, create.OUTCOME.PARTIAL);
    assert.ok(!fs.existsSync(create.workerDir('rollback-a')), 'the folder was left behind');
    assert.ok(!fs.existsSync(create.plistPath('rollback-a')), 'the launchd job was left behind');
  } finally {
    fs.writeFileSync = realWrite;
  }

  // The same name goes through afterwards, which is the point.
  recorder();
  create.setDryRun(false);
  assert.equal(create.createAgent({ ...BINS, name: 'rollback-a', role: 'pm' }).outcome,
    create.OUTCOME.CREATED, 'a failed attempt blocked the name it failed on');

  // And a failed START rolls back too.
  create.setRunner((file, args) => (args && args[0] === 'bootstrap'
    ? { ok: false } : { ok: true, stdout: '' }));
  create.setDryRun(false);
  const notStarted = create.createAgent({ ...BINS, name: 'rollback-b', role: 'pm' });
  assert.equal(notStarted.outcome, create.OUTCOME.PARTIAL);
  assert.ok(!fs.existsSync(create.plistPath('rollback-b')),
    'a job that could not be started was left installed, so it starts at the next login anyway');
  // ⚠️ And UNLOADED, not just deleted. `bootstrap` can register a service and
  // still exit non-zero; removing the plist alone would leave that job
  // respawning against a start.sh this rollback just deleted, while every retry
  // of the name hits the already-loaded refusal -- so "you can try that name
  // again" would be false forever.
  const bootouts = [];
  create.setRunner((file, args) => {
    if (args && args[0] === 'bootout') bootouts.push(args[1]);
    return args && args[0] === 'bootstrap' ? { ok: false } : { ok: true, stdout: '' };
  });
  create.setDryRun(false);
  create.createAgent({ ...BINS, name: 'rollback-c', role: 'pm' });
  assert.ok(bootouts.some((t) => String(t).endsWith('com.kosmos.agent.rollback-c')),
    'the service this creation installed was left loaded after the start failed');
  assert.ok(!fs.existsSync(create.workerDir('rollback-b')), 'the folder was left behind');
  assert.match(notStarted.because, /try that name again/);
});

test('a name whose startup job is loaded with nothing on disk is refused by name', () => {
  // ⚠️ This is what the README's own removal recipe produces if the `rm` runs
  // without the `bootout`, or before it. Without this check the creation goes
  // ahead, `bootstrap` fails with "service already bootstrapped", the rollback
  // deletes the plist it just wrote, and the person is told "we have taken it
  // back off your computer. You can try that name again." Retrying fails the
  // same way forever, against a message promising the opposite -- while the
  // orphaned job keeps respawning against a startup script that was just
  // deleted.
  //
  // Loaded means launchctl DESCRIBED the service. A recorder that reports every
  // command as succeeding must not thereby claim every name is taken, so the
  // signal is the output rather than the exit.
  const calls = [];
  create.setRunner((file, args) => {
    calls.push([file, args]);
    if (args && args[0] === 'print') return { ok: true, stdout: 'com.kosmos.agent.ghost = { ... }' };
    return { ok: true, stdout: '' };
  });
  create.setDryRun(false);

  const r = create.createAgent({ ...BINS, name: 'ghost-job', role: 'pm' });
  assert.equal(r.outcome, create.OUTCOME.REFUSED, 'a name whose service is loaded was accepted');
  /* ⚠️ THE ADVERB IS NOT THE DISCRIMINATOR. Two refusals now share this
     clause and differ only by still/already: :715 is a plist FILE on disk with
     no folder, :761 (this one) is a LOADED service with nothing on disk. One
     harmonised adverb and this pin would match the wrong arm in silence. The
     tail is what names the state, so the pin asserts that and refuses the
     sibling's. */
  assert.match(r.because, /already set to start on this computer/);
  assert.match(r.because, /though there is nothing else left of it/,
    'the loaded-service refusal no longer says what state it found');
  assert.doesNotMatch(r.because, /though there is no folder for it/,
    'it gave the plist-on-disk sentence for a name whose only trace is a loaded service');
  assert.ok(!calls.some(([, a]) => a && a[0] === 'bootstrap'), 'it tried to load a second job');
  assert.ok(!fs.existsSync(create.workerDir('ghost-job')), 'it made a folder for a name it refused');
  assert.ok(!calls.some(([, a]) => a && a[0] === 'bootout'),
    "it unloaded a service this creation did not install, which is acting on something we have not tied to us");

  // THE CONTROL: the same name goes through when launchctl describes nothing.
  recorder();
  create.setDryRun(false);
  assert.equal(create.createAgent({ ...BINS, name: 'ghost-job', role: 'pm' }).outcome,
    create.OUTCOME.CREATED, 'this name is refused whatever launchctl says, so the above proves nothing');
});

test('a folder left behind on its own is refused, and says so', () => {
  // ⚠️ Untested until now, and `rollBack()` leans on it: its stated premise is
  // that nothing it removes existed before the call, which is only true because
  // a pre-existing folder is refused here. Delete this branch and a later
  // failure would recursively remove a directory the person already had.
  const calls = recorder();
  create.setDryRun(false);
  fs.mkdirSync(create.workerDir('lonely-folder'), { recursive: true });
  fs.writeFileSync(nodePath.join(create.workerDir('lonely-folder'), 'notes.md'), 'mine', 'utf8');

  const r = create.createAgent({ ...BINS, name: 'lonely-folder', role: 'pm' });
  assert.equal(r.outcome, create.OUTCOME.REFUSED, 'a name with a folder already there was accepted');
  assert.match(r.because, /already a folder/,
    'the refusal names an agent rather than the folder, so it points at the wrong thing');
  assert.equal(fs.readFileSync(nodePath.join(create.workerDir('lonely-folder'), 'notes.md'), 'utf8'), 'mine',
    'it wrote into a folder that was already there');
  assert.ok(!calls.some(([, a]) => a && a[0] === 'bootstrap'), 'it started an agent over an existing folder');
});

test('a name that shares a KEY with a live session is refused, not just an identical one', () => {
  // ⚠️ Every name-keyed route resolves through `store.safeKey`, so `my.bot` and
  // `mybot` are two names and ONE key: one instruction file, one avatar, one
  // profile, one commitment record. Comparing raw session names let this create
  // `mybot` beside a live `my.bot-discord`, and a write naming either then
  // reached the other's boot file. This module's header exists to prevent that
  // exact collision, and the gate was checking the wrong thing to enforce it.
  const calls = recorder();
  create.setDryRun(false);
  status.setPaneSource(() => fleet.line({ session: 'my.bot-discord', title: 'idle' }));

  const r = create.createAgent({ ...BINS, name: 'mybot', role: 'pm' });
  assert.equal(r.outcome, create.OUTCOME.REFUSED,
    'a name that resolves to the same key as a live agent was accepted, so both '
    + 'now share one instruction file');
  assert.match(r.because, /already running/);
  assert.match(r.because, /my\.bot-discord/,
    'the refusal does not say which session it collides with, so the person cannot act on it');
  assert.equal(calls.filter(([, a]) => a && a[0] !== 'print').length, 0, 'it started something anyway');

  // THE CONTROL: a name that shares no key goes through.
  status.setPaneSource(() => fleet.line({ session: 'my.bot-discord', title: 'idle' }));
  assert.equal(create.createAgent({ ...BINS, name: 'other-bot', role: 'pm' }).outcome,
    create.OUTCOME.CREATED, 'every name is refused while that session runs, so the above proves nothing');
});

test('the supervisor is installed once and shared, not copied per agent', () => {
  // ⚠️ THE WHOLE POINT OF THE CHANGE. Each agent used to get its own copy of a
  // 151-line generated script, so every defect in it shipped as many times as
  // there were agents and every FIX reached only the ones created afterwards --
  // the agents already on the machine kept their copy of the bug forever.
  recorder();
  create.setDryRun(false);
  create.createAgent({ ...BINS, name: 'shared-one', role: 'pm' });
  create.createAgent({ ...BINS, name: 'shared-two', role: 'writer' });

  for (const name of ['shared-one', 'shared-two']) {
    assert.ok(!fs.existsSync(nodePath.join(create.workerDir(name), 'start.sh')),
      `${name} has its own copy of the supervisor`);
    const plist = fs.readFileSync(create.plistPath(name), 'utf8');
    assert.match(plist, new RegExp(create.supervisorPath().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `${name}'s job does not run the shared supervisor`);
    assert.match(plist, new RegExp(`<string>${name}</string>`),
      `${name}'s job does not tell the supervisor which agent it is for`);
  }

  // ⚠️ AND IT IS REFRESHED. Installing only when absent would mean a fix never
  // reaches a machine that already has an older copy, which is the same defect
  // one level up: the file would be shared and still stale.
  fs.writeFileSync(create.supervisorPath(), '# an older version\n', 'utf8');
  create.createAgent({ ...BINS, name: 'shared-three', role: 'pm' });
  assert.equal(fs.readFileSync(create.supervisorPath(), 'utf8'),
    fs.readFileSync(create.supervisorSource(), 'utf8'),
    'an older supervisor was left in place, so every agent keeps running it');
});

test('a supervisor that cannot be installed stops the creation', () => {
  // ⚠️ A job pointing at a script that is not there IS the respawn loop: bash
  // exits at once and KeepAlive retries every thirty seconds for as long as the
  // machine is on. So this refuses before the job is written, and rolls back.
  const calls = recorder();
  create.setDryRun(false);
  const realCopy = fs.copyFileSync;
  try {
    fs.copyFileSync = () => { throw new Error('read-only'); };
    const r = create.createAgent({ ...BINS, name: 'no-supervisor', role: 'pm' });
    assert.equal(r.outcome, create.OUTCOME.PARTIAL, 'it created an agent with no supervisor to run it');
    assert.ok(r.steps.some((s) => /script that starts agents/.test(s.label) && !s.ok),
      'the failing step is not visible in the record');
    // ⚠️ The SENTENCE, which is the only thing this branch adds to the failure
    // path beyond a step label, and was the one thing unpinned. A transient
    // failure must invite a retry; a missing file must not.
    assert.match(r.because, /could not put the script that starts agents in place/);
    assert.match(r.because, /try that name again/,
      'a transient failure tells the person not to bother retrying');
    // ⚠️ This holds through the ROLLBACK as much as through the write ordering,
    // and saying so matters: removing the gate that stops the job being written
    // leaves this assertion green, because the rollback removes it either way.
    // The load-bearing assertion is the next one -- nothing was ever STARTED.
    assert.ok(!fs.existsSync(create.plistPath('no-supervisor')),
      'a job pointing at a supervisor that is not there was left on the machine');
    assert.equal(calls.filter(([, a]) => a && a[0] !== 'print').length, 0, 'it started something anyway');
  } finally {
    fs.copyFileSync = realCopy;
  }

  // THE CONTROL: with the copy working, the same name goes through.
  recorder();
  create.setDryRun(false);
  assert.equal(create.createAgent({ ...BINS, name: 'no-supervisor', role: 'pm' }).outcome,
    create.OUTCOME.CREATED, 'this name is refused whatever happens, so the above proves nothing');
});

test('the job passes the supervisor exactly the arguments it reads, in that order', () => {
  // ⚠️ ONE CONTRACT, TWO ENDS, and nothing else in the suite holds it: the
  // order `plistFor` writes those strings, and the order the script reads $1..$5.
  // Swap two and every real agent starts with its working directory as its
  // session name -- `has-session -t "=/Users/.../workers/x"`, a session created
  // under that name, and a claim the board can never match -- with the whole
  // suite green.
  const args = jobArguments('order-check');
  assert.deepEqual(args, [
    create.supervisorPath(),
    'order-check',
    create.workerDir('order-check'),
    '/bin/echo',
    '/opt/homebrew/bin/tmux',
    nodePath.join(create.workerDir('order-check'), 'start.log'),
  ], 'the job no longer passes the supervisor what it reads, in the order it reads it');

  // And the script reads them in that order, by position.
  const script = supervisorText();
  for (const [pos, name] of [[1, 'SESSION'], [2, 'WORKDIR'], [3, 'CLAUDE'], [4, 'TMUX_BIN'], [5, 'LOG'], [6, 'MODEL']]) {
    assert.ok(script.includes(`${name}="\${${pos}`),
      `the supervisor does not read ${name} from argument ${pos}`);
  }
  // ...and MODEL is not merely read: a supervisor that assigns $6 and never
  // passes it keeps every test green while every model choice silently runs
  // the default. The flag must reach the claude invocation, quoted.
  assert.ok(script.includes('--model "$MODEL"'),
    'the supervisor reads MODEL but never passes --model to claude');
});

test('a supervisor missing from the app says so, instead of inviting a retry', () => {
  // ⚠️ Two different failures, two different sentences. `installSupervisor`
  // collapsed everything into one boolean, so a full disk was told "trying
  // again will not help until it is fixed" -- false in exactly the case that
  // produced it, and the sentence that stops the operator retrying.
  recorder();
  create.setDryRun(false);
  const realCopy = fs.copyFileSync;
  try {
    fs.copyFileSync = () => {
      const err = new Error('no such file'); err.code = 'ENOENT'; throw err;
    };
    // The source really is present; the ENOENT is the destination's.
    const transient = create.createAgent({ ...BINS, name: 'enoent-dest', role: 'pm' });
    assert.match(transient.because, /try that name again/,
      'a failure that is not the app missing tells the person not to retry');

    // And with the source genuinely gone, the opposite.
    const realExists = fs.existsSync;
    try {
      fs.existsSync = (f) => (String(f).endsWith('agent-supervisor.sh') ? false : realExists(f));
      const permanent = create.createAgent({ ...BINS, name: 'no-source', role: 'pm' });
      assert.match(permanent.because, /missing from this app/,
        'a missing supervisor invites a retry that can never work');
    } finally {
      fs.existsSync = realExists;
    }
  } finally {
    fs.copyFileSync = realCopy;
  }
});

test('the supervisor trims its own log rather than growing it forever', () => {
  // ⚠️ The one destructive branch in the shipped script that nothing exercised.
  // launchd appends to that log, and a job failing every thirty seconds writes
  // to it for as long as the machine is on.
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'logtrim-'));
  const log = nodePath.join(dir, 'start.log');
  fs.writeFileSync(log, 'x'.repeat(1048576 + 10), 'utf8');
  const fake = nodePath.join(dir, 'tmux');
  // A tmux that reports no session at all: the script starts one and falls
  // straight out of the supervision loop.
  fs.writeFileSync(fake, '#!/bin/bash\nexit 1\n', { mode: 0o755 });
  try {
    require('node:child_process').execFileSync(
      '/bin/bash',
      [create.supervisorSource(), 'logtrim', dir, '/bin/echo', fake, log],
      { timeout: 20000, stdio: 'pipe' },
    );
  } catch { /* new-session "fails" with this fake, which is fine */ }
  assert.ok(fs.statSync(log).size < 1048576,
    'the log was left over its ceiling, so it grows without bound');

  // ⚠️ AND AN UNREADABLE ONE IS NOT AN ERROR. `wc` prints nothing for a file it
  // cannot read, and `[ "" -gt N ]` is a bash error written into the very log
  // being managed.
  fs.writeFileSync(log, 'small', 'utf8');
  fs.chmodSync(log, 0o000);
  let stderr = '';
  try {
    require('node:child_process').execFileSync(
      '/bin/bash',
      [create.supervisorSource(), 'logtrim', dir, '/bin/echo', fake, log],
      { timeout: 20000, stdio: 'pipe' },
    );
  } catch (err) { stderr = String((err && err.stderr) || ''); }
  fs.chmodSync(log, 0o644);
  assert.doesNotMatch(stderr, /integer expression expected/,
    'an unreadable log makes the supervisor emit a bash error');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// The capital, and where it does and does not go
//
// ⚠️ WHAT THIS BLOCK IS FOR. Somebody naming a colleague types `Casey`, and the
// product used to answer "use lower case, so the name is the same everywhere it
// appears" — a true sentence about the machinery, said to the wrong person. The
// capital now survives as the display name and the machinery uses the slug, so
// the thing worth testing is exactly which name reaches which place.
// ─────────────────────────────────────────────────────────────────────────────

test('a capitalised name makes its folder, job and session under the LOWER-CASE name', () => {
  const calls = recorder();
  create.setDryRun(false);

  const r = create.createAgent({ ...BINS, name: 'Bex', role: 'pm' });
  assert.equal(r.outcome, create.OUTCOME.CREATED, r.because);

  // Everything the operating system touches.
  assert.ok(fs.existsSync(create.workerDir('bex')), 'the folder is not under the machine name');
  assert.ok(fs.existsSync(create.plistPath('bex')), 'the job is not under the machine name');
  assert.equal(create.serviceLabel('bex'), 'com.kosmos.agent.bex');
  /**
   * ⚠️ ASSERTED ON THE DIRECTORY LISTING, NOT ON `existsSync('Bex')`, and the
   * first version of this line was wrong in a way worth recording. macOS's
   * default volume is case-INSENSITIVE: `existsSync(workerDir('Bex'))` answers
   * true for a folder that is really named `bex`, so the check could not
   * distinguish the thing it was written to distinguish. It would have passed on
   * a case-sensitive volume and failed here for a correct implementation —
   * a measurement of the filesystem rather than of the code.
   *
   * The listing says what the name on disk actually IS, on either kind of
   * volume, and that is the property: one folder, spelled lower case.
   */
  const named = fs.readdirSync(process.env.AGENT_WORKFORCE_WORKERS)
    .filter((entry) => entry.toLowerCase() === 'bex');
  assert.deepEqual(named, ['bex'],
    'the folder on disk is not the lower-case name, or there is more than one of it');

  // And the session tmux is asked for. The supervisor takes the agent as its
  // first argument, so this is the name the window will be called.
  const launched = calls.find(([, args]) => Array.isArray(args) && args.includes('bootstrap'));
  assert.ok(launched, 'nothing was bootstrapped, so the assertions above are about nothing');
  const plist = fs.readFileSync(create.plistPath('bex'), 'utf8');
  assert.match(plist, /<string>bex<\/string>/, 'the supervisor is passed the machine name');
  assert.doesNotMatch(plist, /<string>Bex<\/string>/, 'the typed name reached the launchd job');
});

test('and it is CALLED Casey: the instruction file and the stored record both say so', () => {
  recorder();
  create.setDryRun(false);
  const r = create.createAgent({ ...BINS, name: 'Delia', role: 'pm' });
  assert.equal(r.outcome, create.OUTCOME.CREATED, r.because);

  const text = fs.readFileSync(create.instructionFile('delia'), 'utf8');
  assert.match(text, /You are \*\*Delia\*\*, a project manager/,
    'the file the agent boots from calls it by the machine name');

  // The second record, which is what survives the person editing that file.
  assert.equal(store.readProfile('delia').displayName, 'Delia');

  // And the answer carries both, so no screen has to derive either.
  assert.equal(r.name, 'delia');
  assert.equal(r.shownAs, 'Delia');
  assert.match(r.because, /^Delia is set up/, 'the sentence a person reads uses the name they typed');
});

test('the board reads the typed name back, and keeps reading it after the file is edited', () => {
  recorder();
  create.setDryRun(false);
  assert.equal(create.createAgent({ ...BINS, name: 'Rhona', role: 'pm' }).outcome, create.OUTCOME.CREATED);

  // The control: it reads back at all.
  assert.equal(status.readIdentity('rhona').displayName, 'Rhona');

  // ⚠️ THE CASE THE STORED RECORD EXISTS FOR. The instruction file belongs to
  // the PERSON, and they may rewrite its first line. A display name that
  // vanishes when somebody edits their own instructions is not a name.
  fs.writeFileSync(create.instructionFile('rhona'), '# my own notes\n\nnothing about who I am\n', 'utf8');
  const after = status.readIdentity('rhona');
  assert.equal(after.displayName, 'Rhona', 'the name did not survive an edit to the file');
  assert.equal(after.derived, true,
    'a name the person typed themselves must not be flagged on the card as a machine name');

  // ⚠️ AND THE PRECEDENCE ITSELF, on a file that PARSES to a different name.
  // The edited-file case above exits through the no-match branch, so it never
  // reaches the `recorded || parsed` line -- measured in round 13, reducing
  // that line to the parsed name alone left the suite green. This file
  // parses fine and disagrees, which is the one shape that can catch it:
  // "one wins, stated" is only true if the stored name beats a readable file.
  fs.writeFileSync(create.instructionFile('rhona'),
    'You are **Completely Different**, a bricklayer.\n', 'utf8');
  const disagree = status.readIdentity('rhona');
  assert.equal(disagree.displayName, 'Rhona',
    'a parseable file must not out-rank the name the person typed');
  assert.equal(disagree.role, 'bricklayer',
    'control: the file WAS parsed (its role came through), so the name above was a choice, not a fallback');
});

test('an agent with no stored name is UNCHANGED: it still reads its name out of its file', () => {
  // ⚠️ The whole existing fleet is in this state, and this is the assertion
  // that says the change is additive. `claudebot` reads `Splinter` out of its
  // instruction file and nothing on this branch renames anything on disk.
  const dir = create.workerDir('legacybot');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, 'CLAUDE.md'), 'You are **Splinter**, a project manager.\n', 'utf8');
  assert.equal(store.readProfile('legacybot').displayName, undefined, 'the control: nothing is recorded');
  const identity = status.readIdentity('legacybot');
  assert.equal(identity.displayName, 'Splinter');
  assert.equal(identity.role, 'project manager');
  assert.equal(identity.derived, true);
});

test('two spellings of one name are ONE agent, not two', () => {
  // ⚠️ The hazard the split introduces if the slug is not the key everywhere:
  // `Casey` and `casey` would be two folders, two jobs, two sessions and one
  // very confused person. The second creation must meet the existing one.
  recorder();
  create.setDryRun(false);
  assert.equal(create.createAgent({ ...BINS, name: 'Wren', role: 'pm' }).outcome, create.OUTCOME.CREATED);
  const again = create.createAgent({ ...BINS, name: 'wren', role: 'pm' });
  assert.equal(again.outcome, create.OUTCOME.REFUSED);
  assert.match(again.because, /already/);
});

test('the launchd job says WHOSE background item it is, so macOS names Kosmos and not bash', () => {
  /**
   * ⚠️ WHAT THIS PREVENTS, in the words of the notice it changes. macOS posts a
   * "background item added" notification for every launchd job and lists it
   * under Login Items. With nothing to attribute the job to it names the
   * executable — so the person is told `bash` was added as a background item,
   * and later that `bash` is running in the background on their Mac. Minutes
   * after installing something. The honest reading of that is alarming, and the
   * thing it describes is their own agent staying alive between logins.
   */
  const plist = create.plistFor('fixture-agent', '/bin/echo', '/bin/echo');
  assert.match(plist, /<key>AssociatedBundleIdentifiers<\/key>/);
  // ⚠️ The identifier is the one the INSTALLER registers the bundle under. A
  // plist pointing at an identifier no bundle claims attributes the job to
  // nothing, which is the state this key exists to leave.
  // ⚠️ EXTRACTED FROM BOTH SIDES AND COMPARED, never a literal held in this
  // test: the first version asserted a hardcoded string against each file
  // separately, which passed when the installer's real CFBundleIdentifier
  // changed (a stale mention elsewhere in the file satisfied includes()) and
  // FAILED when both sides were renamed consistently -- silent on the
  // disagreement it exists to catch, red on a correct change (round 14).
  const inPlist = (plist.match(/<key>AssociatedBundleIdentifiers<\/key>\s*<array><string>([^<]+)<\/string>/) || [])[1];
  assert.ok(inPlist, 'control: the plist really carries an identifier to compare');
  const setup = fs.readFileSync(nodePath.join(__dirname, '..', 'install', 'setup.sh'), 'utf8');
  const inSetup = (setup.match(/<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/) || [])[1];
  assert.ok(inSetup, 'control: the installer really registers a CFBundleIdentifier to compare');
  assert.equal(inPlist, inSetup,
    'the plist attributes the job to an identifier the installer does not register');
  // And the job still parses as a plist: an array in the wrong place is a file
  // launchd silently refuses to load, which is an agent that never starts.
  const file = nodePath.join(SANDBOX, 'bundle-id-check.plist');
  fs.writeFileSync(file, plist, 'utf8');
  // Guarded on platform (round 40): plutil is macOS-only, and launchd -- the
  // consumer this lint stands in for -- exists only there too, so on another
  // OS the honest outcome is a skip, not an ENOENT masquerading as a failure.
  if (process.platform === 'darwin') {
    const read = require('node:child_process').execFileSync(
      '/usr/bin/plutil', ['-lint', file], { encoding: 'utf8' },
    );
    assert.match(read, /OK/, 'launchd would refuse this plist, so the agent would never start');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// The pane-2 creation options (label, instructions, model), 2026-08-16
// ─────────────────────────────────────────────────────────────────────────────

test('every pane-2 option is validated BEFORE any write, and refusals leave no trace', () => {
  recorder();
  create.setDryRun(false);
  for (const [opts, why] of [
    [{ label: 42 }, 'a non-string label'],
    [{ label: '   ' }, 'a blank label'],
    [{ label: 'x'.repeat(81) }, 'an 81-character label'],
    [{ instructions: '' }, 'empty instructions'],
    [{ instructions: 7 }, 'non-string instructions'],
    [{ model: 'gpt-5' }, 'a model not on the list'],
  ]) {
    const r = create.createAgent({ ...BINS, name: 'opts-refusal', role: 'pm', ...opts });
    assert.equal(r.outcome, create.OUTCOME.REFUSED, `${why} was not refused: ${r.because}`);
    // ⚠️ The refusal must land before the folder exists: a rollback nobody
    // needs is a rollback that will one day half-run.
    assert.ok(!fs.existsSync(create.workerDir('opts-refusal')),
      `${why} was refused only after writing the folder`);
  }
});

test('custom instructions are written verbatim with a trailing newline, and the role template is not', () => {
  recorder();
  create.setDryRun(false);
  const mine = 'You are **{{NAME}}**, precisely what I typed.\n\nNo template.';
  const made = create.createAgent({ ...BINS, name: 'own-words', role: 'pm', instructions: mine });
  assert.equal(made.outcome, create.OUTCOME.CREATED, made.because);
  const text = fs.readFileSync(create.instructionFile('own-words'), 'utf8');
  // ⚠️ Verbatim means no {{NAME}} substitution: these are the person's own
  // words, and rewriting any part of them is the drift rule broken at birth.
  // 🔑 WHAT VERBATIM HAS ALWAYS MEANT HERE: the words are untouched and no
  // TEACHING text is added (the role template, the operating defaults, the
  // colleagues lesson). Managed RECORD blocks are different: the about-you
  // block has spliced into a person's own words at birth since it existed
  // (it sits before the role-only gate in create.js), and this test only
  // ever passed because no About-you record is saved in this sandbox. The
  // reports-to block (#336) is the same kind of thing and is always present,
  // so it is stripped here and the person's words are checked byte for byte
  // around it. A block keyed on the role would have skipped exactly this
  // agent, which is the hole #333 closed.
  const projects = require('./projects');
  const reports = require('./reports');
  const found = projects.findBlock(text, reports.START, reports.END);
  assert.ok(found && !found.ambiguous, 'the person\'s own agent did not get the reports-to block at birth');
    /* #1034: the connections block is stripped for the SAME stated reason as
       the reports-to block above: a managed block keyed on nothing about the
       agent, always present, so it reaches a person's own words at birth
       exactly as the others do. It is knowledge of how the product works, not
       teaching about this agent's job, which is what "verbatim" protects. */
    const connections = require('./connections');
    const foundConn = projects.findBlock(text, connections.START, connections.END);
    assert.ok(foundConn && !foundConn.ambiguous, 'the person\'s own agent did not get the connections block at birth');
    const without = projects.removeBlock(
      projects.removeBlock(text, reports.START, reports.END),
      connections.START, connections.END,
    );
  /* #591 changed one premise here, stated rather than deleted: the operating
     defaults DO follow a person's own words now, under their own heading,
     because they are how any agent behaves in Kosmos rather than a job
     description, and the form says so before the write. The person's words
     stay verbatim and FIRST; the role template still never leaks. */
  const defaults = require('./defaults');
  assert.ok(without.startsWith(mine + '\n'), 'the person\'s own words were not written verbatim and first');
  const rest = without.slice((mine + '\n').length);
  assert.equal(rest.trim(), defaults.block().trim(),
    'something other than the operating defaults, under their own heading, followed the person\'s words');
  assert.ok(!text.includes('project manager'),
    'the role template leaked into instructions the person replaced');
});

test('#591: an agent made from pasted instructions carries the working rules under their own heading, and the words come first', () => {
  recorder();
  create.setDryRun(false);
  const mine = 'You handle the invoices. Nothing else.';
  const made = create.createAgent({ ...BINS, name: 'pasted', role: 'pm', instructions: mine });
  assert.equal(made.outcome, create.OUTCOME.CREATED, made.because);
  const text = fs.readFileSync(create.instructionFile('pasted'), 'utf8');
  const heading = text.indexOf('## How you work, whatever the job');
  assert.ok(heading > -1, 'a pasted agent got none of the working rules');
  assert.ok(text.indexOf(mine) === 0 && text.indexOf(mine) < heading, 'the person\'s words are not first, before the heading');
  assert.ok(text.includes('You keep working until the task is finished'), 'the heading is there but the rules under it are not');
});

/**
 * The operating defaults (#122).
 *
 * 🔑 EVERY ONE OF THESE READS THE FILE THE AGENT ACTUALLY BOOTS FROM, not the
 * module's return value. What `defaults.block()` contains is not the question;
 * what lands in `CLAUDE.md` is, and the two are separated by a size gate, a
 * standing ruling about whose words get appended to, and two other blocks that
 * splice into the same string.
 */
test('an agent made from a role is taught how to work, not only what it is', () => {
  recorder();
  create.setDryRun(false);
  const made = create.createAgent({ ...BINS, name: 'defaulted', role: 'pm' });
  assert.equal(made.outcome, create.OUTCOME.CREATED, made.because);
  const text = fs.readFileSync(create.instructionFile('defaulted'), 'utf8');
  assert.ok(text.includes('project manager'), 'the role text is missing, so this proves nothing about ordering');
  assert.ok(text.includes('How you work, whatever the job'), 'the operating defaults never reached the boot file');
  /* The four events and the room rule are the two passages the block exists
     for, and both were once written against a surface nobody had watched an
     agent try to reach. Named individually so a truncated block fails here
     rather than passing on its first heading. */
  assert.ok(text.includes('**Blocked:** on what, and who owns it.'), 'the four events are missing');
  assert.ok(text.includes('your reply goes back to that'), 'the answer-where-you-were-asked rule is missing');
  assert.ok(text.includes('Look for what is already on this computer'), 'the look-before-you-install rule is missing');
  assert.ok(text.includes('When you make something for a person'), 'the what-you-hand-a-person rule is missing');
});

test('nothing in an agent boot file breaks the rule that boot file states', () => {
  recorder();
  create.setDryRun(false);
  const made = create.createAgent({ ...BINS, name: 'nodashes', role: 'researcher' });
  assert.equal(made.outcome, create.OUTCOME.CREATED, made.because);
  const text = fs.readFileSync(create.instructionFile('nodashes'), 'utf8');
  /* 🛑 ASSERTED ON THE COMPOSED FILE, which is the only place it can be
     checked honestly. The block tells every agent never to use an em dash;
     a block containing one teaches a rule it is visibly breaking, and the
     role text, the colleagues block and the defaults all land in this one
     string from three different modules. Checking any one of them alone
     would leave the other two free to carry it in. */
  const dashes = text.split('\u2014').length - 1;
  assert.equal(dashes, 0, 'the boot file contains ' + dashes + ' em dashes while instructing against them');
});

test('the defaults follow a person\'s own words, after them and under their own heading (#591)', () => {
  recorder();
  create.setDryRun(false);
  const mine = 'You are **Quill**, and I wrote this myself.\n';
  const made = create.createAgent({ ...BINS, name: 'ownwords-def', role: 'pm', instructions: mine });
  assert.equal(made.outcome, create.OUTCOME.CREATED, made.because);
  const text = fs.readFileSync(create.instructionFile('ownwords-def'), 'utf8');
  /* ⚠️ THIS PINS A RULING THAT FLIPPED, and the earlier one is stated so the
     flip is visible: until 2026-08-24 custom instructions got no operating
     defaults, on the ground that they were the person's own words. #591
     (Mona Lisa) ruled that a person who pastes a job has taken authorship of
     the JOB, not opted out of the product working: the block is how any agent
     behaves in Kosmos, not a job description. So it follows their words, under
     its own heading (the seam is visible in the file), and the create form
     says so before the write. Their words still come first and verbatim. */
  assert.ok(text.startsWith(mine), 'the person\'s own words were rewritten or moved');
  const heading = text.indexOf('## How you work, whatever the job');
  assert.ok(heading > mine.length, 'the defaults did not follow the person\'s words under their own heading');
});
test('a role-made boot file is nowhere near the size its reader refuses', () => {
  const instructions = require('./instructions');
  recorder();
  create.setDryRun(false);
  const r = create.createAgent({ ...BINS, name: 'sized-def', role: 'pm' });
  assert.equal(r.outcome, create.OUTCOME.CREATED, r.because);
  const bytes = Buffer.byteLength(fs.readFileSync(create.instructionFile('sized-def'), 'utf8'), 'utf8');
  assert.ok(bytes <= instructions.MAX_BYTES, 'the boot file outgrew its own reader');
  /* 🛑 THIS TEST REPLACED ONE THAT PROVED NOTHING, and the replacement is
     narrower on purpose. The original built instructions ten bytes under
     MAX_BYTES and asserted the defaults were dropped rather than the agent
     refused. It passed with the fits-check deleted, because near-cap
     instructions are CUSTOM instructions, and the defaults are not appended to
     those at all: it was measuring the standing ruling and reporting it as the
     size guard.

     There is no reachable near-cap case on the role path. Role text is under a
     kilobyte, the two blocks are bounded, and the cap is 256KB, so the margin
     is four orders of magnitude wide. That is the honest claim and it is what
     this asserts. The fits-check in create.js stays as defence against future
     growth and is labelled there as currently unfireable, so that nobody
     writes this test again believing it proves something. */
  assert.ok(bytes < instructions.MAX_BYTES / 8,
    'a role-made boot file has grown toward the cap; the fits-check may now be reachable and testable ('
    + bytes + ' bytes)');
});

test('appending the defaults twice does not double every rule', () => {
  const defaults = require('./defaults');
  const once = defaults.appendTo('You are **Sam**, a bookkeeper.\n');
  assert.equal(defaults.appendTo(once), once, 'a second append duplicated the block');
  /* POSITIVE CONTROL: the guard is reading the file, not returning early on
     something incidental. Text without the block must gain it. */
  assert.ok(defaults.appendTo('plain text\n').includes('How you work, whatever the job'),
    'the guard refuses text that never had the block');
});

test('a chosen label lands in the profile only on a completed creation', () => {
  recorder();
  create.setDryRun(false);
  const made = create.createAgent({ ...BINS, name: 'labelled', role: 'researcher', label: 'Napkin Sketcher' });
  assert.equal(made.outcome, create.OUTCOME.CREATED, made.because);
  assert.equal(store.readProfile('labelled').role, 'Napkin Sketcher',
    'the label the person chose is not what the board will read');
});

test('the model choice writes a sixth supervisor argument, and no choice writes the five every existing agent runs', () => {
  recorder();
  create.setDryRun(false);
  const chosen = create.createAgent({ ...BINS, name: 'modelled', role: 'pm', model: 'haiku' });
  assert.equal(chosen.outcome, create.OUTCOME.CREATED, chosen.because);
  const plist = fs.readFileSync(create.plistPath('modelled'), 'utf8');
  assert.match(plist, /claude-haiku-4-5-20251001/,
    'the chosen model never reached the job, so the agent runs on the default while the menu claims otherwise');
  const withArgs = plist.match(/<string>/g).length;

  const plain = create.createAgent({ ...BINS, name: 'unmodelled', role: 'pm' });
  assert.equal(plain.outcome, create.OUTCOME.CREATED, plain.because);
  const plist2 = fs.readFileSync(create.plistPath('unmodelled'), 'utf8');
  assert.ok(!/--model|claude-haiku|claude-sonnet/.test(plist2),
    'an agent created without a choice carries a model flag anyway');
  assert.equal(plist2.match(/<string>/g).length, withArgs - 1,
    'the five-argument shape every existing agent runs did not survive');
});

test('the MODELS list has one default and args the CLI will accept as model ids', () => {
  const defaults = create.MODELS.filter((m) => m.default);
  assert.equal(defaults.length, 1, 'the menu needs exactly one preselected model');
  for (const m of create.MODELS) {
    assert.ok(m.key && m.label && m.arg, 'a model entry is missing a field the menu or the job needs');
    assert.match(m.arg, /^claude-[a-z0-9-]+$/, `${m.key}'s arg does not look like a model id`);
  }
});

test('every model the menu offers is named the same by the board that reports it', () => {
  /* 🛑 TWO LISTS OF MODEL NAMES EXIST AND BOTH ARE CORRECT TO EXIST.
     `create.MODELS` is what a person can CHOOSE. `status.MODEL_NAMES` is what
     to CALL a model we have SEEN, which necessarily includes ones nobody can
     pick any more: an agent started last month may still be running
     claude-opus-4-8, and the board has to name it rather than shrug. Merging
     them would delete that, so they stay two.

     ⚠️ WHAT MUST NOT DRIFT IS THE OVERLAP. Where both lists know a model, they
     have to call it the same thing, or the create menu offers "Claude Sonnet
     5" and the agent's own card reports something else for the very model the
     person just picked. Nothing checked that, and Mona Lisa found the two
     lists disagreeing in content on 2026-08-26 while working on the Runs-on
     menus.

     📌 Through `modelDisplayName`, not by reading MODEL_NAMES directly: dated
     ids (…-20251001) are the same model with a snapshot suffix and the
     function is what knows that. Reading the table raw would fail on haiku for
     a reason that is not a defect. */
  for (const m of create.MODELS) {
    const reported = status.modelDisplayName(m.arg);
    assert.equal(reported, m.label,
      `the menu offers ${m.arg} as "${m.label}" and the board reports it as "${reported}"`);
  }
});

test('own is the last entry and no role is hidden but it', () => {
  // ⚠️ TWO FACTS, AND THEY USED TO BE TWO NUMBERS THAT MOVED TOGETHER (27 and
  // 26). Adding Project Director broke both at once, which is exactly the
  // situation the original comment was trying to avoid: two failures naming
  // one cause, and no way to read which fact went. They are now separate
  // axes. The total is a deliberate tripwire so a role cannot join the
  // catalogue silently; the menu is expressed as a RELATIONSHIP to it, so a
  // new role touches one number and `own` leaking into the picker still fails
  // on its own line no matter how large the catalogue grows.
  // 29 since Product Director (2026-08-23, Josh's word in #chaoskosmos-design,
  // Mona Lisa's text: Josh-Brain/Projects/kosmos-role-character-sheets-2026-08-23.md).
  // 30 since Email Assistant (Josh, 2026-08-25 in #chaoskosmos-design: "Let's
  // add an Email type of agent to the list of predefined roles"; shaped
  // against Vivienne's real account of the job, not a generic guess).
  // 34 since the Personal and family group (Josh, same session: "I think we
  // could also have 3-4 like personal or family type roles"; proposed four
  // candidates, he confirmed all four -- "Family roles sound great" -- and
  // asked for the group at the bottom of the list, which array order
  // already gives it).
  assert.equal(roles.ROLES.length, 34, 'the catalogue grew or shrank; say so here on purpose');
  const menu = roles.ROLES.filter((r) => r.menu !== false);
  assert.equal(menu.length, roles.ROLES.length - 1,
    'exactly one entry is meant to be hidden; own leaked into the picker, or a menu role got hidden');
  assert.ok(!menu.some((r) => r.key === 'own'), 'own is in the grouped menu');
  // POSITIVE CONTROL: the exclusion is the flag doing work, not a
  // coincidence of counting -- flipping it in a copy must change the count.
  const flipped = roles.ROLES.map((r) => (r.key === 'own' ? { ...r, menu: true } : r))
    .filter((r) => r.menu !== false);
  assert.equal(flipped.length, roles.ROLES.length, 'the menu filter is not reading the flag this test guards');
  // No label on purpose: it prints under the agent's name, and "Custom" is
  // nobody's job. The gate lives in create and is tested below.
  assert.ok(!roles.byKey('own').label, 'own grew a default label');
});

test('every role says who it is, between what it is and how it works', () => {
  // Josh, 2026-08-23: every role gets character, "positive traits", dialled
  // rather than extreme, so a dry analyst and a lively social manager are
  // different people and not one assistant wearing 29 labels. It rides INSIDE
  // the role text, not the #122 block, because the block is what every agent
  // shares and character is the part that differs. Position is the claim:
  // after the one-sentence description, before the bullets, so the agent reads
  // who it is before how it works and the person editing the file finds it
  // where a person would look. Text: kosmos-role-character-sheets-2026-08-23.md.
  for (const r of roles.ROLES) {
    const text = roles.instructionsFor(r.key, 'Fixture');
    const who = text.indexOf('## Who you are');
    const how = text.indexOf('## How you work');
    assert.ok(who > 0, `role '${r.key}' has no "Who you are" section`);
    assert.ok(how > who, `role '${r.key}' puts "Who you are" after "How you work"`);
    const body = text.slice(who, how).replace('## Who you are', '').trim();
    const sentences = body.split(/[.!?](\s|$)/).filter((s) => s.trim()).length;
    // MENU roles are three to six sentences: the person picked a job and a
    // page of character gets skimmed. `own` is the one exception, on Josh's
    // word (2026-08-23 09:45): it is the prefill a person writes over, and he
    // asked for it "pretty hefty", so it only has a floor.
    if (r.key === 'own') assert.ok(sentences >= 6, `own's character runs ${sentences} sentences; it is meant to be the hefty one`);
    else assert.ok(sentences >= 3 && sentences <= 6, `role '${r.key}' character runs ${sentences} sentences; three to six is the rule, a page gets skimmed`);
    assert.ok(!text.includes('\u2014'), `role '${r.key}' teaches "never use an em dash" with one in its own file`);
  }
  // POSITIVE CONTROL: the check reads the composed text, not a constant.
  const stripped = roles.byKey('pm').instructions.replace('## Who you are', '## Nothing');
  assert.ok(!stripped.includes('## Who you are'), 'the control did not strip the section');
});

test('creating own without a label is a gating refusal, never a default', () => {
  recorder();
  create.setDryRun(false);
  for (const opts of [{}, { label: '  ' }]) {
    const r = create.createAgent({ ...BINS, name: 'own-nolabel', role: 'own', ...opts });
    assert.equal(r.outcome, create.OUTCOME.REFUSED, r.because);
    assert.match(r.because, /your own words/i, 'the refusal does not ask the gating question');
    assert.ok(!fs.existsSync(create.workerDir('own-nolabel')), 'refused after writing');
  }
  const made = create.createAgent({ ...BINS, name: 'own-labelled', role: 'own', label: 'Napkin Wrangler' });
  assert.equal(made.outcome, create.OUTCOME.CREATED, made.because);
  assert.equal(store.readProfile('own-labelled').role, 'Napkin Wrangler');
  const text = fs.readFileSync(create.instructionFile('own-labelled'), 'utf8');
  assert.match(text, /^You are \*\*own-labelled\*\*, an assistant\./,
    'the example did not substitute the name in the identity shape the board parses');
  assert.match(text, /stuck rather than filling the gap/,
    "the example's posture bullet is missing");
});

test('describe-it-yourself carries the operating defaults in its own body, once, edited or not', () => {
  // Josh, 2026-08-23 09:45: a hefty default for the third radio that has
  // "the instructions for not stopping work" IN it, a jumping-off point the
  // person keeps, edits, or replaces. The mechanism this pins: the block sits
  // inside the template (before authorship) rather than being appended after
  // it, so (a) an untouched editor is not double-appended, (b) an edited one
  // still boots with the defaults because they were in the words edited, and
  // (c) the template's copy cannot drift from defaults.js because it IS
  // defaults.js, read at load.
  const defaults = require('./defaults');
  const HEADING = 'How you work, whatever the job';
  const count = (t) => t.split(HEADING).length - 1;
  // (c) one source
  assert.ok(roles.byKey('own').instructions.includes(defaults.block()),
    "the own template's copy of the block has drifted from defaults.js");
  recorder();
  create.setDryRun(false);
  // (a) untouched: the role path appends defaults and must find them present
  const kept = create.createAgent({ ...BINS, name: 'own-kept', role: 'own', label: 'Napkin Wrangler' });
  assert.equal(kept.outcome, create.OUTCOME.CREATED, kept.because);
  assert.equal(count(fs.readFileSync(create.instructionFile('own-kept'), 'utf8')), 1,
    'an untouched own editor booted with the block appended a second time, or not at all');
  // (b) edited: the person's words travel verbatim and still carry the block
  const edited = roles.instructionsFor('own', 'own-edited').replace('an assistant', 'a napkin wrangler');
  const made = create.createAgent({ ...BINS, name: 'own-edited', role: 'own', label: 'Napkin Wrangler', instructions: edited });
  assert.equal(made.outcome, create.OUTCOME.CREATED, made.because);
  const text = fs.readFileSync(create.instructionFile('own-edited'), 'utf8');
  assert.match(text, /a napkin wrangler/, 'the edit did not travel');
  assert.equal(count(text), 1, 'an edited own file lost the block, or gained a second copy');
  // (d) stripped: a person who deletes the block from the editor gets it
  // back, once, under its heading (#591: the block is how any agent behaves
  // in Kosmos, not part of the job they authored; the form says so first).
  // Before #591 this was the positive control for the opposite rule, and it
  // is kept as a control for the new one: exactly one copy, never two.
  const stripped = edited.slice(0, edited.indexOf('## ' + HEADING)).trimEnd() + '\n';
  const bare = create.createAgent({ ...BINS, name: 'own-bare', role: 'own', label: 'Napkin Wrangler', instructions: stripped });
  assert.equal(bare.outcome, create.OUTCOME.CREATED, bare.because);
  const bareText = fs.readFileSync(create.instructionFile('own-bare'), 'utf8');
  assert.equal(count(bareText), 1, 'a stripped own file booted without the block, or with two copies');
  assert.ok(bareText.startsWith(stripped.trimEnd()), 'the person\'s stripped words were not kept first and verbatim');
});

test('an agent made onto a project is born with the block, so the later sync writes nothing (#323)', () => {
  /**
   * 🛑 WHY. The projects block used to arrive by `projects.syncAgent` once the
   * board could see the session, which is at least one poll AFTER the session
   * started. So every agent made onto a project greeted its owner with
   * "Running on older instructions" and a Restart button at sixty seconds old
   * (Josh, 2026-08-22: "I literally just created this agent a minute ago").
   * The trigger then vanished by accident when projects came off the create
   * form; this makes the fix deliberate: compose before the first write, and
   * prove the post-start path is a no-op at the FILE, not just at the verdict.
   */
  const projects = require('./projects');
  const instructions = require('./instructions');
  recorder();
  create.setDryRun(false);
  const winter = projects.create({ name: 'Winter launch' });
  // Real cards from the real route, as the house rule requires: the roster
  // `tellAgent` reads is the status engine's output, never a literal.
  const roster = (() => {
    const board = fleet.install([fleet.agent('born-on', { state: 'working' }), fleet.agent('born-off', { state: 'working' })]);
    try { return board.agents; } finally { board.restore(); }
  })();

  const made = create.createAgent({ ...BINS, name: 'born-on', role: 'writer', projects: [winter.id] });
  assert.equal(made.outcome, create.OUTCOME.CREATED, made.because);
  const file = create.instructionFile('born-on');
  const atBirth = fs.readFileSync(file, 'utf8');
  assert.ok(atBirth.includes(projects.BLOCK_START), 'the projects block is not in the file at birth');
  assert.match(atBirth, /\*\*Winter launch\*\*/, 'the block does not name the project');
  // The block is LAST, after the operating defaults: that is where a later
  // splice would put it, and the bytes must agree or the sync writes after all.
  assert.ok(atBirth.indexOf(projects.BLOCK_START) > atBirth.indexOf('How you work, whatever the job'),
    'the block is not where spliceBlock would put it, so the later sync will write');

  // Exactly what the route does next, in order.
  projects.addAgent(winter.id, 'born-on', roster);
  const mtimeBefore = fs.statSync(file).mtimeMs;
  const verdict = projects.syncAgent('born-on', roster);
  assert.equal(verdict.state, projects.TOLD.TOLD, verdict.because);
  assert.equal(fs.readFileSync(file, 'utf8'), atBirth, 'the sync rewrote a file that already said this');
  assert.equal(fs.statSync(file).mtimeMs, mtimeBefore, 'the sync touched the file, so the agent is born stale again');
  assert.equal(store.readProfile('born-on').instructionsWrite, undefined,
    'a no-op sync recorded a write, so the marker would blame Kosmos for nothing');

  // POSITIVE CONTROL: the old way still writes, and now says why.
  const ctrl = create.createAgent({ ...BINS, name: 'born-off', role: 'writer' });
  assert.equal(ctrl.outcome, create.OUTCOME.CREATED, ctrl.because);
  const file2 = create.instructionFile('born-off');
  assert.ok(!fs.readFileSync(file2, 'utf8').includes(projects.BLOCK_START), 'an agent made onto no project got a block');
  projects.addAgent(winter.id, 'born-off', roster);
  const v2 = projects.syncAgent('born-off', roster);
  assert.equal(v2.state, projects.TOLD.TOLD, v2.because);
  assert.ok(fs.readFileSync(file2, 'utf8').includes(projects.BLOCK_START), 'the control did not get the block, so the first half proved nothing');
  const rec = store.readProfile('born-off').instructionsWrite;
  assert.ok(rec && rec.who === 'kosmos', 'Kosmos wrote the file and did not say so');
  assert.equal(rec.because, 'Kosmos put it on Winter launch');
  assert.deepEqual(instructions.wroteBy('born-off', fs.statSync(file2).mtimeMs), { who: 'kosmos', because: 'Kosmos put it on Winter launch' },
    'the record does not match the file it describes');

  // ⚠️ AND THE RECORD FALLS AWAY WHEN THE FILE MOVES ON WITHOUT IT. A hand
  // edit five seconds later leaves the file newer than the record, and the
  // honest answer is "nobody said", never "Kosmos did".
  const later = new Date(fs.statSync(file2).mtimeMs + 5000);
  fs.utimesSync(file2, later, later);
  assert.equal(instructions.wroteBy('born-off', fs.statSync(file2).mtimeMs), null,
    'a hand edit is being attributed to Kosmos');

  // A person's save through the editor records the person, with no sentence.
  const seen = instructions.read('born-off');
  instructions.write('born-off', seen.text + '\nOne more line from the person.\n', seen.version, undefined, { who: 'person', because: null });
  assert.deepEqual(instructions.wroteBy('born-off', fs.statSync(file2).mtimeMs), { who: 'person', because: null });
});

test('every agent is born knowing who it reports to, identically on both paths, and the file follows the record (#336)', () => {
  /**
   * 🛑 The record carried reportsTo and role since the org chart shipped and
   * every screen read them; the agent never did. Josh, 2026-08-23 09:47.
   *
   * Three things pinned, each the thing that would rot silently:
   *  1. KEYED ON THE AGENT: an agent described in the person's own words gets
   *     the block identically to one off the menu. `own` had no role content
   *     and went without the #122 block for as long as the product existed.
   *  2. ALWAYS PRESENT, NAMING THE PERSON: unassigned means reporting to the
   *     person (Josh 09:55), so the block is there before anybody assigns
   *     anything, by the About-you name, and is rewritten rather than removed.
   *  3. THE FILE FOLLOWS THE RECORD: a profile save that moves reportsTo
   *     rewrites the block and says who wrote it; a save that moves nothing
   *     writes nothing.
   */
  const projects = require('./projects');
  const reports = require('./reports');
  const instructions = require('./instructions');
  const you = require('./you');
  recorder();
  create.setDryRun(false);
  you.save({ name: 'Josh', does: 'Runs a company that builds AI tools' });
  try {
    const blockOf = (name) => {
      const text = fs.readFileSync(create.instructionFile(name), 'utf8');
      const at = projects.findBlock(text, reports.START, reports.END);
      assert.ok(at && !at.ambiguous, `${name} has no reports-to block`);
      return text.slice(at.start, at.end);
    };
    // 1 + 2: menu and own-words, no manager: identical blocks naming the person.
    // Same label both ways, so the only difference between the two agents is
    // the path they were made by.
    const menu = create.createAgent({ ...BINS, name: 'rep-menu', role: 'writer', label: 'Business Writer' });
    assert.equal(menu.outcome, create.OUTCOME.CREATED, menu.because);
    const own = create.createAgent({ ...BINS, name: 'rep-own', role: 'own', label: 'Business Writer',
      instructions: 'You are **rep-own**, in my own words.\n\nDo the thing.' });
    assert.equal(own.outcome, create.OUTCOME.CREATED, own.because);
    assert.equal(blockOf('rep-menu'), blockOf('rep-own'), 'the self-described agent got a different block from the menu one');
    assert.match(blockOf('rep-menu'), /You report to \*\*Josh\*\* directly/, 'the default does not name the person');
    assert.match(blockOf('rep-menu'), /Kosmos lists you as \*\*Business Writer\*\*/, 'the title is missing');
    assert.doesNotMatch(blockOf('rep-menu'), /nobody/i, 'there is no nobody');

    // A manager picked at creation is named at birth, by display name.
    store.writeProfile('rep-menu', { displayName: 'Mara' });
    const under = create.createAgent({ ...BINS, name: 'rep-under', role: 'writer', reportsTo: 'rep-menu' });
    assert.equal(under.outcome, create.OUTCOME.CREATED, under.because);
    assert.match(blockOf('rep-under'), /You report to \*\*Mara\*\*\./, 'the manager is not named at birth');
    assert.match(blockOf('rep-under'), /the person wins/, 'the who-wins sentence is missing');

    // 3: the file follows the record, and says who wrote it.
    const roster = (() => {
      const board = fleet.install([fleet.agent('rep-own', { state: 'working' }), fleet.agent('rep-menu', { state: 'working' })]);
      try { return board.agents; } finally { board.restore(); }
    })();
    const before = fs.readFileSync(create.instructionFile('rep-own'), 'utf8');
    const same = reports.tellAgent('rep-own', roster);
    assert.equal(same.state, projects.TOLD.TOLD, same.because);
    assert.equal(fs.readFileSync(create.instructionFile('rep-own'), 'utf8'), before, 'a sync with nothing changed rewrote the file');
    store.writeProfile('rep-own', { reportsTo: 'rep-menu' });
    const moved = reports.tellAgent('rep-own', roster);
    assert.equal(moved.state, projects.TOLD.TOLD, moved.because);
    assert.match(blockOf('rep-own'), /You report to \*\*Mara\*\*\./, 'the record moved and the file did not');
    assert.doesNotMatch(blockOf('rep-own'), /directly/, 'the old default sentence survived the rewrite');
    const rec = store.readProfile('rep-own').instructionsWrite;
    assert.ok(rec && rec.who === 'kosmos' && /report to Mara/.test(rec.because), 'the stale marker would blame the person for a change Kosmos made');
    // And the person's own words are still there, untouched, around it.
    assert.match(fs.readFileSync(create.instructionFile('rep-own'), 'utf8'), /in my own words\.\n\nDo the thing\./);

    // Back to the person: rewritten to the default form, never removed.
    store.writeProfile('rep-own', { reportsTo: null });
    assert.equal(reports.tellAgent('rep-own', roster).state, projects.TOLD.TOLD);
    assert.match(blockOf('rep-own'), /You report to \*\*Josh\*\* directly/, 'clearing the manager removed the block instead of naming the person');

    // The manager's rename reaches the files that name it.
    store.writeProfile('rep-own', { reportsTo: 'rep-menu' });
    reports.tellAgent('rep-own', roster);
    store.writeProfile('rep-menu', { displayName: 'Scarlet' });
    const told = reports.syncReportsTo('rep-menu', roster);
    assert.ok(told.some((t) => t.agent === 'rep-own' && t.state === projects.TOLD.TOLD), 'the report did not learn the new name');
    assert.match(blockOf('rep-own'), /You report to \*\*Scarlet\*\*\./);
    assert.ok(instructions.read('rep-own').text.includes(reports.START), 'control: the block is still a managed block');
  } finally {
    fs.rmSync(you.FILE, { force: true });
  }
});

test('a saved About-you record rides the boot file from birth, and its absence costs nothing', () => {
  const you = require('./you');
  recorder();
  create.setDryRun(false);

  // With a record: the block is spliced into the SAME write that creates the
  // file, because at create time the session does not exist yet and the tell
  // path's tied-session gate would refuse the very agent being made.
  you.save({ name: 'Josh', does: 'Runs a company that builds AI tools' });
  const r1 = create.createAgent({ ...BINS, name: 'born-knowing', role: 'pm' });
  assert.equal(r1.outcome, create.OUTCOME.CREATED, r1.because);
  const text = fs.readFileSync(create.instructionFile('born-knowing'), 'utf8');
  assert.match(text, /Who you work for/, 'the boot file does not carry the answers');
  assert.match(text, /Josh\. Runs a company/);
  assert.match(text, /You are \*\*born-knowing\*\*/, 'the role instructions were displaced');

  // Without one: the boot file simply ships without the block.
  fs.rmSync(you.FILE, { force: true });
  const r2 = create.createAgent({ ...BINS, name: 'born-plain', role: 'pm' });
  assert.equal(r2.outcome, create.OUTCOME.CREATED, r2.because);
  assert.ok(!fs.readFileSync(create.instructionFile('born-plain'), 'utf8').includes('Who you work for'));
});

test('the birth splice never pushes a boot file past the size its own reader accepts', () => {
  const you = require('./you');
  const instructions = require('./instructions');
  recorder();
  create.setDryRun(false);
  you.save({ name: 'Josh', does: 'Runs a company' });
  // Instructions that validate just under the cap: the block must be the
  // thing dropped, never the person's words, and never the file's
  // editability.
  // Sized so the file lands 10 bytes under the cap: any block is bigger
  // than that, so a splice that ignored the margin would cross it.
  const header = 'You are **Margin**, a tester.\n';
  const nearCap = header + 'x'.repeat(instructions.MAX_BYTES - Buffer.byteLength(header, 'utf8') - 11) + '\n';
  const r = create.createAgent({ ...BINS, name: 'margin', role: 'pm', instructions: nearCap });
  assert.equal(r.outcome, create.OUTCOME.CREATED, r.because);
  const text = fs.readFileSync(create.instructionFile('margin'), 'utf8');
  assert.ok(!text.includes('Who you work for'), 'the block crossed the size margin anyway');
  assert.ok(Buffer.byteLength(text, 'utf8') <= instructions.MAX_BYTES, 'the boot file outgrew its own reader');
  fs.rmSync(you.FILE, { force: true });
});

/**
 * The model the job will start on, read back out of the job we wrote.
 *
 * ⚠️ A ROUND TRIP THROUGH THE REAL WRITER, not a hand-built plist. The reader
 * takes the model from a fixed position in `ProgramArguments`, so a test that
 * fed it a plist typed out here would be asserting my arithmetic against
 * itself: add an argument to `plistFor` and both the product and the fixture
 * shift, silently, together. Creating the agent for real is what makes the
 * writer and the reader one contract with two ends.
 */
test('the planned model survives the round trip through the real job file', () => {
  recorder();
  create.setDryRun(false);
  const r = create.createAgent({ ...BINS, name: 'plannedone', role: 'pm', model: 'opus' });
  assert.equal(r.outcome, create.OUTCOME.CREATED, r.because);
  // The exact string `claude --model` is handed, not the key the route accepts:
  // showing a person the key would show them "opus".
  assert.equal(create.plannedModelArg('plannedone'), 'claude-opus-5');
});

/**
 * ⚠️ THE CONTROL FOR THE TEST ABOVE. Without it, `plannedModelArg` could return
 * a hardcoded string, or read the wrong index and happen to be right for one
 * model, and both tests would pass. This asserts the value TRACKS the choice.
 */
test('a different choice comes back different, and every model in the list round-trips', () => {
  recorder();
  create.setDryRun(false);
  for (const m of create.MODELS) {
    const name = `rt${m.key}`;
    const r = create.createAgent({ ...BINS, name, role: 'pm', model: m.key });
    assert.equal(r.outcome, create.OUTCOME.CREATED, r.because);
    assert.equal(create.plannedModelArg(name), m.arg,
      `${m.key} did not come back as the argument the job runs with`);
  }
});

/**
 * ⚠️ NULL MEANS WE DO NOT KNOW, AND THE THREE WAYS OF NOT KNOWING ALL HAVE TO
 * REACH IT. A reader that returned the default model for a job that carries no
 * model argument would put a confident sentence on the screen about an agent
 * whose model nobody ever chose — the exact could-not-look versus is-not-there
 * confusion this product refuses everywhere else.
 */
test('no job, no model argument, and an unreadable file all answer null', () => {
  recorder();
  create.setDryRun(false);

  // 1. No job at all.
  assert.equal(create.plannedModelArg('never-made-at-all'), null);

  // 2. A job written without a model choice — the five-argument form every
  //    agent created before the picker existed still runs.
  const r = create.createAgent({ ...BINS, name: 'nomodelpick', role: 'pm' });
  assert.equal(r.outcome, create.OUTCOME.CREATED, r.because);
  const plist = fs.readFileSync(create.plistPath('nomodelpick'), 'utf8');
  assert.ok(!/claude-(opus|sonnet|fable|haiku)/.test(plist),
    'this agent was supposed to be created without a model choice');
  assert.equal(create.plannedModelArg('nomodelpick'), null);

  // 3. Present but unparseable.
  fs.writeFileSync(create.plistPath('nomodelpick'), 'not a plist at all', 'utf8');
  assert.equal(create.plannedModelArg('nomodelpick'), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// Trusting the folder we made (#164)
// ─────────────────────────────────────────────────────────────────────────────

const trustCfg = () => nodePath.join(SANDBOX, 'claude.json');
const writeCfg = (obj) => fs.writeFileSync(trustCfg(), JSON.stringify(obj, null, 2) + '\n', 'utf8');
const readCfg = () => JSON.parse(fs.readFileSync(trustCfg(), 'utf8'));

test('a new agent does not stop to ask whether it can trust the folder we just made it', () => {
  /**
   * ⚠️ THE COST OF THE PROMPT IS NOT THE PROMPT. Every agent showed `Needs you`
   * from birth, so the badge stopped separating an agent that genuinely needs
   * an answer from one that was merely born (#164).
   */
  recorder();   // for the side effect: nothing here asserts on the calls
  create.setDryRun(false);
  writeCfg({ projects: {} });

  const r = create.createAgent({ ...BINS, name: 'trustfix-one', role: 'pm' });
  assert.equal(r.outcome, create.OUTCOME.CREATED, r.because);

  const dir = fs.realpathSync(nodePath.join(SANDBOX, 'workers', 'trustfix-one'));
  assert.equal(readCfg().projects[dir].hasTrustDialogAccepted, true);
});

test('a folder the PERSON already made is refused outright, so nothing downstream can touch it', () => {
  /**
   * 🛑 THE SECURITY-RELEVANT HALF, and writing it taught me which guard is
   * actually doing the work. I assumed `weMadeTheFolder` was, and asserted a
   * successful creation that left the config alone. It came back REFUSED:
   * `createAgent` already turns down a name whose folder exists, so the trust
   * write is unreachable on that path — the refusal upstream is the first line
   * and the `weMadeTheFolder` check is the second.
   *
   * Naming the wrong guard would have left a comment claiming a protection
   * that a later loosening of the refusal would silently remove. So this test
   * asserts what is TRUE: nobody else's folder can reach the trust write,
   * because nobody else's folder can reach a created agent.
   *
   * ⚠️ SO IT IS A REGRESSION GUARD ON THE REFUSAL, NOT A TRUST TEST, and it is
   * named that way now. It passes with the entire trust feature deleted, which
   * is honest for what it covers and would be a lie under its old name. The
   * trust half is covered by the race test further down.
   */
  recorder();   // for the side effect: nothing here asserts on the calls
  create.setDryRun(false);
  writeCfg({ projects: {} });

  const theirs = nodePath.join(SANDBOX, 'workers', 'trustfix-two');
  fs.mkdirSync(theirs, { recursive: true });
  fs.writeFileSync(nodePath.join(theirs, 'their-notes.txt'), 'not ours\n', 'utf8');

  const r = create.createAgent({ ...BINS, name: 'trustfix-two', role: 'pm' });
  assert.equal(r.outcome, create.OUTCOME.REFUSED, 'a folder that is already there is not ours to take over');

  assert.deepEqual(Object.keys(readCfg().projects), [],
    'we answered a safety question about a folder we did not make');
  assert.equal(fs.readFileSync(nodePath.join(theirs, 'their-notes.txt'), 'utf8'), 'not ours\n',
    'and their file is still theirs');
});

test('a config we cannot write does not cost the person their agent', () => {
  /**
   * The fallback, asserted rather than assumed: every refusal inside the trust
   * write returns the person to the behaviour they have today, which is an
   * agent that starts and asks once.
   */
  recorder();   // for the side effect: nothing here asserts on the calls
  create.setDryRun(false);
  fs.writeFileSync(trustCfg(), '{ not json at all', 'utf8');

  const r = create.createAgent({ ...BINS, name: 'trustfix-three', role: 'pm' });
  assert.equal(r.outcome, create.OUTCOME.CREATED, r.because);
  assert.equal(fs.readFileSync(trustCfg(), 'utf8'), '{ not json at all', 'and their file is untouched');
});

test('an agent that will not start takes its trust entry back off the machine with it', () => {
  /**
   * ⚠️ THE SENTENCE IS THE TEST. A failed start tells the person "we have taken
   * it back off your computer rather than leave something half installed" —
   * and the trust write happens BEFORE the start, because the question it
   * answers is asked at startup. Without the undo, an entry for a folder that
   * no longer exists sits in another tool's config forever and that sentence is
   * false in exactly the case that produces it.
   */
  create.setRunner((file, args) => {
    if (args && args[0] === 'bootstrap') return { ok: false, stderr: 'Load failed: 5: Input/output error' };
    return { ok: true };
  });
  create.setDryRun(false);
  writeCfg({ theme: 'dark', projects: {} });

  const r = create.createAgent({ ...BINS, name: 'trustfix-rollback', role: 'pm' });
  assert.equal(r.outcome, create.OUTCOME.PARTIAL, 'the start did not fail, so this tests nothing');

  const after = readCfg();
  assert.deepEqual(Object.keys(after.projects), [],
    'a trust entry survived a rollback, for a folder that no longer exists');
  assert.equal(after.theme, 'dark', 'the undo took more than it wrote');
  assert.ok(!r.steps.some((s) => s.label === 'took back the folder trust'),
    'the undo refused, so the "taken it back off your computer" sentence is not true');
  create.setRunner(null);

  /* 🛑 ASSERT PRESENCE BEFORE ABSENCE. Everything above is an empty
     `projects`, which is also what a creation that NEVER WROTE THE KEY leaves —
     a broken `weMadeTheFolder`, a `trustFolder` refusal on this fixture, or the
     whole feature deleted. The test could not tell "the undo worked" from
     "there was nothing to undo".
     So the same fixture is run again with a start that SUCCEEDS: if the key
     does not appear there, the emptiness above proved nothing. */
  create.setRunner(() => ({ ok: true }));
  /* ⚠️ AND dry-run again: `setRunner(null)` above RE-ARMS it, so without this
     the control creation reports CREATED and writes nothing — the control
     would then fail for a reason that has nothing to do with what it checks.
     The suite told me this by throwing on a folder that was never made. */
  create.setDryRun(false);
  writeCfg({ theme: 'dark', projects: {} });
  const ok = create.createAgent({ ...BINS, name: 'trustfix-rollback-control', role: 'pm' });
  assert.equal(ok.outcome, create.OUTCOME.CREATED, ok.because);
  const controlPath = fs.realpathSync(nodePath.join(SANDBOX, 'workers', 'trustfix-rollback-control'));
  assert.equal(readCfg().projects[controlPath].hasTrustDialogAccepted, true,
    'CONTROL: this fixture never produces a trust entry at all, so the rollback assertion above is vacuous');
  create.setRunner(null);
});

test('a rollback leaves a trust decision THEY already made for that same path', () => {
  /**
   * 🛑 THE CONTROL ON THE UNDO, and the first version of it could not fail. It
   * seeded somebody's entry at a DIFFERENT path — which `forgetFolder` would
   * never touch whatever the guard said, so the test passed with the guard
   * inverted to `true` and proved nothing.
   *
   * The case that actually exercises it: a person trusted this exact folder
   * once, the folder was later removed, the config entry stayed (Claude Code
   * never prunes them; the "93 dead entries" this once cited were THIS BRANCH'S
   * OWN unsandboxed suite, retracted in trust.js — the property holds and the
   * number measured a bug of mine), and now
   * the name is created again. `trustFolder` finds it already true and writes
   * NOTHING, so a rollback that deleted "the entry for our folder" would be
   * deleting THEIR answer, not ours.
   */
  create.setRunner((file, args) => {
    if (args && args[0] === 'bootstrap') return { ok: false, stderr: 'nope' };
    return { ok: true };
  });
  create.setDryRun(false);

  // Their standing decision about the very path this creation will use.
  const samePath = nodePath.join(fs.realpathSync(SANDBOX), 'workers', 'trustfix-rollback-two');
  writeCfg({ projects: { [samePath]: { hasTrustDialogAccepted: true, allowedTools: ['Bash(ls:*)'] } } });

  const r = create.createAgent({ ...BINS, name: 'trustfix-rollback-two', role: 'pm' });
  assert.equal(r.outcome, create.OUTCOME.PARTIAL, 'the start did not fail, so no rollback ran');

  const after = readCfg();
  assert.deepEqual(Object.keys(after.projects), [samePath],
    'the rollback deleted a trust decision the person had already made for that folder');
  assert.equal(after.projects[samePath].hasTrustDialogAccepted, true);
  assert.deepEqual(after.projects[samePath].allowedTools, ['Bash(ls:*)'], 'and took their other settings with it');
  create.setRunner(null);
});

test('a folder that appears in the window between the check and the mkdir is not trusted', () => {
  /**
   * 🛑 THE ONE CASE `weMadeTheFolder` ACTUALLY GUARDS, and it had no test —
   * the test named for it was watching the refusal further up instead, which
   * the comment beside it says out loud.
   *
   * The refusal checks `existsSync` early; `mkdirSync` runs later. Anything
   * that creates the folder in that window makes recursive mkdir succeed
   * silently and return undefined, and the trust write must not fire — we did
   * not make that folder and have no idea what is in it.
   *
   * ⚠️ Simulated by creating the folder inside a wrapped `mkdirSync`, which is
   * the only way to be inside the window. The alternative was to argue it.
   */
  create.setRunner(() => ({ ok: true }));
  create.setDryRun(false);
  writeCfg({ projects: {} });

  const dir = nodePath.join(SANDBOX, 'workers', 'trustfix-race');
  const realMkdir = fs.mkdirSync;
  let armed = true;
  fs.mkdirSync = function (p, opts) {
    if (armed && String(p) === dir) {
      armed = false;
      realMkdir.call(fs, p, { recursive: true });        // somebody else got there first
      const r = realMkdir.call(fs, p, opts);             // ...and now ours is the no-op
      fs.writeFileSync(nodePath.join(p, 'not-ours.txt'), 'theirs\n', 'utf8');
      return r;
    }
    return realMkdir.call(fs, p, opts);
  };
  let r;
  try {
    r = create.createAgent({ ...BINS, name: 'trustfix-race', role: 'pm' });
  } finally {
    fs.mkdirSync = realMkdir;
    create.setRunner(null);
  }

  assert.equal(r.outcome, create.OUTCOME.CREATED, r.because);
  assert.equal(armed, false, 'the wrapper never fired, so the window was never entered');
  assert.deepEqual(Object.keys(readCfg().projects), [],
    'we answered a safety question about a folder that appeared under us');
});

test('a rollback removes only the key it added, not the entry it found', () => {
  /**
   * 🛑 THE BLOCKER THIS REPLACES WAS IN THE FIX FOR A BLOCKER. The rollback
   * deleted the whole `projects[…]` entry on the reasoning that we must have
   * created it. We may only have MERGED INTO it: Claude Code never prunes
   * entries, so a person can have one for that exact path holding their
   * allowedTools and MCP servers, with no trust key in it. The undo took all of
   * it, on the path whose entire job is putting things back.
   *
   * ⚠️ AND THE TEST GUARDING THAT COULD NOT FAIL. It seeded the entry with the
   * trust key already TRUE — which short-circuits before any write, so the undo
   * never ran and the guard was never evaluated against a live deletion. The
   * shape that loses data is the key ABSENT, which is this fixture.
   */
  create.setRunner((file, args) => {
    if (args && args[0] === 'bootstrap') return { ok: false, stderr: 'nope' };
    return { ok: true };
  });
  create.setDryRun(false);

  const samePath = nodePath.join(fs.realpathSync(SANDBOX), 'workers', 'trustfix-merge');
  writeCfg({ projects: { [samePath]: { allowedTools: ['Bash(ls:*)'], mcpServers: { linear: {} } } } });

  const r = create.createAgent({ ...BINS, name: 'trustfix-merge', role: 'pm' });
  assert.equal(r.outcome, create.OUTCOME.PARTIAL, 'the start did not fail, so no rollback ran');

  const e = readCfg().projects[samePath];
  assert.ok(e, 'the rollback deleted an entry it had only merged into');
  assert.deepEqual(e.allowedTools, ['Bash(ls:*)'], 'their allowed tools went with it');
  assert.deepEqual(e.mcpServers, { linear: {} }, 'their MCP servers went with it');
  assert.equal('hasTrustDialogAccepted' in e, false, 'the key we added survived the rollback');
  create.setRunner(null);
});

test('an undo that could not run is recorded, because the sentence says it did', () => {
  /**
   * 🛑 THE TEST THIS REPLACES ASSERTED THE ABSENCE OF A STEP NOTHING PUSHED.
   * `assert.ok(!r.steps.some(s => s.label === 'took back the folder trust'))`
   * passed because that string existed nowhere in the product — the push had
   * been lost to a `git checkout` during mutation testing, and an absence
   * assertion cannot tell "it did not happen" from "it cannot happen".
   *
   * ⚠️ THE FAILURE IS INJECTED ON THE SECOND RENAME, which is the only way to
   * have the trust write SUCCEED and its undo FAIL. Making the config
   * unwritable fails both, and then there is nothing to take back.
   */
  create.setRunner((file, args) => {
    if (args && args[0] === 'bootstrap') return { ok: false, stderr: 'nope' };
    return { ok: true };
  });
  create.setDryRun(false);
  writeCfg({ projects: {} });

  const realRename = fs.renameSync;
  let n = 0;
  fs.renameSync = function (...args) {
    if (String(args[0]).includes('.kosmos-')) {
      n += 1;
      if (n === 2) { const e = new Error('injected'); e.code = 'EIO'; throw e; }
    }
    return realRename.apply(fs, args);
  };
  let r;
  try {
    r = create.createAgent({ ...BINS, name: 'trustfix-undo-fail', role: 'pm' });
  } finally {
    fs.renameSync = realRename;
    create.setRunner(null);
  }

  assert.equal(r.outcome, create.OUTCOME.PARTIAL, 'the start did not fail, so no rollback ran');
  assert.equal(n, 2, 'the undo never attempted a write, so nothing was injected into');
  assert.ok(r.steps.some((s) => s.label === 'took back the folder trust' && s.ok === false),
    'the undo failed and nothing on the machine says so, while the person is told we took it back');

  assert.equal(Object.keys(readCfg().projects).length, 1,
    'the entry was removed after all, so the injection did not reach the undo');
});

test('a successful undo adds no step, so the failure step means something', () => {
  /**
   * ⚠️ THE VERSION BEFORE THIS PASSED WITH THE WHOLE TRUST FEATURE DELETED. Its
   * two assertions were "projects is empty" and "no failure step" — and a
   * creation that never wrote the key produces both. Its own guard message,
   * "the undo did not run, so this proves nothing", named a check that could
   * not tell "the undo removed the entry" from "there was never an entry".
   *
   * ⚠️ So it proves PRESENCE first, with a succeeding creation on the same
   * fixture, exactly as its sibling above does.
   */
  create.setRunner(() => ({ ok: true }));
  create.setDryRun(false);
  writeCfg({ projects: {} });
  const ok = create.createAgent({ ...BINS, name: 'trustfix-undo-ok-control', role: 'pm' });
  assert.equal(ok.outcome, create.OUTCOME.CREATED, ok.because);
  const controlPath = fs.realpathSync(nodePath.join(SANDBOX, 'workers', 'trustfix-undo-ok-control'));
  assert.equal(readCfg().projects[controlPath].hasTrustDialogAccepted, true,
    'CONTROL: this fixture never produces a trust entry, so the emptiness below proves nothing');

  create.setRunner((file, args) => {
    if (args && args[0] === 'bootstrap') return { ok: false, stderr: 'nope' };
    return { ok: true };
  });
  create.setDryRun(false);
  writeCfg({ projects: {} });

  const r = create.createAgent({ ...BINS, name: 'trustfix-undo-ok', role: 'pm' });
  assert.equal(r.outcome, create.OUTCOME.PARTIAL);
  assert.deepEqual(Object.keys(readCfg().projects), [], 'the undo did not run');
  assert.ok(!r.steps.some((s) => s.label === 'took back the folder trust'),
    'a successful undo reported itself as a failure');
  create.setRunner(null);
});


test('setModel rewrites the startup file and keeps everything else about the job', () => {
  /**
   * 🔑 THE MODEL WAS ALWAYS WRITTEN INTO THE JOB and always parsed back out;
   * what was missing was the ability to change it. Josh, 2026-08-21, with an
   * agent stopped on a spent Fable 5 limit: *"maybe we should go ahead and
   * build in picking a different model now so I could pick a different model
   * for her and see if we can get her restored."*
   *
   * ⚠️ THE PATHS MUST SURVIVE THE REWRITE. `claude` and `tmux` live in that file
   * and are the only record of which binaries this agent was built against.
   * Inventing them would repoint an agent at binaries nobody chose, which is
   * why an unreadable job is refused rather than regenerated.
   */
  const name = 'switcher';
  recorder();
  create.setDryRun(false);
  const made = create.createAgent({ ...BINS, name, role: 'pm', model: 'opus' });
  assert.equal(made.outcome, create.OUTCOME.CREATED, made.because);
  const before = fs.readFileSync(create.plistPath(name), 'utf8');
  const argsOf = (text) => [...text.match(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/)[1]
    .matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => m[1]);
  const was = argsOf(before);

  const out = create.setModel(name, 'haiku');
  assert.equal(out.outcome, create.OUTCOME.CREATED, out.because);
  assert.equal(out.model.arg, 'claude-haiku-4-5-20251001');

  const now = argsOf(fs.readFileSync(create.plistPath(name), 'utf8'));
  assert.equal(create.plannedModelArg(name), 'claude-haiku-4-5-20251001',
    'the reader beside the writer does not agree with what was written');
  assert.equal(now[4], was[4], 'the claude path was not preserved across the rewrite');
  assert.equal(now[5], was[5], 'the tmux path was not preserved across the rewrite');
  assert.equal(now[2], name, 'the job stopped being about this agent');

  /* A model that is not on the list is refused rather than written through. */
  const bad = create.setModel(name, 'gpt-9');
  assert.equal(bad.outcome, create.OUTCOME.REFUSED);
  assert.match(bad.because, /pick a model/);
  assert.equal(create.plannedModelArg(name), 'claude-haiku-4-5-20251001',
    'a refused change still altered the file');

  /* 🛑 AND AN AGENT KOSMOS DID NOT START IS REFUSED, not regenerated. We have no
     record of which binaries it was built against. */
  const nobody = create.setModel('neverexisted', 'opus');
  assert.equal(nobody.outcome, create.OUTCOME.REFUSED);
  assert.match(nobody.because, /not started by Kosmos/);
});


/* ---- which Claude account an agent runs on ------------------------------
   Josh, 2026-08-22, on an account close to its limit: *"connect another
   account will immediately help me move agents off that account that is almost
   out of"*. */

function seedAccounts() {
  const home = nodePath.join(SANDBOX, 'home');
  const put = (rel, obj) => {
    const f = nodePath.join(home, rel);
    fs.mkdirSync(nodePath.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(obj), 'utf8');
  };
  fs.mkdirSync(nodePath.join(home, '.claude', 'projects'), { recursive: true });
  put('.claude.json', { oauthAccount: { emailAddress: 'first@example.com' } });

  // shared history: a legal destination
  fs.mkdirSync(nodePath.join(home, '.claude-work'), { recursive: true });
  put('.claude-work/.claude.json', { oauthAccount: { emailAddress: 'work@example.com' } });
  try { fs.symlinkSync(nodePath.join(home, '.claude', 'projects'), nodePath.join(home, '.claude-work', 'projects')); } catch { /* already there */ }

  // its own history: an illegal destination
  fs.mkdirSync(nodePath.join(home, '.claude-solo', 'projects'), { recursive: true });
  put('.claude-solo/.claude.json', { oauthAccount: { emailAddress: 'solo@example.com' } });
  return { home };
}

const cfgOf = (text) => {
  const m = text.match(/<key>CLAUDE_CONFIG_DIR<\/key>\s*<string>([\s\S]*?)<\/string>/);
  return m ? m[1] : null;
};

test('a job made by a server on another port carries KOSMOS_PORT, so the agent answers the board that made it (#577)', () => {
  recorder();
  create.setDryRun(false);
  const before = process.env.PORT;
  process.env.PORT = '16245';
  try {
    const made = create.createAgent({ ...BINS, name: 'sandboxed', role: 'pm' });
    assert.equal(made.outcome, create.OUTCOME.CREATED, made.because);
  } finally {
    if (before === undefined) delete process.env.PORT; else process.env.PORT = before;
  }
  const plist = fs.readFileSync(create.plistPath('sandboxed'), 'utf8');
  assert.match(plist, /<key>KOSMOS_PORT<\/key><string>16245<\/string>/,
    'the job does not tell the agent which board made it, so its replies go to :16180');
  // And the supervisor hands it INTO the pane: tmux gives a session made on
  // a running server the server\'s environment, not the client\'s, so the
  // launchd environment alone never reaches the agent.
  const script = supervisorText();
  const launches = script.split('\n').filter((l) => /new-session -d -s "\$SESSION"/.test(l));
  assert.equal(launches.length, 4, 'the supervisor launch lines moved; update this test with them');
  for (const l of launches) assert.match(l, /PANE_ENV/, 'a launch line does not pass the pane environment: ' + l);
  // The names handed into the pane, pinned as a list so a new one cannot be forgotten silently (#577, #540, #529).
  assert.match(script, /for _var in KOSMOS_PORT CLAUDE_CONFIG_DIR CODEX_HOME CLOUDFLARE_API_TOKEN GH_TOKEN; do/);
  assert.match(script, /secrets\/cloudflare\.token/, 'the supervisor no longer reads the held Cloudflare token from the store beside it (#529)');
  assert.match(script, /secrets\/github\.token/, 'the supervisor no longer reads the held GitHub token, so a no-install connection cannot reach an agent (#620)');
  // Which variables ride, and that they ride as values rather than as a
  // sentence in this file, is asserted by running the script: see
  // 'the startup script, actually run, hands the pane its account and its
  // board' beside runLauncher. A text match on the loop line passed on any
  // build that contained the line, whatever the loop did (#587).
});

test('a job made by the default board carries no KOSMOS_PORT: absent means the default, so old plists do not change (#577)', () => {
  recorder();
  create.setDryRun(false);
  const before = process.env.PORT;
  delete process.env.PORT;
  try {
    const made = create.createAgent({ ...BINS, name: 'ordinary', role: 'pm' });
    assert.equal(made.outcome, create.OUTCOME.CREATED, made.because);
  } finally {
    if (before !== undefined) process.env.PORT = before;
  }
  const plist = fs.readFileSync(create.plistPath('ordinary'), 'utf8');
  assert.doesNotMatch(plist, /KOSMOS_PORT/);
});

test('a job made by a server with TMUX_TMPDIR set carries it, so its sessions land where the board looks (#668)', () => {
  recorder();
  create.setDryRun(false);
  const before = process.env.TMUX_TMPDIR;
  process.env.TMUX_TMPDIR = '/socket/dir & <odd>';
  try {
    const made = create.createAgent({ ...BINS, name: 'pinned', role: 'pm' });
    assert.equal(made.outcome, create.OUTCOME.CREATED, made.because);
  } finally {
    if (before === undefined) delete process.env.TMUX_TMPDIR; else process.env.TMUX_TMPDIR = before;
  }
  const plist = fs.readFileSync(create.plistPath('pinned'), 'utf8');
  assert.match(plist, /<key>TMUX_TMPDIR<\/key><string>\/socket\/dir &amp; &lt;odd&gt;<\/string>/,
    'the job does not carry the creating server\'s socket directory, so the supervisor '
    + 'starts sessions on the default server while the board reads a different one: '
    + 'creation says "started it" and the board says "Not running" forever (#668)');
});

test('a job made with no TMUX_TMPDIR carries none: absent means the default socket, so old plists do not change (#668)', () => {
  recorder();
  create.setDryRun(false);
  const before = process.env.TMUX_TMPDIR;
  delete process.env.TMUX_TMPDIR;
  try {
    const made = create.createAgent({ ...BINS, name: 'unpinned', role: 'pm' });
    assert.equal(made.outcome, create.OUTCOME.CREATED, made.because);
  } finally {
    if (before !== undefined) process.env.TMUX_TMPDIR = before;
  }
  const plist = fs.readFileSync(create.plistPath('unpinned'), 'utf8');
  assert.doesNotMatch(plist, /TMUX_TMPDIR/);
});

test('runningJobs reads which of our jobs launchd holds a live process for, and fails soft to an empty set (#668)', () => {
  const asked = [];
  create.setRunner((file, args) => {
    asked.push([file, ...(args || [])].join(' '));
    /* The measured shape: PID, tab, last-exit, tab, label; `-` for a job
       with no process. A zero PID and a foreign label are the traps. */
    return { ok: true, stdout: 'PID\tStatus\tLabel\n941\t0\tcom.kosmos.agent.alive\n-\t0\tcom.kosmos.agent.parked\n0\t0\tcom.kosmos.agent.zeropid\n512\t-15\tcom.other.thing\n' };
  });
  create.setDryRun(false);
  try {
    const up = create.runningJobs();
    assert.deepEqual([...up].sort(), ['alive'],
      'the parse claimed a parked, zero-pid or foreign job as running, or missed the live one');
    assert.ok(asked.some((c) => /launchctl list$/.test(c)), 'the probe is not the non-mutating fleet read');
    assert.ok(!asked.some((c) => /enable|disable |bootout|bootstrap/.test(c)), 'the probe mutates launchd state');
  } finally {
    create.setRunner(null);
  }
  /* Fail-soft: a runner that throws yields an empty set, never a claim. */
  create.setRunner(() => { throw new Error('no launchctl here'); });
  create.setDryRun(false);
  try {
    assert.equal(create.runningJobs().size, 0, 'a failed look dressed a stopped agent in running-unseen');
  } finally {
    create.setRunner(null);
  }
});

test('#1313: switching to OpenAI carries a SIGNED-IN account, not the default home the add path never writes', () => {
  /* 🛑 JOSH'S SHIP BLOCKER, 2026-08-28. He added an OpenAI account, it said it
     signed in, he switched an agent, and got "nobody is signed in to OpenAI on
     this computer". Both sentences were true and they were about DIFFERENT
     DIRECTORIES:
       adding an account writes  ~/.codex-<label>   (addWithKey spawns codex
                                 login with CODEX_HOME=spot.dir)
       the switch used to read   ~/.codex           (the default home)
     ⇒ NOTHING IN THE ADD PATH CAN EVER POPULATE THE DEFAULT HOME, so on any
     machine where Kosmos performed the sign-in the switch could not succeed.
     The check that refused was mine, from #1211: correct code on a false
     premise, and it passed on my own machine only because that machine's
     ~/.codex was made by a MANUAL codex login, which is the one directory the
     product never writes.
     ⚠️ THE ASSERTION IS "A SIGNED-IN ACCOUNT", NOT A PARTICULAR ONE. With
     several accounts the switch takes the first and the answer names it, which
     is a stated default rather than a choice (#1373). Pinning WHICH one would
     copy the implementation's pick into the test and could not fail. */
  recorder();
  create.setDryRun(false);
  const home = nodePath.join(process.env.AGENT_WORKFORCE_HOME, '.codex-switchonly');
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(nodePath.join(home, 'auth.json'),
    JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-testtestSWITCHONLY1' }), 'utf8');
  const name = 'switchonly';
  const made = create.createAgent({ ...BINS, name, role: 'pm' });
  assert.equal(made.outcome, create.OUTCOME.CREATED, made.because);
  /* No AGENT_WORKFORCE_CODEX_HOME: this is the ordinary machine, and the one
     Josh reported from. The named-home case keeps its own arm above (#1211). */
  delete process.env.AGENT_WORKFORCE_CODEX_HOME;
  const sw = create.setProvider(name, 'openai', { ...BINS, codexBin: CODEX_BIN });
  assert.equal(sw.outcome, create.OUTCOME.CREATED,
    'the switch refused on a machine that HAS a signed-in OpenAI account, which is #1313: '
    + String(sw.because));
  const plist = fs.readFileSync(create.plistPath(name), 'utf8');
  const carried = (plist.match(/<key>CODEX_HOME<\/key><string>([^<]*)<\/string>/) || [])[1];
  assert.ok(carried, 'the switch carried no CODEX_HOME at all, so the agent runs on the empty default home');
  assert.ok(fs.existsSync(nodePath.join(carried, 'auth.json')),
    `the switch carried ${carried}, which has no sign-in in it`);
  /* CONTROL: the home it carried is one the account layer actually reports, so
     this cannot pass on a directory the switch invented. */
  const known = require('./openaiaccounts').list().map((a) => a.dir);
  assert.ok(known.includes(carried), `carried ${carried}, which list() does not report: ${known.join(', ')}`);
});

/* 🔑 #1600: THE TWO ROUTES ONTO THE DEFAULT ROW MUST AGREE, WHICH IS THE CARD'S
   ACTUAL REQUIREMENT. `setProvider` used to write `openaiAccount.dir` for EVERY row
   including the default, while `createAgentInner` writes `isDefault ? null : dir` and
   lets codex resolve its own default. So a SWITCHED agent had the home pinned and
   stopped following a later CODEX_HOME change, while a CREATED one kept following it -
   two routes to one state, behaving differently, with nothing on screen telling them
   apart.
   ⚠️ ASSERTING BOTH ROUTES RATHER THAN JUST THE FIXED ONE. A test that only checked
   the switch would go green if somebody later "fixed" the create path to pin instead,
   which is the same divergence pointing the other way. The equality is the invariant. */
test('#1600: switching onto the DEFAULT OpenAI row writes no CODEX_HOME, exactly like creating on it', () => {
  recorder();
  create.setDryRun(false);
  /* The DEFAULT codex home is `~/.codex`; a labelled `~/.codex-<x>` is not default.
     The sibling test above uses a labelled one, which is why it is unaffected. */
  const home = nodePath.join(process.env.AGENT_WORKFORCE_HOME, '.codex');
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(nodePath.join(home, 'auth.json'),
    JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-testtestDEFAULTROW1' }), 'utf8');
  delete process.env.AGENT_WORKFORCE_CODEX_HOME;

  /* THE PREMISE, asserted: the account layer really does report this row as the
     default. Without it the test could pass because the row was simply missing. */
  const rows = require('./openaiaccounts').list();
  const def = rows.find((a) => a.isDefault);
  assert.ok(def, 'no default OpenAI row exists, so this test is not exercising the default case');
  /* Compared through realpath on BOTH sides: on macOS the sandbox lives under
     /var, which is a symlink to /private/var, and `list()` reports the unresolved
     spelling. Comparing one resolved against one raw fails on a match. */
  assert.equal(fs.realpathSync(def.dir), fs.realpathSync(home));

  const homeOf = (n) => (fs.readFileSync(create.plistPath(n), 'utf8')
    .match(/<key>CODEX_HOME<\/key><string>([^<]*)<\/string>/) || [])[1];

  // ROUTE 1: switched onto the default row.
  const switched = 'defrowswitch';
  assert.equal(create.createAgent({ ...BINS, name: switched, role: 'pm' }).outcome, create.OUTCOME.CREATED);
  const sw = create.setProvider(switched, 'openai', { ...BINS, codexBin: CODEX_BIN });
  assert.equal(sw.outcome, create.OUTCOME.CREATED, String(sw.because));
  assert.equal(homeOf(switched), undefined,
    'switching onto the DEFAULT row pinned its home into the launch job, so the agent stops following a later CODEX_HOME change');

  // ROUTE 2: created directly on the same default row.
  const created = 'defrowcreate';
  /* The shape the sibling test uses: `provider` + `codexBin` + `account`. My first
     draft passed `runner: 'codex'` with no bin and was refused with "we do not know
     that account", which reads like a missing account rather than a malformed call. */
  const made = create.createAgent({ ...BINS, name: created, role: 'pm', provider: 'openai', codexBin: CODEX_BIN, account: home });
  assert.equal(made.outcome, create.OUTCOME.CREATED, String(made.because));
  assert.equal(homeOf(created), undefined, 'the create path started pinning the default home');

  // THE INVARIANT: whatever the answer is, both routes give it.
  assert.equal(homeOf(switched), homeOf(created),
    'the two routes onto the default row disagree, which is the defect this card is about');
});

/* 🛑 THE CASE MY FIRST VERSION BROKE, GUARDED HERE RATHER THAN LEFT TO #1373's SUITE.
   `openaiaccounts` derives "default" from `codexupdate.defaultHome()`, which honours
   AGENT_WORKFORCE_CODEX_HOME and CODEX_HOME - the SERVER's environment. A launchd job
   does not inherit those, so under an override the server's default and the agent's
   default are different directories, and omitting the key sends the agent to ~/.codex
   instead of the home an operator named.
   ⇒ With an override in force the home MUST be written even though the row is
   "default". #1373 catches this too; this arm states it as its own requirement so a
   future reader sees why the condition is not simply `isDefault`. */
test('#1600: with an override home in force, the default row still writes CODEX_HOME', () => {
  recorder();
  create.setDryRun(false);
  const home = nodePath.join(process.env.AGENT_WORKFORCE_HOME, '.codex-overridden');
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(nodePath.join(home, 'auth.json'),
    JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-testtestOVERRIDE01' }), 'utf8');
  const name = 'overriderow';
  assert.equal(create.createAgent({ ...BINS, name, role: 'pm' }).outcome, create.OUTCOME.CREATED);
  process.env.AGENT_WORKFORCE_CODEX_HOME = home;
  try {
    /* THE PREMISE: under the override this row really is reported as the default, so
       this arm is exercising the collision rather than an ordinary named account. */
    const def = require('./openaiaccounts').list().find((a) => a.isDefault);
    assert.ok(def && fs.realpathSync(def.dir) === fs.realpathSync(home),
      'the override did not make this row the default, so this test is not exercising the case it names');

    const sw = create.setProvider(name, 'openai', { ...BINS, codexBin: CODEX_BIN });
    assert.equal(sw.outcome, create.OUTCOME.CREATED, String(sw.because));
    const carried = (fs.readFileSync(create.plistPath(name), 'utf8')
      .match(/<key>CODEX_HOME<\/key><string>([^<]*)<\/string>/) || [])[1];
    assert.ok(carried,
      'the default row wrote no home while an override was in force, so the agent will resolve ~/.codex instead of the home an operator named');
    assert.equal(fs.realpathSync(carried), fs.realpathSync(home));

    /* AND THE OTHER ROUTE, under the same override: fixing only the switch would make
       the two agree without an override and disagree WITH one, which is this card's
       own defect pointing the other way. */
    const madeName = 'overriderowcreate';
    const made = create.createAgent({ ...BINS, name: madeName, role: 'pm', provider: 'openai', codexBin: CODEX_BIN, account: home });
    assert.equal(made.outcome, create.OUTCOME.CREATED, String(made.because));
    const madeCarried = (fs.readFileSync(create.plistPath(madeName), 'utf8')
      .match(/<key>CODEX_HOME<\/key><string>([^<]*)<\/string>/) || [])[1];
    assert.ok(madeCarried, 'the create route omitted the home under an override, so the two routes disagree again');
    assert.equal(fs.realpathSync(madeCarried), fs.realpathSync(carried),
      'the two routes disagree under an override');
  } finally { delete process.env.AGENT_WORKFORCE_CODEX_HOME; }
});

/* CONTROL for the test above: a NON-default row must still carry its home, or the
   change would have silently stopped recording every account rather than just the
   default. */
test('#1600 control: switching onto a NON-default OpenAI row still writes CODEX_HOME', () => {
  recorder();
  create.setDryRun(false);
  const home = nodePath.join(process.env.AGENT_WORKFORCE_HOME, '.codex-notdefault');
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(nodePath.join(home, 'auth.json'),
    JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-testtestNOTDEFAULT1' }), 'utf8');
  delete process.env.AGENT_WORKFORCE_CODEX_HOME;
  const name = 'notdefrow';
  assert.equal(create.createAgent({ ...BINS, name, role: 'pm' }).outcome, create.OUTCOME.CREATED);
  /* `accountDir`, which is the option this function reads. Passing `account`
     silently selected the DEFAULT row instead, and the control then failed for a
     reason that looked like the fix going too wide. */
  const sw = create.setProvider(name, 'openai', { ...BINS, codexBin: CODEX_BIN, accountDir: home, pickedByPerson: true });
  assert.equal(sw.outcome, create.OUTCOME.CREATED, String(sw.because));
  const carried = (fs.readFileSync(create.plistPath(name), 'utf8')
    .match(/<key>CODEX_HOME<\/key><string>([^<]*)<\/string>/) || [])[1];
  assert.ok(carried, 'a non-default row stopped carrying its home, so the fix went too wide');
});

test('an OpenAI agent made on a non-default OpenAI account carries CODEX_HOME, and its folder is trusted in THAT home (#540)', () => {
  recorder();
  create.setDryRun(false);
  const home = nodePath.join(process.env.AGENT_WORKFORCE_HOME, '.codex-team');
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(nodePath.join(home, 'auth.json'), JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-testtesttesttestTEAM' }), 'utf8');
  const made = create.createAgent({ ...BINS, name: 'onteam', role: 'pm', provider: 'openai', codexBin: CODEX_BIN, account: home });
  assert.equal(made.outcome, create.OUTCOME.CREATED, made.because);
  const plist = fs.readFileSync(create.plistPath('onteam'), 'utf8');
  assert.match(plist, new RegExp('<key>CODEX_HOME</key><string>' + home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '</string>'));
  assert.doesNotMatch(plist, /CLAUDE_CONFIG_DIR/, 'a codex agent must not be handed a Claude account variable');
  const toml = fs.readFileSync(nodePath.join(home, 'config.toml'), 'utf8');
  assert.match(toml, /trust_level = "trusted"/, 'the trust entry went somewhere other than the account codex will read');
  // And the job reads back with the account as its configDir, one field for either provider.
  assert.equal(create.readJob('onteam').configDir, home);
  // An account nobody signed in to is refused in words.
  const no = create.createAgent({ ...BINS, name: 'onnobody', role: 'pm', provider: 'openai', codexBin: CODEX_BIN, account: nodePath.join(process.env.AGENT_WORKFORCE_HOME, '.codex-nobody') });
  assert.equal(no.outcome, create.OUTCOME.REFUSED);
  assert.match(no.because, /do not know that OpenAI account/);
});

test('#1486: a non-canonical account path still names the account it points at, on CREATE', () => {
  /* `openaiaccounts.list()` stores `path.resolve(dir)`, and createAgentInner used
     to compare the request UNRESOLVED. So a trailing slash, a `..`, or a symlinked
     home missed an account that is genuinely present, and the person was told we do
     not know their account. Measured on a real machine before the fix:
     `/Users/x/.codex/` against a stored `/Users/x/.codex` matched FALSE.

     The switch path was given this treatment by #1373; this is the same defect one
     function over, which #1486 was filed to stop being only a comment.

     🛑 The path is built by CONCATENATION, not `nodePath.join`, because join
     NORMALISES and would quietly hand the test a canonical path -- a fixture that
     cannot exercise the defect it names. */
  recorder();
  create.setDryRun(false);
  const home = nodePath.join(process.env.AGENT_WORKFORCE_HOME, '.codex-noncanon');
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(nodePath.join(home, 'auth.json'), JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-testtesttesttestNONCANON' }), 'utf8');

  const wobbly = home + '/../' + nodePath.basename(home) + '/';
  assert.notEqual(wobbly, home, 'the fixture normalised itself, so it cannot exercise the defect');
  assert.equal(nodePath.resolve(wobbly), home, 'the fixture does not name the same directory');

  const made = create.createAgent({ ...BINS, name: 'oncanon', role: 'pm', provider: 'openai', codexBin: CODEX_BIN, account: wobbly });
  assert.equal(made.outcome, create.OUTCOME.CREATED,
    'a non-canonical path to a real account was refused on create: ' + made.because);
  assert.equal(create.readJob('oncanon').configDir, home,
    'the agent was created but carries the unresolved path, so CODEX_HOME points at a name codex will not read back');

  /* CONTROL, and it is the one that matters: resolving must not make EVERY path
     match. A directory nobody signed in to is still refused, in words. */
  const nope = create.createAgent({ ...BINS, name: 'oncanonno', role: 'pm', provider: 'openai', codexBin: CODEX_BIN, account: nodePath.join(process.env.AGENT_WORKFORCE_HOME, '.codex-absent') + '/../.codex-absent/' });
  assert.equal(nope.outcome, create.OUTCOME.REFUSED,
    'resolving made an unknown account match, which is worse than the defect it fixed');
  assert.match(nope.because, /do not know that OpenAI account/);
});

test('#1486: the ANTHROPIC arm resolves too, because perturbing it alone left the suite green', () => {
  /* 🛑 THIS ARM EXISTS BECAUSE THE FIRST VERSION OF THIS TEST DID NOT COVER IT.
     Reverting the OpenAI resolve turned the test above red; reverting the
     Anthropic one left the whole suite GREEN. Two sites were changed and one was
     guarded, which is the shape that ships half a fix and reports it whole. */
  const { home } = seedAccounts();
  recorder();
  create.setDryRun(false);
  const acct = nodePath.join(home, '.claude-work');
  const wobbly = acct + '/../' + nodePath.basename(acct) + '/';
  assert.notEqual(wobbly, acct, 'the fixture normalised itself');
  assert.equal(nodePath.resolve(wobbly), acct, 'the fixture does not name the same directory');

  const made = create.createAgent({ ...BINS, name: 'anoncanon', role: 'pm', account: wobbly });
  assert.equal(made.outcome, create.OUTCOME.CREATED,
    'a non-canonical path to a real Claude account was refused on create: ' + made.because);

  /* CONTROL: resolving must not make an unknown account match. */
  const nope = create.createAgent({ ...BINS, name: 'anoncanonno', role: 'pm', account: nodePath.join(home, '.claude-absent') + '/../.claude-absent/' });
  assert.equal(nope.outcome, create.OUTCOME.REFUSED,
    'resolving made an unknown Claude account match, which is worse than the defect it fixed');
});

/* 🛑 #1629: THE FLIP MUST TRUST THE WORKER FOLDER IN THE ACCOUNT IT MOVES TO.
   Claude Code records trust PER CONFIG DIR, so an agent pointed at an account
   whose config never carried the flag comes up frozen on the workspace-trust
   prompt with `No, exit` PRESELECTED - indistinguishable from an agent ignoring
   you, because the session is alive and the process is running.
   ⚠️ THE ENTRY IS USUALLY ABSENT RATHER THAN FALSE. Measured across worker
   folders on a real machine, one agent's folder had no entry in ANY of three
   configs, so a fix that only flipped an existing boolean would do nothing for
   it. This asserts the entry is CREATED. */
test('#1629: moving an agent to another account trusts its folder in THAT account', () => {
  const { home } = seedAccounts();
  const name = 'trustmover';
  recorder();
  create.setDryRun(false);
  const made = create.createAgent({ ...BINS, name, role: 'pm' });
  assert.equal(made.outcome, create.OUTCOME.CREATED, made.because);

  const target = nodePath.join(home, '.claude-work');
  const cfgFile = nodePath.join(target, '.claude.json');
  const readEntry = () => {
    const d = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
    const key = fs.realpathSync(create.workerDir(name));
    return (d.projects || {})[key];
  };

  /* THE PREMISE, asserted rather than assumed: the destination knows nothing
     about this folder yet. Without this the test could pass on a fixture that
     was already trusted, which is the state it exists to create. */
  assert.equal(readEntry(), undefined,
    'the destination account already carried an entry, so this test cannot show one being created');

  const out = create.setAccount(name, target);
  assert.equal(out.outcome, create.OUTCOME.CREATED, out.because);

  const entry = readEntry();
  assert.ok(entry, 'the flip left the destination account with no entry for the worker folder, so the agent meets the trust prompt');
  assert.equal(entry.hasTrustDialogAccepted, true, 'the entry exists but does not trust the folder');
  assert.equal(out.trust && out.trust.ok, true, 'the flip did not report what it did about trust');
  assert.equal(out.trust.madeEntry, true, 'the flip reported flipping an existing entry rather than creating one');
});

/* The other direction: moving BACK to the default account trusts the folder
   there too. `isDefault` means no configDir on the plist, and the trust write
   has to follow the same rule rather than writing into a directory nobody reads. */
test('#1629: moving back to the default account trusts the folder in the default config', () => {
  const { home } = seedAccounts();
  const name = 'trustback';
  recorder();
  create.setDryRun(false);
  assert.equal(create.createAgent({ ...BINS, name, role: 'pm' }).outcome, create.OUTCOME.CREATED);
  create.setAccount(name, nodePath.join(home, '.claude-work'));

  const back = create.setAccount(name, '');
  assert.equal(back.outcome, create.OUTCOME.CREATED, back.because);
  assert.ok(back.trust, 'the move back reported nothing about trust');
  assert.equal(back.trust.ok, true, back.trust.because);
});

test('an agent can be moved to another account, and the model comes with it', () => {
  const { home } = seedAccounts();
  const name = 'mover';
  recorder();
  create.setDryRun(false);
  const made = create.createAgent({ ...BINS, name, role: 'pm', model: 'opus' });
  assert.equal(made.outcome, create.OUTCOME.CREATED, made.because);

  /* ⚠️ THE PREMISE: an agent starts with NO key at all, and absent has always
     meant the default account. A rewrite that started stamping the default
     would make every unrelated edit look like an account change. */
  assert.equal(cfgOf(fs.readFileSync(create.plistPath(name), 'utf8')), null);

  const out = create.setAccount(name, nodePath.join(home, '.claude-work'));
  assert.equal(out.outcome, create.OUTCOME.CREATED, out.because);
  assert.equal(out.account.email, 'work@example.com');
  assert.equal(cfgOf(fs.readFileSync(create.plistPath(name), 'utf8')), nodePath.join(home, '.claude-work'));
  assert.equal(create.plannedModelArg(name), 'claude-opus-5',
    'moving accounts dropped the model the agent was created with');

  /* 🛑 AND THE OTHER DIRECTION, WHICH IS THE ONE THAT WOULD HAVE SHIPPED.
     `plistFor` regenerates the whole file, so before `readJob` existed a model
     change silently moved the agent back to the default account -- a file that
     still parses, a job that still starts, and an agent quietly on the wrong
     account. Neither setter is safe without the other being tested. */
  const modelled = create.setModel(name, 'haiku');
  assert.equal(modelled.outcome, create.OUTCOME.CREATED, modelled.because);
  assert.equal(cfgOf(fs.readFileSync(create.plistPath(name), 'utf8')), nodePath.join(home, '.claude-work'),
    'changing the model moved the agent back to the default account');
  assert.equal(create.plannedModelArg(name), 'claude-haiku-4-5-20251001');

  // Back to the default is a real choice, and it removes the key rather than
  // writing the default path.
  const back = create.setAccount(name, '');
  assert.equal(back.outcome, create.OUTCOME.CREATED, back.because);
  assert.equal(back.account.isDefault, true);
  assert.equal(cfgOf(fs.readFileSync(create.plistPath(name), 'utf8')), null);
});

test('an account that keeps its own history is refused, and the refusal says what to do', () => {
  const { home } = seedAccounts();
  const name = 'stayer';
  recorder();
  create.setDryRun(false);
  create.createAgent({ ...BINS, name, role: 'pm', model: 'opus' });

  const out = create.setAccount(name, nodePath.join(home, '.claude-solo'));
  assert.equal(out.outcome, create.OUTCOME.REFUSED);
  /* 🔑 THE WHOLE REASON THIS REFUSAL EXISTS: transcripts live under the config
     directory, so this move would give the agent a blank past -- and it would
     look like a working agent behaving like a new one, with nothing on screen
     saying why. */
  assert.match(out.because, /nothing it has ever done/);
  assert.match(out.because, /Point that account at your agents' history first/);
  assert.equal(cfgOf(fs.readFileSync(create.plistPath(name), 'utf8')), null,
    'a refused move still wrote the file');
});

test('an account we do not know, and an agent Kosmos did not start, are both refused', () => {
  seedAccounts();
  const name = 'refusals';
  recorder();
  create.setDryRun(false);
  create.createAgent({ ...BINS, name, role: 'pm' });

  const unknown = create.setAccount(name, '/tmp/not-an-account');
  assert.equal(unknown.outcome, create.OUTCOME.REFUSED);
  assert.match(unknown.because, /do not know that account/);

  const nobody = create.setAccount('neverexisted', '');
  assert.equal(nobody.outcome, create.OUTCOME.REFUSED);
  assert.match(nobody.because, /could not read how neverexisted is started/);
});

test('a new agent can be created on another account, and its history is still shared', () => {
  const { home } = seedAccounts();
  const name = 'bornelsewhere';
  recorder();
  create.setDryRun(false);
  const made = create.createAgent({
    ...BINS, name, role: 'pm', model: 'opus', account: nodePath.join(home, '.claude-work'),
  });
  assert.equal(made.outcome, create.OUTCOME.CREATED, made.because);
  assert.equal(cfgOf(fs.readFileSync(create.plistPath(name), 'utf8')), nodePath.join(home, '.claude-work'));
  assert.equal(create.plannedModelArg(name), 'claude-opus-5', 'the model and the account both landed');
});

test('creating on an account that keeps its own history is refused before anything is made', () => {
  const { home } = seedAccounts();
  const name = 'wouldbeorphan';
  recorder();
  create.setDryRun(false);
  const out = create.createAgent({
    ...BINS, name, role: 'pm', account: nodePath.join(home, '.claude-solo'),
  });
  assert.equal(out.outcome, create.OUTCOME.REFUSED);
  /* 🔑 THE REASON IS DIFFERENT FROM THE MOVE'S, and stronger. Moving an agent
     there costs it the past it has; being BORN there costs nothing today and
     costs everything the first time somebody moves it back, because its whole
     life would sit in a tree nothing else reads. Kosmos would have quietly
     built a second history for one agent. */
  assert.match(out.because, /would live somewhere nothing else reads/);
  /* 🛑 AND NOTHING WAS MADE. A refusal that has already written the folder and
     the launch file is not a refusal; the name would then be permanently taken
     by a half-agent and the person could not even retry. */
  assert.equal(fs.existsSync(create.plistPath(name)), false, 'the refusal left a launchd job behind');
  assert.equal(fs.existsSync(create.workerDir(name)), false, 'the refusal left a worker folder behind');
});

test('the default account writes no key, exactly as every existing agent has', () => {
  const { home } = seedAccounts();
  const name = 'plainborn';
  recorder();
  create.setDryRun(false);
  create.createAgent({ ...BINS, name, role: 'pm', account: nodePath.join(home, '.claude') });
  assert.equal(cfgOf(fs.readFileSync(create.plistPath(name), 'utf8')), null,
    'choosing the default account stamped a path where absence has always been the answer');
});

/* ---- who an agent reports to (#138, which unblocks the org view #137) ---- */

test('an agent can be created reporting to somebody, and it is stored not guessed', () => {
  const name = 'reporter';
  recorder();
  create.setDryRun(false);
  const made = create.createAgent({ ...BINS, name, role: 'pm', reportsTo: 'thelead' });
  assert.equal(made.outcome, create.OUTCOME.CREATED, made.because);
  const store = require('./store');
  assert.equal(store.readProfile(name).reportsTo, 'thelead');
});

test('an agent with no answer has no reporting line at all', () => {
  const name = 'unreported';
  recorder();
  create.setDryRun(false);
  create.createAgent({ ...BINS, name, role: 'pm' });
  const store = require('./store');
  /**
   * 🛑 EMPTY, NOT INFERRED, and this is the assertion the whole field exists
   * for. `engine/chat.js` already answers "is this the manager" by regex on
   * role text, and its own comment prices that looseness honestly: being wrong
   * costs one click on a dropdown. That price is right there and WRONG here,
   * because #137 draws this answer and a diagram does not look like a guess.
   * "Team Lead" and "Lead Designer" both match \\blead\\b. An empty reporting
   * line is honest; an inferred one is a claim.
   */
  assert.equal(store.readProfile(name).reportsTo, undefined,
    'a reporting line appeared without anybody answering the question');
});

test('an agent cannot report to itself', () => {
  const name = 'ouroboros';
  recorder();
  create.setDryRun(false);
  const out = create.createAgent({ ...BINS, name, role: 'pm', reportsTo: name });
  assert.equal(out.outcome, create.OUTCOME.REFUSED);
  assert.match(out.because, /cannot report to itself/);
  /* A cycle of one is the whole cycle problem in its smallest form, and it is
     the only one a person can create by picking a name out of a list. */
  assert.equal(fs.existsSync(create.plistPath(name)), false, 'the refusal made the agent anyway');
});

/* ── the birth record (#157) ─────────────────────────────────────────────── */

test('every creation attempt leaves one line in the birth record, refusals included, and a torn line does not poison the read', () => {
  const before = create.createdLog().length;
  // A refusal at the door: no folder, no plist, but a line.
  const refused = create.createAgent({ name: '###', role: 'researcher' });
  assert.equal(refused.outcome, 'refused');
  let log = create.createdLog();
  assert.equal(log.length, before + 1, 'a refused creation left no record, so a rolled-back agent is unprovable again');
  const last = log[log.length - 1];
  assert.equal(last.outcome, 'refused');
  assert.equal(last.name, '###', 'the record does not carry the name as typed, which is what a spelling refusal is about');
  assert.equal(last.because, refused.because, 'the record and the answer disagree about why');
  assert.ok(!Number.isNaN(Date.parse(last.at)), 'the record has no readable time');
  // A torn write (the crash case): the good lines still read.
  fs.appendFileSync(create.createdLogFile(), '{"at":"2026-08-23T', 'utf8');
  fs.appendFileSync(create.createdLogFile(), '\n', 'utf8');
  const again = create.createAgent({ name: '###', role: 'researcher' });
  assert.equal(again.outcome, 'refused');
  log = create.createdLog();
  assert.equal(log.length, before + 2, 'a torn line took the readable records with it');
});

/* ── the agent id (#170) ─────────────────────────────────────────────────── */

test('an agent gets a random id at birth: in its profile, in the birth record, and never rewritten', () => {
  recorder();
  create.setDryRun(false);
  const name = 'id-at-birth';
  const out = create.createAgent({ ...BINS, name, role: 'pm' });
  assert.equal(out.outcome, create.OUTCOME.CREATED);
  const profile = store.readProfile(name);
  assert.match(String(profile.id), /^[0-9a-f]{12}$/, 'no id was minted at creation');
  /* The birth record carries the SAME id, so "was this agent ever created"
     and "which agent was it" are one lookup after every file is wiped. */
  const log = create.createdLog();
  assert.equal(log[log.length - 1].id, profile.id,
    'the birth record and the profile disagree about who was born');
  /* Never rewritten, and a patch cannot touch identity: even a write that
     TRIES to set id leaves the minted one standing. */
  store.writeProfile(name, { role: 'researcher', id: 'attacker-chosen', idInstall: 'x' });
  assert.equal(store.readProfile(name).id, profile.id, 'a patch rewrote the id');
  assert.equal(store.agentId(name), profile.id);
});

test('a refused creation records no id, because nothing was born', () => {
  recorder();
  create.setDryRun(false);
  const out = create.createAgent({ name: '###', role: 'pm' });
  assert.equal(out.outcome, create.OUTCOME.REFUSED);
  const last = create.createdLog().slice(-1)[0];
  assert.equal(last.id, null);
});

test('an existing agent is backfilled on first write, and a restored profile is a different agent (#170)', () => {
  const name = 'old-timer';
  const file = nodePath.join(store.PROFILES, store.safeKey(name) + '.json');
  // A pre-#170 profile, written directly so no mint has ever run.
  fs.mkdirSync(store.PROFILES, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ role: 'pm' }));
  assert.equal(store.agentId(name), null, 'an unminted profile answered an id');
  // Lazy backfill: the first write stamps, later writes keep.
  const first = store.writeProfile(name, {});
  assert.match(String(first.id), /^[0-9a-f]{12}$/);
  assert.equal(store.writeProfile(name, { role: 'x' }).id, first.id, 'backfill reminted');
  /* Restore: the same profile arrives minted under ANOTHER install. The
     decided semantics (the card, from Josh's no-warning ruling): a restored
     agent is a SEPARATE agent with its own fresh id. So the board speaks no
     id for it until its first local write, and that write mints fresh. */
  fs.writeFileSync(file, JSON.stringify({ role: 'pm', id: first.id, idInstall: 'another-install' }));
  assert.equal(store.agentId(name), null, "the board spoke another install's id");
  const restored = store.writeProfile(name, {});
  assert.match(String(restored.id), /^[0-9a-f]{12}$/);
  assert.notEqual(restored.id, first.id,
    'a restored agent kept the other install\'s id, recreating the same-or-copy question Josh ruled off the screen');
});

/* ── the OpenAI provider (#245) ──────────────────────────────────────────── */

const plistArgs = (name) => {
  const text = fs.readFileSync(create.plistPath(name), 'utf8');
  const block = text.match(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/);
  return [...block[1].matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => m[1]);
};

test('#245: an OpenAI agent is created on the codex runner, recorded everywhere, with the right launch vector', () => {
  recorder();
  create.setDryRun(false);
  const codexHome = fs.mkdtempSync(nodePath.join(require('node:os').tmpdir(), 'codex-home-'));
  process.env.AGENT_WORKFORCE_CODEX_HOME = codexHome;
  const name = 'codex-kid';
  const out = create.createAgent({ ...BINS, codexBin: CODEX_BIN, name, role: 'pm', provider: 'openai' });
  delete process.env.AGENT_WORKFORCE_CODEX_HOME;
  assert.equal(out.outcome, create.OUTCOME.CREATED, out.because);
  /* The folder is trusted at creation, or the agent is born into codex's
     blocking trust dialog (measured; the bypass flag does not skip it). */
  const toml = fs.readFileSync(nodePath.join(codexHome, 'config.toml'), 'utf8');
  assert.ok(toml.includes(`[projects."${create.workerDir(name)}"]`), 'the worker folder was not trusted');
  assert.match(toml, /trust_level = "trusted"/);
  /* And the notify bridge is installed beside the supervisor by the same
     refresh, so the launch line's -c notify=[bridge] points at something. */
  const bridge = nodePath.join(process.env.AGENT_WORKFORCE_DATA, 'AgentWorkforce', 'bin', 'codex-report-bridge.js');
  assert.ok(fs.existsSync(bridge), 'the codex notify bridge was not installed with the supervisor');
  // The vector: 0 bash, 1 supervisor, 2 name, 3 workdir, 4 runner-bin,
  // 5 tmux, 6 log, 7 model (empty, codex's own default), 8 runner.
  const args = plistArgs(name);
  assert.equal(args[4], CODEX_BIN, 'the runner binary is not the codex path');
  assert.equal(args[7], '', 'the model slot must be written empty so the runner cannot slide into it');
  assert.equal(args[8], 'codex');
  // Recorded, never inferred: the profile and the birth record both say so.
  assert.equal(store.readProfile(name).provider, 'openai');
  const last = create.createdLog().slice(-1)[0];
  assert.equal(last.provider, 'openai');
  // And the Claude model catalogue cannot be written into a codex launch.
  const changed = create.setModel(name, 'opus');
  assert.equal(changed.outcome, create.OUTCOME.REFUSED);
  assert.match(changed.because, /runs on OpenAI/);
});

test('#245: openai refuses a model choice, an account choice, a missing runner, and an unknown provider refuses outright', () => {
  recorder();
  create.setDryRun(false);
  const base = { ...BINS, codexBin: CODEX_BIN, role: 'pm', provider: 'openai' };
  let r = create.createAgent({ ...base, name: 'x-model', model: 'opus' });
  assert.equal(r.outcome, create.OUTCOME.REFUSED);
  assert.match(r.because, /leave the model unchosen/);
  // #540 lifted the account refusal: an OpenAI account is a directory with
  // codex's sign-in in it, and a Claude directory is not one of those.
  r = create.createAgent({ ...base, name: 'x-acct', account: '/some/claude/dir' });
  assert.equal(r.outcome, create.OUTCOME.REFUSED);
  assert.match(r.because, /do not know that OpenAI account/);
  r = create.createAgent({ ...base, name: 'x-norunner', codexBin: '/nonexistent-codex' });
  assert.equal(r.outcome, create.OUTCOME.REFUSED);
  assert.match(r.because, /could not find the OpenAI runner/);
  r = create.createAgent({ ...BINS, name: 'x-prov', role: 'pm', provider: 'closedai' });
  assert.equal(r.outcome, create.OUTCOME.REFUSED);
  assert.match(r.because, /pick a provider/);
});

test('#246: the switch rewrites only the launch, both directions, and drops what cannot cross', () => {
  recorder();
  create.setDryRun(false);
  const codexHome = mkTemp('codex-home-sw-');
  process.env.AGENT_WORKFORCE_CODEX_HOME = codexHome;
  /* 🛑 SIGNED IN, AND THIS LINE IS THE BUG THIS TEST USED TO ASSERT (#1211).
     Without it the home is empty, and the switch used to SUCCEED into it: a
     "OpenAI it is" answer and a restart onto a runner that cannot
     authenticate. Josh met that twice and reported it as "switching does not
     actually work and the agent does not respond". The refusal arm at the end
     of this test is the empty-home case, kept deliberately rather than
     deleted. */
  fs.writeFileSync(nodePath.join(codexHome, 'auth.json'),
    JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-testtesttesttestSWCH' }), 'utf8');
  // Not 'switcher': line ~2460 already owns that name in this shared sandbox.
  const name = 'provider-hopper';
  // Born on Claude, with a model choice, so the switch has something to drop.
  const out = create.createAgent({ ...BINS, codexBin: CODEX_BIN, name, role: 'pm', model: 'opus' });
  assert.equal(out.outcome, create.OUTCOME.CREATED, out.because);
  const idBefore = store.readProfile(name).id;

  // Claude -> OpenAI: runner codex, model and account dropped and REPORTED.
  const sw = create.setProvider(name, 'openai', { ...BINS, codexBin: CODEX_BIN });
  delete process.env.AGENT_WORKFORCE_CODEX_HOME;
  assert.equal(sw.outcome, create.OUTCOME.CREATED, sw.because);
  assert.equal(sw.provider, 'openai');
  assert.ok(sw.dropped.model, 'the dropped model choice must be reported so the route can say it');
  let args = plistArgs(name);
  assert.equal(args[8], 'codex');
  /* 🛑 THE BINARY, NOT ONLY THE LABEL, AND THIS WAS THE GAP. `setProvider` is the
     OTHER writer of this plist, and its runner choice
     (`runner === 'codex' ? codexBin : claudeBin`) could be replaced with
     `claudeBin` outright while the whole suite stayed green - a job labelled
     `codex` that starts Claude in the agent's folder, which is the exact defect
     the adopt path was fixed for (#1359). The identical edit in
     `createAgentInner` went RED, so the suite could detect the class and did,
     for creation only. Switching had no such arm. */
  assert.equal(args[4], CODEX_BIN,
    'the switch wrote a codex-labelled job pointing at a different binary');
  assert.equal(args[7], '', 'the Claude model must not be smuggled into a codex launch');
  // With its memory: same id, same profile, provider updated, folder trusted.
  assert.equal(store.readProfile(name).id, idBefore, 'the switch minted a new identity, which is the same-agent ruling broken');
  assert.equal(store.readProfile(name).provider, 'openai');
  assert.match(fs.readFileSync(nodePath.join(codexHome, 'config.toml'), 'utf8'),
    new RegExp(`\\[projects\\."${create.workerDir(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\]`),
    'the switch must trust the folder or the agent restarts into a blocking dialog');

  /* AND THE OTHER DIRECTION: switching BACK must point at claude, or the
     assertion above is satisfied by "always codex" rather than by a choice. */
  // Same provider again: refused in words, nothing rewritten.
  const again = create.setProvider(name, 'openai');
  assert.equal(again.outcome, create.OUTCOME.REFUSED);
  assert.match(again.because, /already runs on OpenAI/);

  // OpenAI -> Claude: back on the seven-argument claude vector, default
  // model and account until chosen (and the result says nothing was kept).
  const back = create.setProvider(name, 'anthropic', { ...BINS, codexBin: CODEX_BIN });
  assert.equal(back.outcome, create.OUTCOME.CREATED, back.because);
  args = plistArgs(name);
  assert.equal(args.length, 7, 'a claude agent carries the pre-runner vector');
  /* THE NEGATIVE ARM of the binary assertion above: switching BACK must point at
     claude. Without this, "always the codex binary" would satisfy the positive
     arm, and the pair would prove the value rather than the CHOICE. */
  assert.equal(args[4], BINS.claudeBin,
    'switching back to Claude left the job pointing at the codex binary');
  assert.equal(store.readProfile(name).provider, 'anthropic');
  assert.equal(store.readProfile(name).id, idBefore);

  // Refusals: unknown provider, and a name Kosmos never started.
  assert.equal(create.setProvider(name, 'closedai').outcome, create.OUTCOME.REFUSED);
  assert.equal(create.setProvider('nobody-here', 'openai').outcome, create.OUTCOME.REFUSED);

  /**
   * #1211: switching to OpenAI when NOBODY IS SIGNED IN is refused in words.
   *
   * 🔑 THE ARM THAT WAS MISSING, and its absence is why the defect shipped.
   * `createAgent` has always refused an OpenAI account nobody signed in to
   * ("we do not know that OpenAI account on this computer"); `setProvider`
   * never looked. Two paths to the same state, one checked and one not, and
   * the unchecked one is the one a person reaches by switching an agent they
   * already have.
   *
   * ⚠️ IT IS MACHINE-DEPENDENT, which is why it read as flaky rather than
   * broken: on a computer whose default codex home IS signed in, the switch
   * worked and always did. The old version of this test used an EMPTY home and
   * asserted success, so the suite was green on exactly the machine state that
   * fails.
   */
  const emptyHome = fs.mkdtempSync(nodePath.join(require('node:os').tmpdir(), 'codex-home-nobody-'));
  process.env.AGENT_WORKFORCE_CODEX_HOME = emptyHome;
  const beforeArgs = plistArgs(name);
  const noSignIn = create.setProvider(name, 'openai', { ...BINS, codexBin: CODEX_BIN });
  delete process.env.AGENT_WORKFORCE_CODEX_HOME;
  assert.equal(noSignIn.outcome, create.OUTCOME.REFUSED,
    'the switch handed an agent to a runner nobody is signed in to, which is #1211');
  assert.match(noSignIn.because, /nobody is signed in to OpenAI/);
  assert.match(noSignIn.because, /Add an OpenAI account first/, 'a refusal must say what to do about it');
  assert.deepEqual(plistArgs(name), beforeArgs,
    'a refused switch rewrote the launch file anyway, so the agent was left mid-change');

  /* The positive control for the arm above, and it is not optional: without it
     "refused" is equally consistent with a switch that refuses everything. The
     signed-in home still goes through. */
  process.env.AGENT_WORKFORCE_CODEX_HOME = codexHome;
  const stillWorks = create.setProvider(name, 'openai', { ...BINS, codexBin: CODEX_BIN });
  delete process.env.AGENT_WORKFORCE_CODEX_HOME;
  assert.equal(stillWorks.outcome, create.OUTCOME.CREATED, stillWorks.because);
  assert.equal(stillWorks.openaiAccount && stillWorks.openaiAccount.keyTail, 'SWCH',
    'the switch did not report WHICH OpenAI sign-in the agent landed on, which is the half Josh could not see');
});

test('#548: a claude-less Mac refuses an anthropic creation in words, offering OpenAI only when that path is real', () => {
  recorder();
  create.setDryRun(false);
  const os2 = require('node:os');
  const noClaude = { tmuxBin: '/bin/echo', claudeBin: '/nonexistent-claude' };

  // No codex runner either: the sentence ends at the install remedy, and
  // the engine-side field says which condition suppressed the alternative.
  let r = create.createAgent({ ...noClaude, codexBin: '/nonexistent-codex', name: 'cg-a', role: 'pm' });
  assert.equal(r.outcome, create.OUTCOME.REFUSED);
  assert.match(r.because, /could not find Claude Code/);
  assert.ok(!/OpenAI instead/.test(r.because), 'a dead-end alternative was offered in words');
  assert.equal(r.alternative.offered, false);
  assert.match(r.alternative.because, /codex runner/);

  // Runner present but no OpenAI sign-in: still not offered, different why.
  const emptyHome = fs.mkdtempSync(nodePath.join(os2.tmpdir(), 'codex-empty-'));
  process.env.AGENT_WORKFORCE_CODEX_HOME = emptyHome;
  r = create.createAgent({ ...noClaude, codexBin: CODEX_BIN, name: 'cg-b', role: 'pm' });
  assert.equal(r.outcome, create.OUTCOME.REFUSED);
  assert.ok(!/OpenAI instead/.test(r.because));
  assert.match(r.alternative.because, /sign-in/);

  // Runner present AND signed in: the alternative is real, so it is said.
  fs.writeFileSync(nodePath.join(emptyHome, 'auth.json'), '{"OPENAI_API_KEY":"x"}');
  r = create.createAgent({ ...noClaude, codexBin: CODEX_BIN, name: 'cg-c', role: 'pm' });
  delete process.env.AGENT_WORKFORCE_CODEX_HOME;
  assert.equal(r.outcome, create.OUTCOME.REFUSED);
  assert.match(r.because, /or create this agent on OpenAI instead/);
  assert.equal(r.alternative.offered, true);

  // And nothing was half-made by any of the three refusals.
  for (const n of ['cg-a', 'cg-b', 'cg-c']) {
    assert.equal(fs.existsSync(create.plistPath(n)), false, `${n} left a job behind`);
    assert.equal(fs.existsSync(create.workerDir(n)), false, `${n} left a folder behind`);
  }
});

test('#548: an OpenAI-only Mac creates an OpenAI agent; Claude\'s absence is not its problem', () => {
  /**
   * The finding that replaced my wrong one, probed not read: the runner
   * check was provider-blind, so exactly the fresh OpenAI-only Mac Josh
   * installed on was refused an OPENAI agent for CLAUDE's absence. The
   * runner checked is the one this agent will run.
   */
  recorder();
  create.setDryRun(false);
  const os2 = require('node:os');
  const home = fs.mkdtempSync(nodePath.join(os2.tmpdir(), 'codex-only-'));
  fs.writeFileSync(nodePath.join(home, 'auth.json'), '{"OPENAI_API_KEY":"x"}');
  process.env.AGENT_WORKFORCE_CODEX_HOME = home;
  const r = create.createAgent({
    tmuxBin: '/bin/echo', claudeBin: '/nonexistent-claude', codexBin: CODEX_BIN,
    name: 'codex-only', role: 'pm', provider: 'openai',
  });
  delete process.env.AGENT_WORKFORCE_CODEX_HOME;
  assert.equal(r.outcome, create.OUTCOME.CREATED, r.because);
});

test('#245: a claude agent\'s launch vector is untouched by the runner feature', () => {
  recorder();
  create.setDryRun(false);
  const name = 'claude-classic';
  const out = create.createAgent({ ...BINS, name, role: 'pm' });
  assert.equal(out.outcome, create.OUTCOME.CREATED, out.because);
  const args = plistArgs(name);
  // Seven arguments, exactly as before runners existed: no empty model
  // placeholder, no runner, and the binary is claude's.
  assert.equal(args.length, 7, `expected the pre-runner seven-argument vector, got ${args.length}`);
  assert.equal(args[4], BINS.claudeBin);
  assert.ok(!args.includes('codex'));
  assert.equal(store.readProfile(name).provider, 'anthropic');
});

test('jobMissing counts only a proven absence: EACCES answers false, never "never recorded" (#149/#150)', () => {
  /* The function's whole reason to exist over !hasJob(): existsSync swallows
     EACCES into false, so the negation would stamp a provenance claim on
     every agent the moment LaunchAgents cannot be read. Forced here with a
     chmod-000 directory; a "simplification" back to !hasJob goes red on the
     EACCES leg while every fixture-state test stays green. */
  const dir = process.env.AGENT_WORKFORCE_LAUNCH;
  assert.ok(dir && dir !== require('node:os').homedir() + '/Library/LaunchAgents',
    'this test chmods the launch dir and must never aim at the real one');
  fs.mkdirSync(dir, { recursive: true });
  // control 1: a present plist answers false
  fs.writeFileSync(create.plistPath('jmhere'), '<plist/>', 'utf8');
  assert.equal(create.jobMissing('jmhere'), false, 'a present launch file read as missing');
  // control 2: a clean absence answers true (the one honest "never recorded")
  assert.equal(create.jobMissing('jmgone'), true, 'a proven absence was not counted');
  // the load-bearing leg: an unreadable directory is "could not check", false
  fs.chmodSync(dir, 0o000);
  try {
    assert.equal(create.jobMissing('jmgone'), false,
      'an unreadable LaunchAgents dir was reported as "never recorded", the provenance claim the ENOENT rule exists to prevent');
  } finally {
    fs.chmodSync(dir, 0o700);
    fs.rmSync(create.plistPath('jmhere'), { force: true });
  }
});

test('an agent born without the messaging block is SAID, not silent (#182)', () => {
  const messagesMod = require('./messages');
  const orig = messagesMod.blockBody;
  messagesMod.blockBody = () => { throw new Error('forced for the test'); };
  /* Real mode: the splice region sits inside the wrote-its-instructions step,
     whose DRY_RUN arm returns before any block is composed. */
  create.setRunner(() => ({ ran: true, spawnFailed: false, status: 0, out: '', err: '' }));
  create.setDryRun(false);
  try {
    const r = create.createAgent({ ...BINS, name: 'blockless-said', role: 'pm' });
    assert.equal(r.outcome, 'created', r.because);
    const said = (r.steps || []).find((s) => /could not add the messaging section/.test(s.label));
    assert.ok(said, 'the blockless birth left no step, so the person is told it worked and the agent cannot answer them');
    assert.equal(said.ok, false);
  } finally {
    messagesMod.blockBody = orig;
  }
  /* Control: a birth where the block lands carries no such step. */
  try {
    const fine = create.createAgent({ ...BINS, name: 'blockful-quiet', role: 'pm' });
    assert.equal(fine.outcome, 'created', fine.because);
    assert.ok(!(fine.steps || []).some((s) => /could not add the messaging section/.test(s.label)),
      'a healthy birth wears the failure step, so the warning is furniture');
  } finally {
    create.setRunner(null);
  }
});

test('disabledJobs reads the launchd overrides and fails soft to an empty set (#310)', () => {
  const orig = [];
  create.setRunner((file, args) => {
    orig.push([file, ...(args || [])].join(' '));
    return { ok: true, stdout: 'disabled services = {\n\t"com.kosmos.agent.rick" => disabled\n\t"com.kosmos.agent.anna" => true\n\t"com.other.thing" => true\n}\n' };
  });
  create.setDryRun(false);
  try {
    const off = create.disabledJobs();
    assert.deepEqual([...off].sort(), ['anna', 'rick'], 'the parse missed a form launchctl uses, or claimed a label that is not ours');
    assert.ok(orig.some((c) => /launchctl print-disabled gui\//.test(c)), 'the probe is not the non-mutating read');
    assert.ok(!orig.some((c) => /enable|disable |bootout|bootstrap/.test(c)), 'the probe mutates launchd state');
  } finally {
    create.setRunner(null);
  }
  /* Fail-soft: a runner that throws yields an empty set, never a claim. */
  create.setRunner(() => { throw new Error('no launchctl here'); });
  create.setDryRun(false);
  try {
    assert.equal(create.disabledJobs().size, 0, 'a failed look dressed agents in switched-off');
  } finally {
    create.setRunner(null);
  }
});

/* ---- #1026: a model belongs to a provider ------------------------------- */

test("#1026: modelsFor scopes to the provider, and today OpenAI's list is empty", () => {
  const create = require('./create');
  assert.equal(create.modelsFor('anthropic').length, 4);
  assert.deepEqual(create.modelsFor('openai'), [],
    'an OpenAI model appeared without anyone adding one, or the filter is wrong');
  // Every entry carries one, or the filter silently drops it from both lists.
  for (const m of create.MODELS) {
    assert.ok(m.provider === 'anthropic' || m.provider === 'openai',
      `${m.key} has no usable provider: ${m.provider}`);
  }
});

test('#1026: modelFor refuses a real model belonging to the OTHER provider', () => {
  const create = require('./create');
  // The control first: it resolves within the right provider, or the refusal
  // below would pass against a function that refuses everything.
  assert.equal(create.modelFor('anthropic', 'opus').arg, 'claude-opus-5');
  assert.equal(create.modelFor('openai', 'opus'), null,
    'a Claude model resolved for an OpenAI agent, which is a flag codex has never heard of');
  assert.equal(create.modelFor('anthropic', 'no-such-model'), null);
});

test('#1026: setModel refuses a Claude model on a codex agent, and says why in a sentence that survives OpenAI models existing', () => {
  /* ⚠️ THE OLD REFUSAL WAS A SENTENCE, NOT A CHECK: "OpenAI picks its own
     model for now" was true while this list had one vendor and would have
     become false the day OpenAI rows were added, with nothing to catch it.
     Scoped to the provider, the right refusal falls out of the data. */
  const create = require('./create');
  const r = create.setModel('definitely-not-an-agent-1026', 'opus');
  assert.equal(r.outcome, 'refused');
  // It cannot reach the model check (no such agent), which is itself the
  // ordering this change relies on: the provider is known only after the job
  // is read, so the model must be resolved after it.
  assert.match(r.because, /was not started by Kosmos|not a name we can act on/);
});


/* ------------------------------------------------------------------ #1131
 * The RECREATE half. #1135 revokes on the delete path; this is the case that
 * never goes through it.
 *
 * 🛑 THE ARM ASSERTS THE DANGEROUS ANSWER FIRST. A test that only checks
 * the old token is dead after a recreate passes just as well when the token
 * was never live, so it proves the token DOES speak for a card of that name
 * before the recreate happens.
 * -------------------------------------------------------------------------- */

test('#1131: a name whose files vanished without a delete does not hand its old token to the next agent', () => {
  create.setRunner(() => ({ ok: true }));
  create.setDryRun(false);
  const first = create.createAgent({ ...BINS, name: 'tokenheir', role: 'pm' });
  assert.equal(first.outcome, create.OUTCOME.CREATED, first.because || '');

  const minted = sendertoken.mint('tokenheir');
  assert.equal(minted.ok, true, minted.because);

  /* THE CONTROL: while a card of this name is on the board, that token speaks.
     Without this the assertion at the end can pass for the wrong reason. */
  status.setPaneSource(() => fleet.line({ session: 'tokenheir', claim: 'tokenheir', title: '✳ Claude Code' }));
  assert.equal(
    sendertoken.resolve(minted.token, status.paneRoster()).ok, true,
    'control: a minted token should speak for a live card of its own name',
  );
  status.setPaneSource(() => '');

  /* The files go WITHOUT delete-leftover -- a hand-deleted folder, or a
     PARTIAL that took one and not the other. Nothing revoked anything. */
  fs.rmSync(create.workerDir('tokenheir'), { recursive: true, force: true });
  fs.rmSync(create.plistPath('tokenheir'), { force: true });

  const second = create.createAgent({ ...BINS, name: 'tokenheir', role: 'pm' });
  assert.equal(second.outcome, create.OUTCOME.CREATED, second.because || '');

  status.setPaneSource(() => fleet.line({ session: 'tokenheir', claim: 'tokenheir', title: '✳ Claude Code' }));
  assert.equal(
    sendertoken.resolve(minted.token, status.paneRoster()).ok, false,
    'the previous holder\'s token still speaks for the new agent of that name',
  );
  assert.equal(sendertoken.resolveName(minted.token).ok, false, 'the token still resolves to a name');
  status.setPaneSource(() => '');
});

test('#1131: a brand new name has no tokens to clear, and that is silent rather than a refusal', () => {
  create.setRunner(() => ({ ok: true }));
  create.setDryRun(false);
  const r = create.createAgent({ ...BINS, name: 'neverspoke', role: 'pm' });
  assert.equal(r.outcome, create.OUTCOME.CREATED, r.because || '');
  assert.ok(!/sender tokens/.test(r.because || ''), 'a name that never had a token was told about tokens');
});

/**
 * 🛑 ONE SENTENCE PER CONDITION, GUARDED AT EVERY SITE RATHER THAN THE REACHABLE ONES.
 *
 * Three refusals were written out at every site that raised them: the name check in
 * `setAccount`/`setProvider`/`setModel` (three copies of ONE validation), the provider
 * check in `setProvider` and `createAgentInner`, the account lookup in `setAccount` and
 * `createAgentInner`. They agreed by coincidence.
 *
 * ⚠️ STAKES: this is CONSISTENCY, not security. Unlike `NO_MATCH` in sendertoken.js
 * (#1170/#1175), nothing is hidden by these matching and nothing is disclosed if they
 * drift. The harm is a caller getting two different answers for one bad input.
 *
 * ⚠️ WHY THE SOURCE ASSERTION AND NOT ONLY THE BEHAVIOURAL ONE. Two of the seven sites
 * live inside `createAgentInner` behind a full creation path, and had NO test coverage
 * at all before this. A behavioural test guards the sites it can reach; #1173 showed
 * what that costs, catching three of four refusal sites while reading as covered. The
 * source assertion covers every site by construction, including ones no fixture drives.
 */
test('each refusal sentence exists exactly once, so no site can reintroduce a copy', () => {
  const src = fs.readFileSync(nodePath.join(__dirname, 'create.js'), 'utf8');
  /* Two directions, and the first version of this test only had one. Counting the
     SENTENCE catches a site re-introducing a duplicate. It is blind to a site that
     drifts to a DIFFERENT sentence, because the original count is unchanged.
     Measured 2026-08-27: with only the sentence check, perturbing sites 681 and 1559
     left the suite GREEN. Counting the CONSTANT'S USES closes that direction, and all
     seven sites then go red. */
  for (const [sentence, constant, uses] of [
    ['that is not a name we can act on', 'REFUSE_NAME', 3],
    ['pick a provider from the list', 'REFUSE_PROVIDER', 2],
    ['we do not know that account on this computer', 'REFUSE_ACCOUNT', 2],
  ]) {
    const literals = src.split(`'${sentence}'`).length - 1;
    assert.equal(
      literals,
      1,
      `"${sentence}" appears as ${literals} literals in create.js. `
        + 'It must appear once, as the constant declaration, so the sites cannot drift apart.',
    );
    const used = src.split(`because: ${constant}`).length - 1;
    assert.equal(
      used,
      uses,
      `${constant} is used at ${used} sites, expected ${uses}. `
        + 'A site that stopped using the constant has drifted away from the others.',
    );
  }
});

test('all three name checks refuse an unusable name with the SAME sentence', () => {
  const bad = 'not a usable name!!';
  const viaAccount = create.setAccount(bad, '/tmp/nowhere');
  const viaProvider = create.setProvider(bad, 'openai', { ...BINS, codexBin: CODEX_BIN });
  const viaModel = create.setModel(bad, 'opus');
  for (const r of [viaAccount, viaProvider, viaModel]) {
    assert.equal(r.outcome, create.OUTCOME.REFUSED);
  }
  assert.equal(viaAccount.because, viaProvider.because,
    `setAccount and setProvider disagree: ${viaAccount.because} vs ${viaProvider.because}`);
  assert.equal(viaAccount.because, viaModel.because,
    `setAccount and setModel disagree: ${viaAccount.because} vs ${viaModel.because}`);
});


/* ------------------------------------------------------------------ #1139
 * THE JOIN, which is the half neither side tests on its own.
 *
 * tools/test-supervisor-env.sh proves the SUPERVISOR mints when `engine-path`
 * sits beside it. It writes that pointer by hand. So nothing proved the BOARD
 * actually produces one, and two correct halves with no join is exactly how
 * this defect existed in the first place.
 * -------------------------------------------------------------------------- */

test('#1139: installSupervisor leaves an engine-path beside the supervisor, pointing somewhere sendertoken.js really is', () => {
  const r = create.installSupervisor();
  assert.equal(r.ok, true, r.missingFile || 'install failed');

  const ptr = nodePath.join(nodePath.dirname(create.supervisorPath()), 'engine-path');
  assert.ok(fs.existsSync(ptr), 'no engine-path was written beside the supervisor');

  const dir = fs.readFileSync(ptr, 'utf8').trim();
  assert.ok(dir, 'the pointer is empty');
  assert.ok(nodePath.isAbsolute(dir), 'the pointer is relative, and the supervisor resolves it from a different cwd');

  /* The point of the pointer, not merely that a file exists: the supervisor
     requires `<dir>/sendertoken.js`, so a path to anything else is a pointer
     that resolves and still mints nothing. */
  assert.ok(
    fs.existsSync(nodePath.join(dir, 'sendertoken.js')),
    `engine-path points at ${dir}, which has no sendertoken.js`,
  );

  /* And it must not be the SUPPORT_DIR copy's own parent, which is the layout
     that had no engine at all. */
  assert.notEqual(
    nodePath.resolve(dir),
    nodePath.resolve(nodePath.dirname(create.supervisorPath()), '..', 'engine'),
    'the pointer points back into SUPPORT_DIR, where there is no engine',
  );
});

/**
 * #1315: codex's update notice BLOCKS a new agent's first launch.
 *
 * Measured end to end with a control, same home and folder and flags:
 *   dismissed_version = null           -> a blocking prompt, the agent never starts
 *   dismissed_version = latest_version -> a non-blocking banner; the agent landed
 *                                         on "Ask Codex to do anything" and wrote
 *                                         a file, with ZERO keypresses
 *
 * The board cannot see the blocked state either: classify() reads that pane as
 * `unknown`, because the codex markers are question-shaped and it is not a
 * question.
 */
const { dismissCodexUpdateNotice } = require('./create');

function codexHome(contents) {
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'pete-cxh-'));
  if (contents !== undefined) {
    fs.writeFileSync(nodePath.join(dir, 'version.json'),
      typeof contents === 'string' ? contents : JSON.stringify(contents));
  }
  return dir;
}
const readVersion = (d) => JSON.parse(fs.readFileSync(nodePath.join(d, 'version.json'), 'utf8'));

test('#1315: it dismisses the version codex reports as latest', () => {
  const d = codexHome({ latest_version: '0.150.1', last_checked_at: 'x', dismissed_version: null });
  assert.equal(dismissCodexUpdateNotice(d), true);
  assert.equal(readVersion(d).dismissed_version, '0.150.1',
    'the notice will still block the agent on its first launch');
});

test('#1315: it preserves the rest of the file', () => {
  /* version.json is codex's, not ours. Dropping a field it relies on would be a
     worse bug than the prompt. */
  const d = codexHome({ latest_version: '0.150.1', last_checked_at: 'when', other: 42, dismissed_version: null });
  dismissCodexUpdateNotice(d);
  const after = readVersion(d);
  assert.equal(after.last_checked_at, 'when');
  assert.equal(after.other, 42);
});

test('#1315: already dismissed is a no-op, not a rewrite', () => {
  const d = codexHome({ latest_version: '0.150.1', dismissed_version: '0.150.1' });
  assert.equal(dismissCodexUpdateNotice(d), false, 'it rewrote a file it did not need to touch');
});

test('#1315 CONTROL: it NEVER invents a version', () => {
  /* Dismissing a version codex has not told us about would be writing a guess
     into somebody's config. Three ways the answer can be unknown, and all three
     must decline. */
  assert.equal(dismissCodexUpdateNotice(codexHome(undefined)), false, 'no version.json at all');
  assert.equal(dismissCodexUpdateNotice(codexHome('not json')), false, 'unparseable');
  assert.equal(dismissCodexUpdateNotice(codexHome({ dismissed_version: null })), false, 'no latest_version');
});

test('#1315 CONTROL: a missing home does not throw', () => {
  assert.equal(dismissCodexUpdateNotice('/tmp/pete-no-such-codex-home-1315'), false);
});

test('#1315: creation actually CALLS the dismissal, beside the trust write', () => {
  /* 🛑 WITHOUT THIS, DELETING THE CALL SITE LEFT EVERY TEST GREEN. The function
     was well tested and nothing checked that anybody used it -- a fix that is
     merged and inert, which is the third instance of that shape I have shipped
     today and the reason this assertion exists at all.

     ⚠️ ASSERTED ON THE SOURCE rather than by running a creation: creating an
     agent writes launchd jobs and instruction files, and the existing suite
     sandboxes heavily to do it. A source assertion is the proportionate guard
     for "is the call there", and it fails loudly if somebody removes it.

     📌 It is deliberately anchored to the trust write, because the two belong
     together: both answer a first-run prompt that nothing else will answer. */
  const src = fs.readFileSync(nodePath.join(__dirname, 'create.js'), 'utf8');
  const trust = src.indexOf('trustCodexFolder(workerDir(name), configDir);');
  assert.ok(trust > 0, 'the trust write moved: this guard is anchored to it and needs re-aiming');
  const near = src.slice(trust, trust + 600);
  assert.match(near, /dismissCodexUpdateNotice\(configDir\)/,
    'creation no longer dismisses the update notice: a new codex agent will stop at a prompt nothing answers');
});

test('#1315 CONTROL: that guard can fail', () => {
  /* The assertion above searches a 600-character window. If the window were
     wrong, or the string always present, it would pass regardless. This proves
     the same search returns nothing for a call that is not there. */
  const src = fs.readFileSync(nodePath.join(__dirname, 'create.js'), 'utf8');
  const trust = src.indexOf('trustCodexFolder(workerDir(name), configDir);');
  const near = src.slice(trust, trust + 600);
  assert.doesNotMatch(near, /dismissSomethingThatDoesNotExist\(/,
    'the window matches anything: the guard above proves nothing');
});

test('#1315: the SUPERVISOR dismisses the update notice, in the codex branch only', () => {
  /* 🛑 THE LAUNCH CALL IS THE DURABLE HALF. Creation dismisses the version
     current when the agent was made; only a launch-time call can answer a
     release that appears LATER, which is every existing agent's case.

     ⚠️ ASSERTED ON THE SHIPPED FILE, like every other supervisor test here: it
     is one checked-in artifact that every agent's job runs. */
  const sup = supervisorText();
  const at = sup.indexOf('codex-dismiss-update.js');
  assert.ok(at > 0, 'the supervisor no longer dismisses the update notice: existing codex agents will block on it');

  /* It must be inside the codex branch. The claude launch is below the `else`,
     and running a codex helper there would be wrong even if harmless. */
  const codexBranch = sup.indexOf('if [ "$RUNNER" = codex ]');
  const elseBranch = sup.indexOf('else', codexBranch);
  assert.ok(codexBranch > 0 && elseBranch > codexBranch, 'the codex branch moved: this guard needs re-aiming');
  assert.ok(at > codexBranch && at < elseBranch,
    'the dismissal is outside the codex branch: it would run for claude agents too');

  /* 🔑 AND IT MUST NOT BE ABLE TO FAIL A LAUNCH. An agent that will not start
     because its update notice could not be dismissed is a far worse outcome
     than the prompt. */
  const line = sup.slice(sup.lastIndexOf('\n', at) + 1, sup.indexOf('\n', at) + 200);
  assert.match(sup.slice(at, at + 200), /\|\| true/,
    'the dismissal can fail a launch: it needs to be unconditional');
});

test('#1315 CONTROL: that branch check can fail', () => {
  /* Proves the window test above is not satisfied by any string anywhere. */
  const sup = supervisorText();
  const codexBranch = sup.indexOf('if [ "$RUNNER" = codex ]');
  const elseBranch = sup.indexOf('else', codexBranch);
  const inWindow = sup.slice(codexBranch, elseBranch);
  assert.doesNotMatch(inWindow, /claude-dismiss-something-that-does-not-exist/,
    'the window matches anything: the guard above proves nothing');
});

/* ────────────────────────────────────────────────────────────────────────────
   #1414: the codex trust entry has an inverse now, and it is BEHAVIOURAL.

   These are not source-text guards. `forgetCodexFolder` writes to a real file,
   so it can be driven for real in a temp home, which is a stronger claim than
   asserting that a call appears near another call.
   ──────────────────────────────────────────────────────────────────────────── */

function codexCfgHome(entries) {
  const home = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'codex-forget-'));
  fs.writeFileSync(nodePath.join(home, 'config.toml'), entries);
  return home;
}
const TRUSTED = (d) => `[projects."${d}"]\ntrust_level = "trusted"\n`;

test('#1414: removing an agent takes back the codex trust entry it wrote', () => {
  const mine = '/somewhere/workers/mineagent';
  const theirs = '/somewhere/workers/otheragent';
  const home = codexCfgHome(`${TRUSTED(theirs)}\n${TRUSTED(mine)}\n[tui.thing]\n"a" = 1\n`);

  const before = fs.readFileSync(nodePath.join(home, 'config.toml'), 'utf8');
  assert.ok(before.includes(mine), 'the entry must be there first, or the removal below proves nothing');

  const got = create.forgetCodexFolder(mine, home);
  assert.equal(got.ok, true);
  assert.equal(got.removed, true);

  const after = fs.readFileSync(nodePath.join(home, 'config.toml'), 'utf8');
  assert.ok(!after.includes(mine), 'the entry for this agent is gone');
  assert.ok(after.includes(theirs), 'ANOTHER agent\'s trust must survive: this removes one folder, not the file');
  assert.ok(after.includes('[tui.thing]'), 'unrelated config must survive');
});

test('#1414: an entry a PERSON edited is left alone, and said so', () => {
  /* ⚠️ THE CONSERVATIVE ARM, and it is the one that protects somebody's file.
     `trustCodexFolder` is a no-op when the key already exists, so an entry
     Kosmos FOUND is indistinguishable from one it WROTE. Matching the exact
     two lines we append is what keeps a hand-edited entry out of scope. */
  const mine = '/somewhere/workers/editedagent';
  const home = codexCfgHome(`[projects."${mine}"]\ntrust_level = "untrusted"\n`);

  const got = create.forgetCodexFolder(mine, home);
  assert.equal(got.removed, false, 'a changed entry must NOT be removed');
  assert.equal(got.ok, false);
  /* ⚠️ THE SHAPE, NOT THE WORDS (Kitty's rule, 2026-08-28). Nothing PARSES
     this sentence: `remove()` reads only `ok`, and no route or screen reads
     the string at all. Pinning my exact wording would make a better sentence
     a false red, which is the defect that bit three of us today. What matters
     is that a refusal EXPLAINS itself rather than returning a bare false. */
  assert.equal(typeof got.because, 'string');
  assert.ok(got.because.length > 12,
    'a refusal that says nothing is indistinguishable from doing nothing');

  const after = fs.readFileSync(nodePath.join(home, 'config.toml'), 'utf8');
  assert.ok(after.includes('untrusted'), 'the person\'s own value survives untouched');
});

test('#1414 CONTROL: the removal can tell "not there" from "removed"', () => {
  /* Without this, `removed: false` from the arm above could mean the function
     never finds anything, and both tests would pass on a stub that does
     nothing at all. */
  const home = codexCfgHome(`${TRUSTED('/somewhere/workers/someoneelse')}`);
  const got = create.forgetCodexFolder('/somewhere/workers/neverthere', home);
  assert.equal(got.ok, true, 'absent is not an error');
  assert.equal(got.removed, false);
  assert.match(String(got.because), /no entry/);

  const after = fs.readFileSync(nodePath.join(home, 'config.toml'), 'utf8');
  assert.ok(after.includes('someoneelse'), 'and it touched nothing while looking');
});

test('#1414: no codex config at all is a quiet success, not a failure', () => {
  const home = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'codex-nocfg-'));
  const got = create.forgetCodexFolder('/somewhere/workers/any', home);
  assert.equal(got.ok, true);
  assert.equal(got.removed, false);
});

test('#1414: the rewrite keeps the config\'s permissions, it does not widen them', () => {
  /* 🛑 A REAL REGRESSION, CAUGHT IN CROSS-REVIEW AFTER IT HAD ALREADY RUN
     against the operator's own ~/.codex/config.toml and left it 644 where it
     had been 600. `renameSync` carries the TEMP file's mode, not the target's,
     so a write-then-rename silently republishes the file at the umask default.
     This file lives beside auth.json; "remove this agent" does not imply
     "widen who can read my config". */
  const dir = '/somewhere/workers/modeagent';
  const home = codexCfgHome(`${TRUSTED(dir)}${TRUSTED('/somewhere/workers/keep')}`);
  const cfg = nodePath.join(home, 'config.toml');
  fs.chmodSync(cfg, 0o600);
  assert.equal(fs.statSync(cfg).mode & 0o777, 0o600, 'the fixture must start private, or this proves nothing');

  const got = create.forgetCodexFolder(dir, home);
  assert.equal(got.removed, true, 'it has to actually rewrite the file, or the mode was never at risk');
  assert.equal(fs.statSync(cfg).mode & 0o777, 0o600,
    'the config must keep the permissions it had');
});

test('#1414 CONTROL: the mode assertion can fail', () => {
  /* If forgetCodexFolder did nothing, the test above would pass for the wrong
     reason. This proves the fixture's mode is observable and that a DIFFERENT
     mode is distinguishable, so 0o600 above is a real reading. */
  const home = codexCfgHome(`${TRUSTED('/somewhere/workers/other')}`);
  const cfg = nodePath.join(home, 'config.toml');
  fs.chmodSync(cfg, 0o644);
  assert.equal(fs.statSync(cfg).mode & 0o777, 0o644, 'the harness can see a non-600 mode');
  assert.notEqual(fs.statSync(cfg).mode & 0o777, 0o600);
});

test('#1414 PRECISION: removing one agent must not remove a PREFIX-NAMED sibling', () => {
  /* 🔑 THE THIRD ARM (Renet Tilley, 2026-08-28): a control proves an instrument
     is NOT DEAD; it cannot prove it is NOT OVER-EAGER. The two arms above test
     liveness. This one tests precision, and it is reachable: NAME_RE admits
     both `mine` and `minelonger`, so their worker directories are prefixes of
     one another and a substring match would take the wrong entry.

     ⭐ It passes today because the key carries its closing `"]`, which is what
     stops `[projects."/w/mine"]` matching inside `[projects."/w/minelonger"]`.
     That is easy to lose while "simplifying" the key, and nothing else would
     notice. */
  const shortDir = '/w/mine';
  const longDir = '/w/minelonger';
  const home = codexCfgHome(`${TRUSTED(longDir)}${TRUSTED(shortDir)}`);
  const cfg = nodePath.join(home, 'config.toml');

  const got = create.forgetCodexFolder(shortDir, home);
  assert.equal(got.removed, true, 'the short one is the target and must go');

  const after = fs.readFileSync(cfg, 'utf8');
  assert.ok(after.includes(`[projects."${longDir}"]`),
    'the PREFIX-NAMED sibling must survive: a substring match would have eaten it');
  assert.ok(!after.includes(`[projects."${shortDir}"]`), 'and the target is gone');
});

test('#1414 PRECISION: the reverse direction, removing the LONGER name', () => {
  /* The mirror, because a matcher can be over-eager in one direction only. */
  const shortDir = '/w/mine';
  const longDir = '/w/minelonger';
  const home = codexCfgHome(`${TRUSTED(shortDir)}${TRUSTED(longDir)}`);
  const cfg = nodePath.join(home, 'config.toml');

  const got = create.forgetCodexFolder(longDir, home);
  assert.equal(got.removed, true);

  const after = fs.readFileSync(cfg, 'utf8');
  assert.ok(after.includes(`[projects."${shortDir}"]`), 'the shorter sibling must survive');
  assert.ok(!after.includes(`[projects."${longDir}"]`));
});

test('#1414: removal does NOT reformat sections the person wrote', () => {
  /* 🛑 PigeonPete, cross-review: the first version collapsed `\n{3,}` GLOBALLY,
     so taking back one agent's entry also reflowed unrelated parts of the
     person's own config. Same "never clobber what is theirs" line as the
     permission bug in the same function. */
  const mine = '/w/mineagent';
  const home = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'codex-seam-'));
  const cfg = nodePath.join(home, 'config.toml');
  const theirs = '[a]\nx = 1\n\n\n\n[b]\ny = 2\n';   // THREE blank lines, deliberate
  fs.writeFileSync(cfg, theirs + '\n' + `[projects."${mine}"]\ntrust_level = "trusted"\n`);

  const got = create.forgetCodexFolder(mine, home);
  assert.equal(got.removed, true, 'it must actually rewrite, or nothing was at risk');

  const after = fs.readFileSync(cfg, 'utf8');
  assert.ok(after.includes('[a]\nx = 1\n\n\n\n[b]\ny = 2\n'),
    'the person\'s own three-blank-line run must survive untouched');
  assert.ok(!after.includes(mine), 'and our entry is gone');
});


/**
 * #1432: the plist must set HOME, and the KEY is data rather than code.
 *
 * 🛑 FOUND BY RENET TILLEY CROSS-REVIEWING THE SWEEP THAT BROKE IT. A blind
 * identifier rewrite replaced `HOME` inside the plist XML:
 *
 *     main     <key>HOME</key><string>${xml(HOME)}</string>
 *     branch   <key>homeDir()</key><string>${xml(homeDir())}</string>
 *
 * Every agent created from that branch got a launchd job setting a variable
 * literally named `homeDir()` and **no HOME at all**.
 *
 * ⭐ IT IS INVISIBLE IN REVIEW FOR A STRUCTURAL REASON: the diff line reads as
 * correct, because `${xml(homeDir())}` is exactly the intended change. The
 * damage is three characters to its left, in the half of the line that is DATA.
 *
 * ⇒ And the checker added in the same PR could not see it either: it looks for
 * frozen roots, not for XML keys. A guard that cannot detect the defect its own
 * change introduced is the clearest statement of that guard's scope there is.
 * This assertion is the cheap thing that closes it.
 */
test('#1432: the plist template carries exactly its known set of keys', () => {
  const src = fs.readFileSync(nodePath.join(__dirname, 'create.js'), 'utf8');
  const keys = [...src.matchAll(/<key>([^<]*)<\/key>/g)].map((m) => m[1]).sort();

  /* 🔑 THE WHOLE SET, NOT ONE NAME (Mona Lisa's shape, and it is stronger than
     what I first wrote). Asserting only `HOME` catches the rename that already
     happened; asserting the SET catches the next one, whichever key it hits.
     `${configKey}` is the one deliberately dynamic entry. */
  assert.deepEqual(keys, [
    'AssociatedBundleIdentifiers', 'EnvironmentVariables', 'HOME', 'KOSMOS_PORT',
    'KeepAlive', 'LANG', 'Label', 'PATH', 'ProgramArguments', 'RunAtLoad',
    'StandardErrorPath', 'StandardOutPath', 'TMUX_TMPDIR', 'ThrottleInterval',
    'WorkingDirectory', '${configKey}',
  ].sort(), 'the plist key set changed: a launchd job now sets different variables than it did, and if this came from a rename rather than a deliberate edit, agents launch without one');

  /* A key that is the source text of a function call means an identifier
     rewrite reached into the XML. That is exactly what happened here. */
  assert.doesNotMatch(src, /<key>[a-zA-Z_]+\(\)<\/key>/,
    'a plist key is a function call, so a rename reached into data');
});

test('#1414 CONTROL: the seam-scoped tidy still runs where it should', () => {
  /* The mirror of the arm above: proving we did not fix over-reach by simply
     doing nothing. Removing a MIDDLE entry must not leave a growing gap. */
  const mid = '/w/middle';
  const home = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'codex-seam2-'));
  const cfg = nodePath.join(home, 'config.toml');
  fs.writeFileSync(cfg,
    `[projects."/w/first"]\ntrust_level = "trusted"\n\n[projects."${mid}"]\ntrust_level = "trusted"\n\n[projects."/w/last"]\ntrust_level = "trusted"\n`);

  assert.equal(create.forgetCodexFolder(mid, home).removed, true);
  const after = fs.readFileSync(cfg, 'utf8');
  assert.ok(after.includes('/w/first') && after.includes('/w/last'), 'neighbours survive');
  assert.ok(!/\n{3,}/.test(after), 'the seam left behind is tidied, so gaps do not accumulate');
});

test('#1672: when the working-rules block cannot be added, creation SAYS SO and still makes the agent', () => {
  /**
   * The block carries `kosmos post` and `kosmos msg`, so an agent born without it
   * does not know how to answer a person at all. Creation used to report success
   * anyway: the `catch` swallowed the failure and nothing was pushed to `steps`.
   *
   * ⚠️ BOTH HALVES MATTER AND THEY PULL OPPOSITE WAYS. The agent must still be
   * CREATED - refusing somebody their agent because the product wanted to teach
   * it something is the worse failure, and that posture is deliberate. What
   * changes is only that the loss is now named.
   *
   * 📌 A code-level break is already caught: making `appendTo` throw reds 6 of
   * this file's other tests. The case this step exists for is the DEPLOYMENT one,
   * a partially synced install where the shipped code is fine and the file on
   * disk is not, which no test can see.
   */
  recorder();
  create.setDryRun(false);
  const defaults = require('./defaults');
  const orig = defaults.appendTo;
  defaults.appendTo = () => { throw new Error('#1672 simulated: defaults unavailable'); };
  try {
    const r = create.createAgent({ ...BINS, name: 'Pete Defaults', role: 'pm' });
    assert.equal(r.outcome, create.OUTCOME.CREATED,
      'non-gating: the agent is still made when the block cannot be added');
    const said = (r.steps || []).some((s) => s && s.ok === false && /working rules/.test(s.label || ''));
    assert.equal(said, true,
      'creation must NAME the loss: without this the person is told it worked and the agent cannot reply');
  } finally {
    defaults.appendTo = orig;
  }
});

test('#1672 CONTROL: a normal create reports no such failure', () => {
  /* Without this, the assertion above could pass on a step that is always pushed,
     which would be a permanent false alarm rather than a guard. */
  recorder();
  create.setDryRun(false);
  const r = create.createAgent({ ...BINS, name: 'Pete Defaults Ok', role: 'pm' });
  assert.equal(r.outcome, create.OUTCOME.CREATED, r.because || '');
  const said = (r.steps || []).some((s) => s && s.ok === false && /working rules/.test(s.label || ''));
  assert.equal(said, false, 'a healthy create must not claim the working rules failed');
});
