'use strict';

/**
 * #4929: `tools/run-tests.sh --only <file>...` runs the named test files with the suite's environment and guards
 * (the dead-port phone-home URLs, the fake gh and vercel, the unsets, the per-run temp root, the --require guards),
 * without the whole suite and without its queue. A bare `node --test <file>` has none of it.
 *
 * The probe files are written OUTSIDE the repo (a *.test.js inside it would change the whole-suite count), and run
 * through the real runner.
 *
 *   node --test tools.run-tests-only-4929.test.js
 */
require('./test-support/tmpscope');
const test = require('node:test');
/* A run this file starts must never start this file again: against a runner without --only, node takes `--only` as an
   option and the runner runs the WHOLE suite, this file included, one level down (measured, review 5). The inner runs
   carry this mark, and a file that sees it stands down. */
if (process.env.KOSMOS_ONLY_4929_INNER === '1') {
  test('stands down inside its own inner run', { skip: 'started by tools.run-tests-only-4929.test.js itself' }, () => {});
  return;
}
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RUNNER = path.join(__dirname, 'tools', 'run-tests.sh');
/* Read, never run, to see whether this runner knows --only: running one that does not starts the whole suite. */
const KNOWS_ONLY = /\[ "\$\{1:-\}" = --only \]/.test(require('node:fs').readFileSync(RUNNER, 'utf8'));
const KNOWS_MISPLACED = /--only must come first/.test(require('node:fs').readFileSync(RUNNER, 'utf8'));
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'only-4929-'));
/* Under the suite (yarn test, CI, --only itself) this process already has what run-tests.sh exports, and CI's node job
   sets KOSMOS_TEST_PART. Every run below starts from an environment with none of that, so each assertion can only
   pass if the run under test set it up. TMPDIR is a plain folder here, so a kt<pid> under it is the inner run's own. */
const RUNNER_SET = ['AGENT_WORKFORCE_CREATED_URL', 'AGENT_WORKFORCE_FEEDBACK_URL', 'AGENT_WORKFORCE_COMMUNITY_URL',
  'KOSMOS_CATALOGUE_BASE', 'AGENT_WORKFORCE_GH_BIN', 'AGENT_WORKFORCE_VERCEL_BIN', 'KOSMOS_NO_LEGACY_MIGRATION',
  'KOSMOS_TEST_PART', 'KOSMOS_TEST_PART_LOCAL', 'KOSMOS_SHELL_SHARD',
  // A queue turn or a cut runs this file holding a machine claim; its cookie would make the test's own claims ours.
  'KOSMOS_MACHINE_CLAIM_COOKIE',
  // node --test marks its children with NODE_TEST_CONTEXT; a nested node --test that inherits it reports to this one
  // instead of printing. The runs below are separate runs, so it goes too.
  'NODE_TEST_CONTEXT'];
const PLAIN_TMP = fs.mkdtempSync(path.join(DIR, 'tmp-'));
const SANDBOX_HOME = fs.mkdtempSync(path.join(DIR, 'home-'));
const cleanEnv = (extra = {}) => {
  const e = { ...process.env };
  for (const k of RUNNER_SET) delete e[k];
  e.TMPDIR = PLAIN_TMP;
  // Review 19: a sandbox HOME, so each inner run's #3011 check reads an empty LaunchAgents folder, not the live
  // fleet's, where a board writing an agent's plist mid-run would red this test for nothing.
  e.HOME = SANDBOX_HOME;
  e.KOSMOS_ONLY_4929_INNER = '1';
  return { ...e, ...extra };
};

/* What a test sees of its environment, written as one JSON line. */
const PROBE = path.join(DIR, 'envprobe.test.js');
fs.writeFileSync(PROBE, `'use strict';
const test = require('node:test');
test('probe', () => {
  const e = process.env;
  console.log('ENV ' + JSON.stringify({
    created: e.AGENT_WORKFORCE_CREATED_URL || null,
    feedback: e.AGENT_WORKFORCE_FEEDBACK_URL || null,
    community: e.AGENT_WORKFORCE_COMMUNITY_URL || null,
    catalogue: e.KOSMOS_CATALOGUE_BASE || null,
    gh: e.AGENT_WORKFORCE_GH_BIN || null,
    vercel: e.AGENT_WORKFORCE_VERCEL_BIN || null,
    legacy: e.KOSMOS_NO_LEGACY_MIGRATION || null,
    codexHome: e.CODEX_HOME || null,
    tokenOnly: e.KOSMOS_AGENT_TOKEN_ONLY || null,
    tmpdir: e.TMPDIR || null,
    guards: process.execArgv.join(' '),
  }));
});
`);
const GLOBBY = path.join(fs.mkdtempSync(path.join(DIR, 'g[1]-')), 'a.test.js');   // a real file whose path node globs
fs.writeFileSync(GLOBBY, `require('node:test')('globby', () => {});\n`);
const EXTGLOB = path.join(fs.mkdtempSync(path.join(DIR, '@(x)-')), 'c.test.js');   // node: tests 0, exit 0 (measured)
fs.writeFileSync(EXTGLOB, `require('node:test')('extglob', () => {});\n`);
const RED = path.join(DIR, 'red.test.js');
fs.writeFileSync(RED, `'use strict';\nrequire('node:test')('red', () => { throw new Error('red on purpose'); });\n`);

/* A timeout must not leave the inner suite running with no owner: spawnSync's timeout signals only the process it
   started, and the runner's node --test child would carry on. So the runner starts in its own process group under a
   small perl parent, and a SIGTERM to that parent takes the whole group down. */
const GROUP = 'my $pid; $SIG{TERM} = sub { $SIG{TERM} = "IGNORE"; kill "TERM", -$$; exit 143 }; setpgrp(0, 0); ' +
  '$pid = fork; die "fork: $!" unless defined $pid; if (!$pid) { exec @ARGV or exit 127 } ' +
  'waitpid($pid, 0); exit(($? & 127) ? 128 + ($? & 127) : $? >> 8)';
function runRunner(args, env, timeout) {
  return spawnSync('perl', ['-e', GROUP, 'bash', RUNNER, ...args], { env, encoding: 'utf8', timeout });
}

function run(args, extraEnv = {}) {
  assert.ok(KNOWS_ONLY, 'tools/run-tests.sh has no --only: not running it, since it would run the whole suite');
  // Not about the machine claim or the install harness (cut-guard's own tests are): a run on a busy box must still run.
  const env = cleanEnv({ CODEX_HOME: '/tmp/should-be-unset', KOSMOS_AGENT_TOKEN_ONLY: '1',
    KOSMOS_IGNORE_MACHINE_CLAIM: '1', KOSMOS_TESTS_IGNORE_HARNESS: '1', ...extraEnv });
  const r = runRunner(args, env, 120000);
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

test('CONTROL: a bare node --test has none of the suite\'s environment (what --only exists to fix)', () => {
  const r = spawnSync(process.execPath, ['--test', PROBE], { env: cleanEnv({ CODEX_HOME: '/tmp/should-be-unset' }), encoding: 'utf8' });
  const line = ((r.stdout || '').match(/ENV (\{.*\})/) || [])[1];
  assert.ok(line, 'the probe printed nothing: ' + r.stdout);
  const e = JSON.parse(line);
  assert.notEqual(e.created, 'http://127.0.0.1:9/api/created', 'a bare run already points the beacon at a dead port, so this test proves nothing');
  assert.equal(e.legacy, null, 'a bare run already has the migration opt-out, so this test proves nothing');
});

test('--only runs the named file with the suite\'s environment and guards', () => {
  const r = run(['--only', PROBE]);
  assert.equal(r.code, 0, r.out.slice(-1500));
  assert.match(r.out, /--only: 1 named file\(s\), not the whole suite/);
  const e = JSON.parse((r.out.match(/ENV (\{.*\})/) || [])[1] || 'null');
  assert.ok(e, 'the probe did not run: ' + r.out.slice(-800));
  assert.equal(e.created, 'http://127.0.0.1:9/api/created', 'the install beacon is not pointed at a dead port');
  assert.equal(e.community, 'http://127.0.0.1:9/');
  assert.match(String(e.gh), /test-support\/fake-cli-signed-out\.sh$/);
  assert.match(String(e.feedback), /^http:\/\/127\.0\.0\.1:9\//, 'the feedback URL is not pointed at a dead port');
  assert.match(String(e.catalogue), /^http:\/\/127\.0\.0\.1:9\b/, 'the catalogue base is not pointed at a dead port');
  assert.match(String(e.vercel), /test-support\/fake-cli-signed-out\.sh$/);
  assert.equal(e.legacy, '1');
  assert.equal(e.codexHome, null, 'an inherited CODEX_HOME reached the test');
  assert.equal(e.tokenOnly, null, 'an inherited KOSMOS_AGENT_TOKEN_ONLY reached the test');
  assert.ok(String(e.tmpdir).startsWith(PLAIN_TMP + '/kt') && /\/kt\d+$/.test(e.tmpdir), 'the test did not get the run\'s own temp root: ' + e.tmpdir);
  assert.match(e.guards, /launch-guard\.js/);
  assert.match(e.guards, /tool-guard\.js/);
  assert.match(r.out, /tests 1\b/, 'more than the named file ran');
});

test('--only runs a file named twice once', () => {
  // node itself drops a repeated file, so the count the runner prints is what can fail here.
  const r = run(['--only', PROBE, PROBE]);
  assert.equal(r.code, 0, r.out.slice(-1500));
  assert.match(r.out, /--only: 1 named file\(s\)/, 'the runner counted the file twice');
  assert.match(r.out, /tests 1\b/, 'not exactly one test ran');
});

test('--only reads a relative name from the runner\'s tree, whatever the caller\'s folder, and says so', () => {
  // This file by its relative name: inside the run it stands down at once (KOSMOS_ONLY_4929_INNER), so it is quick.
  const rel = path.relative(path.join(__dirname), __filename);
  // An exported CDPATH naming a folder with its own tools/ must not send the relative cd there (review 13).
  const cdp = fs.mkdtempSync(path.join(DIR, 'cdp-'));
  fs.mkdirSync(path.join(cdp, 'tools'));
  const env = cleanEnv({ KOSMOS_IGNORE_MACHINE_CLAIM: '1', KOSMOS_TESTS_IGNORE_HARNESS: '1', CDPATH: cdp });
  assert.ok(KNOWS_ONLY, 'tools/run-tests.sh has no --only: not running it, since it would run the whole suite');
  const r = spawnSync('perl', ['-e', GROUP, 'bash', RUNNER, '--only', rel, './' + rel, 'tools/../' + rel, __filename], { env, encoding: 'utf8', timeout: 120000, cwd: DIR });
  const out = (r.stdout || '') + (r.stderr || '');
  assert.equal(r.status, 0, out.slice(-1500));
  assert.match(out, /--only: 1 named file\(s\)/, 'four spellings of one file were counted apart');
  assert.ok(out.includes('run-tests: --only:   ' + fs.realpathSync(__filename) + '\n'), 'the physical path of what runs is not printed');
  // The shell names the caller's folder by its real path (macOS /var is /private/var), so either spelling counts.
  assert.ok(out.includes('not from your folder (' + DIR) || out.includes('not from your folder (' + fs.realpathSync(DIR)),
    'no note that the name was read from the runner\'s tree: ' + out.slice(0, 600));
  assert.match(out, /stands down inside its own inner run/);
});

test('--only works when the runner is called by a relative path from outside the repo (the leak guards load)', () => {
  assert.ok(KNOWS_ONLY, 'tools/run-tests.sh has no --only: not running it, since it would run the whole suite');
  const above = path.dirname(path.dirname(__dirname));   // two levels up, so the runner's path is relative and has a folder
  const relRunner = path.relative(above, RUNNER);
  // With CDPATH naming a folder that has the runner's own relative path in it: the REPO line's cd must not follow it.
  const cdp = fs.mkdtempSync(path.join(DIR, 'cdp2-'));
  fs.mkdirSync(path.join(cdp, path.dirname(relRunner)), { recursive: true });   // review 19: keep tools/ (join would drop it)
  const env = cleanEnv({ KOSMOS_IGNORE_MACHINE_CLAIM: '1', KOSMOS_TESTS_IGNORE_HARNESS: '1', CDPATH: cdp });
  const r = spawnSync('perl', ['-e', GROUP, 'bash', relRunner, '--only', PROBE], { env, encoding: 'utf8', timeout: 120000, cwd: above });
  const out = (r.stdout || '') + (r.stderr || '');
  assert.doesNotMatch(out, /No such file or directory/, 'a lib did not load: ' + out.slice(-800));
  assert.doesNotMatch(out, /LEAK/, 'a false LEAK red: ' + out.slice(-800));
  assert.equal(r.status, 0, out.slice(-1500));
});

test('--only takes a repo file whose name starts with a dash as a file, not a node option', () => {
  // Node starts each file as a child by the name it was given, and "-x.test.js" reaches that child as an option. The
  // file has to sit at a repo's top, and a *.test.js made inside THIS repo mid-suite would be seen by the tests that
  // walk the tree, so the runner runs from a throwaway repo whose tools/ and test-support/ are this repo's own.
  assert.ok(KNOWS_ONLY, 'tools/run-tests.sh has no --only: not running it, since it would run the whole suite');
  const fake = fs.mkdtempSync(path.join(DIR, 'fakerepo-'));
  for (const d of ['tools', 'test-support']) fs.symlinkSync(path.join(__dirname, d), path.join(fake, d));
  fs.writeFileSync(path.join(fake, '-dash.test.js'), `require('node:test')('dash', () => {});\n`);
  const env = cleanEnv({ KOSMOS_IGNORE_MACHINE_CLAIM: '1', KOSMOS_TESTS_IGNORE_HARNESS: '1' });
  const r = spawnSync('perl', ['-e', GROUP, 'bash', path.join(fake, 'tools', 'run-tests.sh'), '--only', './-dash.test.js'], { env, encoding: 'utf8', timeout: 120000, cwd: fake });
  const out = (r.stdout || '') + (r.stderr || '');
  assert.doesNotMatch(out, /bad option/, 'the dash name reached node as an option: ' + out.slice(-600));
  assert.equal(r.status, 0, out.slice(-1500));
  assert.match(out, /tests 1\b/);
});

test('--only passes a red file\'s failure on', () => {
  const r = run(['--only', RED]);
  assert.notEqual(r.code, 0, 'a failing file came back green');
  assert.match(r.out, /red on purpose/);
});

test('--only refuses, before anything runs: no files, an option, a non-test file, a missing file, with a part', () => {
  for (const [args, env, why] of [
    [['--only'], {}, /needs one or more test files/],
    [['--only', PROBE, '--test-name-pattern=x'], {}, /takes test files, not node --test options/],
    [['--only', PROBE, path.join(DIR, 'notes.txt')], {}, /takes \*\.test\.js files/],
    [['--only', PROBE, path.join(DIR, 'missing.test.js')], {}, /no test file/],
    [['--only', PROBE], { KOSMOS_TEST_PART: 'node', KOSMOS_TEST_PART_LOCAL: '1' }, /does not take KOSMOS_TEST_PART/],
    [['--only', PROBE], { KOSMOS_SHELL_SHARD: '1/2' }, /does not take KOSMOS_TEST_PART or KOSMOS_SHELL_SHARD/],
    // Not first, node --test would take --only as its own option and run the whole suite.
    [[PROBE, '--only'], {}, /--only must come first/],
    [['--only=' + PROBE], {}, /not --only=<file>/],
    [['--only', GLOBBY], {}, /reads \[ \* \? \{ \( ! \S+ as a pattern/],
    [['--only', EXTGLOB], {}, /as a pattern/],
  ]) {
    assert.ok(KNOWS_ONLY, 'tools/run-tests.sh has no --only: not running it, since it would run the whole suite');
    // A misplaced --only on a runner that does not refuse it would run the whole suite: read before running that arm.
    if (args[0] !== '--only') assert.ok(KNOWS_MISPLACED && /not --only=<file>/.test(fs.readFileSync(RUNNER, 'utf8')),
      'tools/run-tests.sh does not refuse a misplaced --only or --only=: not running it');
    const e = cleanEnv(env);
    const r = runRunner(args, e, 60000);
    const out = (r.stdout || '') + (r.stderr || '');
    assert.equal(r.status, 2, JSON.stringify(args) + ': ' + out.slice(-400));
    assert.match(out, why, JSON.stringify(args));
    assert.doesNotMatch(out, /ENV \{/, 'the probe ran although the arguments were refused');
  }
});

test('--only asks the machine claim once: a foreign claim refuses it; the claim\'s own holder (a queue turn) runs', async (t) => {
  const markers = fs.mkdtempSync(path.join(DIR, 'markers-'));
  const lib = path.join(__dirname, 'tools', 'lib', 'cut-guard.sh');
  /* A live holder: a claim whose holder has gone is stale and refuses nothing, so it stays alive until the end. */
  const holder = require('node:child_process').spawn('bash', ['-c',
    `. "${lib}" && kosmos_claim_machine 5 && printf 'COOKIE %s\\n' "$KOSMOS_MACHINE_CLAIM_COOKIE" && exec sleep 120`],
    { env: cleanEnv({ KOSMOS_RUN_MARKER_DIR: markers }), stdio: ['ignore', 'pipe', 'pipe'] });
  // exec: the holder IS the sleep, so killing it leaves nothing holding the pipe (bash 3.2 does not exec the last command).
  t.after(() => { try { holder.kill('SIGTERM'); } catch { /* gone */ } try { holder.stdout.destroy(); } catch { /* gone */ } });
  const cookie = await new Promise((resolve) => {
    let buf = '';
    const done = setTimeout(() => resolve(''), 15000);
    holder.stdout.on('data', (d) => { buf += d; const m = buf.match(/COOKIE (\S+)/); if (m) { clearTimeout(done); resolve(m[1]); } });
  });
  assert.ok(cookie, 'no claim was taken, so nothing below can refuse');
  const base = { KOSMOS_RUN_MARKER_DIR: markers, KOSMOS_IGNORE_MACHINE_CLAIM: '', KOSMOS_TESTS_IGNORE_HARNESS: '1' };
  const foreign = run(['--only', PROBE], base);
  assert.equal(foreign.code, 1, 'a foreign claim did not refuse --only: ' + foreign.out.slice(-600));
  assert.match(foreign.out, /machine is reserved/);
  assert.doesNotMatch(foreign.out, /ENV \{/, 'the probe ran beside a foreign claim');
  const own = run(['--only', PROBE], { ...base, KOSMOS_MACHINE_CLAIM_COOKIE: cookie });
  assert.equal(own.code, 0, 'the claim\'s own holder was refused: ' + own.out.slice(-600));
  assert.match(own.out, /ENV \{/);
});

test('--only asks the install harness once: a live one refuses it; the override runs it', () => {
  const probe = path.join(DIR, 'harness-live.sh');
  fs.writeFileSync(probe, "#!/bin/bash\necho '99999 bash tools/test-install.sh'\nexit 0\n", { mode: 0o755 });
  const base = { KOSMOS_HARNESS_PROBE: probe, KOSMOS_HARNESS_KEEP_FIXTURES: '1', KOSMOS_TESTS_IGNORE_HARNESS: '' };
  const live = run(['--only', PROBE], base);
  assert.equal(live.code, 1, 'a live harness did not refuse --only: ' + live.out.slice(-600));
  assert.match(live.out, /an install harness \(tools\/test-install\.sh\) is already running/);
  assert.doesNotMatch(live.out, /ENV \{/, 'the probe ran beside a live harness');
  const over = run(['--only', PROBE], { ...base, KOSMOS_TESTS_IGNORE_HARNESS: '1' });
  assert.equal(over.code, 0, 'the override did not run it: ' + over.out.slice(-600));
  assert.match(over.out, /ENV \{/);
});

test('the runner\'s text keeps --only out of the whole suite\'s parts (coverage count, shell part, both gates)', () => {
  const src = fs.readFileSync(RUNNER, 'utf8');
  assert.match(src, /if \[ "\$KOSMOS_ONLY" = 1 \]; then\n[\s\S]{0,800}?\n  KOSMOS_TEST_FILES=\("\$\{KOSMOS_ONLY_FILES\[@\]\}"\)[^\n]*\nelse\nshopt -s nullglob\nKOSMOS_TEST_FILES=\(engine\/\*\.test\.js \*\.test\.js\)\n[\s\S]{0,2000}?\n  exit 1\nfi\nfi\n/, 'the coverage count (the else branch, closed by its own fi) is no longer skipped for --only');
  // An empty --only list must stop before the node line too: bash 5 expands it to nothing and node runs every file.
  assert.match(src, /if \[ "\$\{#KOSMOS_ONLY_FILES\[@\]\}" -eq 0 \]; then\n.*\n    exit 2\n  fi\n  KOSMOS_TEST_FILES=/, 'the second stop for an empty --only list is gone');
  assert.match(src, /if \[ "\$KOSMOS_ONLY" = 1 \]; then\n  :[^\n]*\nelif \[ "\$NODE_STATUS" -eq 0 \]/, 'the shell part is no longer skipped for --only');
  assert.equal((src.match(/if \[ "\$NODE_STATUS" -eq 0 \] && \[ "\$KOSMOS_ONLY" != 1 \]; then\n  \( \. "\$REPO\/tools\/lib\/browser-check(-surface)?-gate\.sh"/g) || []).length, 2,
    'a browser-check gate is no longer skipped for --only');
});
