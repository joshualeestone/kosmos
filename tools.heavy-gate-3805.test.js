'use strict';

/**
 * #3805: tools/heavy-gate.sh answers "is it safe to start a heavy run?" for the whole fleet.
 * Each case the card names is tested with its control: the same input with only the deciding
 * detail changed must give the other answer, so no pass comes from a check that cannot fail.
 * The process table and the reservation come in through the tool's seams (KOSMOS_HG_SNAPSHOT,
 * KOSMOS_HG_CLAIM), so every case is deterministic. The live scan (ps, lsof, the ancestor walk) is
 * tested against a fake ps and lsof on PATH, which spawns nothing another agent's gate could see;
 * a smoke test only checks the real Mac gives an answer.
 *
 *   node --test tools.heavy-gate-3805.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const TOOL = path.join(__dirname, 'tools', 'heavy-gate.sh');
const FREE = 'no release holds the machine right now.';
const HELD = 'the machine is reserved for a release (release 0.6.95, pid 1 on this Mac) until 15:19 CDT.';
const WORK = '/Users/someone/work/kosmos';          // a checkout, not a test sandbox
const KT = '/private/var/folders/ab/cd/T/kt4242/kosmos-gate-x1'; // run-tests.sh sandbox

function run(lines, { claim = FREE, args = [], env = {}, shell = 'bash', cwd } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hg-'));
  const snap = path.join(dir, 'snap.tsv');
  fs.writeFileSync(snap, lines.map((l) => l.join('\x1f')).join('\n') + (lines.length ? '\n' : ''));
  const r = spawnSync(shell, [TOOL, ...args], {
    encoding: 'utf8',
    cwd,
    env: { ...process.env, KOSMOS_HG_SNAPSHOT: snap, KOSMOS_HG_CLAIM: claim, KOSMOS_HG_TWICE_SECONDS: '0', ...env },
  });
  fs.rmSync(dir, { recursive: true, force: true });
  return { code: r.status, out: r.stdout + r.stderr, stdout: r.stdout, stderr: r.stderr };
}
const realRun = (cwd = WORK, anc = 'zsh') => ['101', cwd, 'bash tools/browser-checks.sh', anc];
/* Ancestor commands are joined by \x1e in the snapshot, as live_snapshot joins them. */
const ancs = (...a) => a.join('\x1e');

test('nothing running and no reservation reads clear', () => {
  const r = run([]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /heavy-gate: CLEAR/);
});

test('a reservation reads busy (control: the same table without one is clear)', () => {
  assert.equal(run([], { claim: HELD }).code, 1);
  assert.equal(run([], { claim: FREE }).code, 0);
});

test('a real release or browser-checks run in a checkout reads busy (control: without it, clear)', () => {
  const rel = ['102', WORK, 'bash tools/release.sh 0.6.96', 'zsh'];
  const r = run([realRun(), rel]);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /COUNTS 101/);
  assert.match(r.out, /COUNTS 102/);
  assert.equal(run([]).code, 0);
});

/* #4410: a run-tests.sh started 3 minutes into Kano's install harness, both behind a clear gate,
   and the harness's board-port checks went red. The harness boots real boards, so it is heavy. */
test('#4410: a real install harness (tools/test-install.sh) reads busy (control: without it, clear)', () => {
  for (const cmd of ['bash tools/test-install.sh', 'bash /Users/someone/work/kosmos/tools/test-install.sh']) {
    const r = run([['111', WORK, cmd, 'zsh']]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COUNTS 111: .*script .*tools\/test-install\.sh/);
  }
  // A bare name run from tools/ (`cd tools && bash test-install.sh`) counts too.
  assert.equal(run([['112', WORK + '/tools', 'bash test-install.sh', 'zsh']]).code, 1);
  assert.equal(run([]).code, 0);
});

test('#4410: the install harness follows the shared fixture rule (controls: the same run in a checkout counts)', () => {
  const kt = run([['113', KT, 'bash ' + KT + '/tools/test-install.sh --sleep 4', 'zsh']]);
  assert.equal(kt.code, 0, kt.out);
  assert.match(kt.out, /ignore 113: a unit-test fixture \(run-tests\.sh sandbox\)/);
  // The shape tools/test-cut-guard.sh's stand-in really has: a normal cwd, the SCRIPT in the sandbox.
  // Only the script-path half of the fixture rule drops it; without that, every agent's gate would
  // read BUSY for 8 s during every suite (#4410 review 5).
  const scriptOnly = run([['117', WORK, 'bash ' + KT + '/tools/test-install.sh --sleep 8', 'zsh']]);
  assert.equal(scriptOnly.code, 0, scriptOnly.out);
  assert.match(scriptOnly.out, /ignore 117: a unit-test fixture \(run-tests\.sh sandbox\)/);
  const nodeTest = run([['114', WORK, 'bash tools/test-install.sh', ancs('bash', 'node --test tools.x.test.js')]]);
  assert.equal(nodeTest.code, 0, nodeTest.out);
  assert.match(nodeTest.out, /ignore 114: a unit-test fixture \(node --test ancestor\)/);
  const mention = run([['115', WORK, 'bash -c pgrep -f tools/test-install.sh', 'zsh']]);
  assert.equal(mention.code, 0, mention.out);
  // The control differs from 113 only in the folder the script sits in.
  assert.equal(run([['116', WORK, 'bash ' + WORK + '/tools/test-install.sh --sleep 4', 'zsh']]).code, 1);
});

test('a shell that only MENTIONS the names does not count (control: a real run beside them does)', () => {
  const mentions = [
    ['201', WORK, 'zsh -c for i in 1 2; do pgrep -f tools/browser-checks.sh; done', 'claude'],
    ['202', WORK, 'bash -c echo tools/release.sh', 'zsh'],
    ['203', WORK, 'grep tools/release.sh notes.md', 'zsh'],
  ];
  const quiet = run(mentions);
  assert.equal(quiet.code, 0, quiet.out);
  assert.match(quiet.out, /ignore 201/);
  assert.equal(run([...mentions, realRun()]).code, 1);
});

test('a fixture under $TMPDIR/kt<digits>/ does not count (control: the same run in a checkout does)', () => {
  const r = run([['301', KT, 'bash ' + KT + '/tools/release.sh 0.6.56', 'zsh']]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /run-tests\.sh sandbox/);
  assert.equal(run([['301', WORK, 'bash tools/release.sh 0.6.56', 'zsh']]).code, 1);
});

test('a node --test child does not count (control: the same run without that ancestor does)', () => {
  const anc = ancs('node --test --test-concurrency=0 tools.release-gate.test.js', 'bash tools/run-tests.sh');
  const r = run([realRun(WORK, anc)]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /node --test ancestor/);
  assert.equal(run([realRun(WORK, 'zsh | tmux')]).code, 1);
});

test('a run that already exited does not count (control: the same run still going does)', () => {
  const gone = run([['401', '<exited>', 'bash tools/browser-checks.sh', 'zsh']]);
  assert.equal(gone.code, 0, gone.out);
  assert.match(gone.out, /ignore 401: already exited/, 'ignored for the right reason, not a field shift');
  assert.equal(run([['401', WORK, 'bash tools/browser-checks.sh', 'zsh']]).code, 1);
});

test('a live run whose cwd cannot be read still counts (fail toward busy)', () => {
  const r = run([['402', '', 'bash tools/release.sh 0.6.96', 'zsh']]);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /COUNTS 402: a real run \(cwd unknown/);
});

test('shell options before the script, and a bare name run from tools/, still count (control: -c only mentions it)', () => {
  assert.equal(run([['501', WORK, 'bash -x tools/release.sh 0.6.96', 'zsh']]).code, 1, 'bash -x');
  assert.equal(run([['502', WORK + '/tools', 'bash release.sh 0.6.96', 'zsh']]).code, 1, 'from inside tools/');
  assert.equal(run([['503', WORK, 'bash release.sh 0.6.96', 'zsh']]).code, 0, 'a bare name outside tools/ is not the repo script');
  assert.equal(run([['504', WORK, 'bash -c tools/release.sh', 'zsh']]).code, 0, 'a -c string is a mention');
});

test('only a real node --test ancestor marks a fixture, not a wrapper shell that mentions it', () => {
  const wrapper = "zsh -c eval 'bash tools/browser-checks.sh && node --test x.test.js'";
  const r = run([realRun(WORK, wrapper)]);
  assert.equal(r.code, 1, 'a wrapper mentioning node --test is not a test runner: ' + r.out);
  assert.equal(run([realRun(WORK, ancs(wrapper, 'node --test --test-concurrency=0 y.test.js'))]).code, 0, 'control: a real node --test ancestor');
});

test('an ancestor whose own command line contains " | node --test" is not a test runner (control: a real one is)', () => {
  const piped = run([realRun(WORK, ancs('zsh', 'sh -c foo | node --test bar'))]);
  assert.equal(piped.code, 1, 'a shell piping into node --test is not the runner: ' + piped.out);
  assert.equal(run([realRun(WORK, ancs('zsh', 'sh -c foo', 'node --test bar'))]).code, 0);
});

test('an app flag that only STARTS with --test is not a test runner (control: a bare --test is)', () => {
  const app = run([realRun(WORK, ancs('node server.js --test-endpoint=1', 'zsh'))]);
  assert.equal(app.code, 1, app.out);
  assert.match(app.out, /COUNTS 101/);
  const runner = run([realRun(WORK, ancs('node --test-reporter=spec --test x.test.js', 'zsh'))]);
  assert.equal(runner.code, 0, runner.out);
  assert.match(runner.out, /ignore 101: a unit-test fixture \(node --test ancestor\)/);
});

test('a bare --test AFTER the script is the app\'s argument, not a test runner (control: the same flag before it is)', () => {
  const app = run([realRun(WORK, ancs('node /opt/app/server.js --test', 'zsh'))]);
  assert.equal(app.code, 1, app.out);
  assert.match(app.out, /COUNTS 101/);
  const runner = run([realRun(WORK, ancs('node --test /opt/app/server.js', 'zsh'))]);
  assert.equal(runner.code, 0, runner.out);
  assert.match(runner.out, /ignore 101: a unit-test fixture \(node --test ancestor\)/);
});

test('a script that takes the path as an argument counts, as the header says (control: the path in a -c string does not)', () => {
  const watcher = run([['101', WORK, 'bash /Users/x/work/other/watch.sh ' + WORK + '/tools/release.sh', 'zsh']]);
  assert.equal(watcher.code, 1, watcher.out);
  assert.match(watcher.out, /COUNTS 101/);
  const mention = run([['101', WORK, 'bash -c "watch ' + WORK + '/tools/release.sh"', 'zsh']]);
  assert.equal(mention.code, 0, mention.out);
  assert.match(mention.out, /ignore 101: mentions/);
});

test('a script path with a space still counts (control: the same path in a -c string only mentions it)', () => {
  const dir = '/Users/someone/My Work/kosmos';
  const r = run([['105', dir, `bash ${dir}/tools/release.sh 0.6.99`, 'zsh']]);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /COUNTS 105/);
  const c = run([['105', dir, `bash -c ${dir}/tools/release.sh 0.6.99`, 'zsh']]);
  assert.equal(c.code, 0, c.out);
  assert.match(c.out, /ignore 105: mentions the name/);
});

test('a * in a command line is not expanded against the tool\'s folder (control: a real bare name counts)', (t) => {
  // Run the tool from a folder holding a release.sh: if `*` expanded there, `bash *` from a
  // tools/ cwd would read as the bare `bash release.sh` run and count.
  const here = fs.mkdtempSync(path.join('/tmp', 'hg-glob-'));
  t.after(() => fs.rmSync(here, { recursive: true, force: true }));
  fs.writeFileSync(path.join(here, 'release.sh'), '');
  const tools = `${WORK}/tools`;
  const glob = run([['107', tools, 'bash *', 'zsh']], { cwd: here });
  assert.equal(glob.code, 0, glob.out);
  assert.match(glob.out, /ignore 107: mentions the name/);
  const bare = run([['107', tools, 'bash release.sh', 'zsh']], { cwd: here });
  assert.equal(bare.code, 1, bare.out);
});

test('sourced in bash or zsh it refuses with 2 and leaves the caller\'s shell alive (control: run, it answers)', () => {
  for (const sh of ['bash', 'zsh']) {
    const r = spawnSync(sh, ['-c', `. '${TOOL}'; echo "rc=$? still-alive"`], {
      encoding: 'utf8',
      env: { ...process.env, KOSMOS_HG_SNAPSHOT: '/dev/null', KOSMOS_HG_CLAIM: FREE },
    });
    const out = r.stdout + r.stderr;
    assert.match(out, /rc=2 still-alive/, `${sh}: ${out}`);
    assert.match(out, /run it with bash, do not source it/, `${sh}: ${out}`);
  }
  assert.equal(run([]).code, 0);
});

test('run by zsh it re-runs under bash, so a real run still counts (control: the same under bash)', () => {
  const z = run([realRun()], { shell: 'zsh' });
  assert.equal(z.code, 1, z.out);
  assert.match(z.out, /COUNTS 101/);
  assert.equal(run([realRun()]).code, 1);
});

// Opt-in, by hand only: KOSMOS_HG_LIVE=1 node --test tools.heavy-gate-3805.test.js
// Its stand-in is a real tools/release.sh outside the kt sandbox, so while it runs EVERY agent's
// gate on this Mac reads busy (Liu Kang m967: repeated runs parked the whole fleet). The default
// suite must spawn nothing another gate can see, so it skips this test.
const LIVE = process.env.KOSMOS_HG_LIVE === '1';
test('live (opt-in, KOSMOS_HG_LIVE=1): a real release.sh outside any test ancestry counts, and --except-cwd on its folder rules it out', { skip: !LIVE && 'opt-in: set KOSMOS_HG_LIVE=1 and run by hand' }, async (t) => {
  const dir = fs.realpathSync(fs.mkdtempSync('/tmp/hg-live-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'tools'));
  fs.writeFileSync(path.join(dir, 'tools', 'release.sh'), 'sleep 8\n');
  fs.writeFileSync(path.join(dir, '.git'), 'gitdir: /nowhere\n');
  // Double fork, so the stub is re-parented away from this node --test process.
  spawnSync('bash', ['-c', `cd "${dir}" && (bash tools/release.sh </dev/null >/dev/null 2>&1 &)`], { stdio: 'ignore' });
  let pid = '';
  for (let i = 0; i < 20 && !pid; i++) {
    const ps = spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).stdout;
    const line = ps.split('\n').find((l) => / bash tools\/release\.sh$/.test(l) && spawnSync('lsof', ['-a', '-p', l.trim().split(/\s+/)[0], '-d', 'cwd', '-Fn'], { encoding: 'utf8' }).stdout.includes(dir));
    if (line) pid = line.trim().split(/\s+/)[0]; else spawnSync('sleep', ['0.1']);
  }
  assert.ok(pid, 'the stub started');
  // Stop the stand-in the moment the test ends, by the exact pid this test started.
  t.after(() => { try { process.kill(Number(pid)); } catch { /* already gone */ } });
  const env = { ...process.env, KOSMOS_HG_CLAIM: FREE, KOSMOS_HG_SNAPSHOT: '' };
  const seen = spawnSync('bash', [TOOL], { encoding: 'utf8', env });
  assert.match(seen.stdout, new RegExp('COUNTS ' + pid + ':'), seen.stdout);
  const mine = spawnSync('bash', [TOOL, '--except-cwd', dir], { encoding: 'utf8', env });
  assert.match(mine.stdout, new RegExp('ignore ' + pid + ': your own run'), mine.stdout);
});

/* This one runs the real who-has-the-box.sh, which (like any consult) sweeps a dead or expired
   claim in the real run-markers folder: the one place the default suite touches live state. */
test('the real reservation line is one of the two wordings the tool reads', () => {
  const env = { ...process.env, KOSMOS_HG_SNAPSHOT: path.join(os.tmpdir(), 'hg-empty-' + process.pid) };
  fs.writeFileSync(env.KOSMOS_HG_SNAPSHOT, '');
  delete env.KOSMOS_HG_CLAIM;
  const r = spawnSync('bash', [TOOL], { encoding: 'utf8', env });
  fs.rmSync(env.KOSMOS_HG_SNAPSHOT, { force: true });
  assert.match(r.stdout, /^reservation: (none \(no release holds|HELD \(the machine is reserved for a release)/m, r.stdout);
});

test('--except-cwd rules out your own run, exact or below, and not a sibling that shares the prefix', (t) => {
  /* Made under /tmp, not os.tmpdir(): tools/run-tests.sh points TMPDIR at its $TMPDIR/kt<pid>/
     sandbox, and the tool rightly ignores a run there as a test fixture, so a sibling in the
     sandbox would read as ignored for that reason instead of testing the prefix match. */
  const base = fs.realpathSync(fs.mkdtempSync('/tmp/hg-own-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  assert.doesNotMatch(base, /\/T\/kt[0-9]/, 'the own-run folders must sit outside the kt sandbox pattern');
  const mine = path.join(base, 'kosmos');
  fs.mkdirSync(path.join(mine, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(mine, '.git'), 'gitdir: /nowhere\n'); // a worktree's .git is a file
  const args = ['--except-cwd', mine];
  assert.equal(run([realRun(mine)], { args }).code, 0, 'exact dir is mine');
  assert.equal(run([realRun(path.join(mine, 'sub'))], { args }).code, 0, 'below is mine');
  const sibling = run([realRun(mine + '-bar')], { args });
  assert.equal(sibling.code, 1, 'kosmos-bar is not kosmos: ' + sibling.out);
  assert.equal(run([realRun(mine)]).code, 1, 'control: without --except-cwd the same run counts');
  fs.rmSync(base, { recursive: true, force: true });
});

test('--except-cwd with a missing or non-existent directory is an error, never a clear', () => {
  const noArg = run([], { args: ['--except-cwd'] });
  assert.equal(noArg.code, 2, noArg.out);
  assert.equal(run([], { args: ['--except-cwd', ''] }).code, 2);
  assert.equal(run([], { args: ['--except-cwd', '/no/such/dir-3805'] }).code, 2);
  /* A folder that is not a checkout (a parent passed by mistake) would rule out every run below it. */
  const plain = fs.mkdtempSync('/tmp/hg-plain-');
  const notCheckout = run([realRun(plain + '/kosmos')], { args: ['--except-cwd', plain] });
  fs.rmSync(plain, { recursive: true, force: true });
  assert.equal(notCheckout.code, 2, notCheckout.out);
  assert.match(notCheckout.out, /needs a checkout/);
  assert.equal(run([], { args: ['--bogus'] }).code, 2);
});

test('--twice takes two reads when the first is clear, and stops at a busy first read', () => {
  const clear = run([], { args: ['--twice'] });
  assert.equal(clear.code, 0, clear.out);
  assert.equal((clear.out.match(/^reservation:/gm) || []).length, 2, clear.out);
  const busy = run([], { args: ['--twice'], claim: HELD });
  assert.equal(busy.code, 1);
  assert.equal((busy.out.match(/^reservation:/gm) || []).length, 1, busy.out);
});

test('--quiet prints nothing and answers by exit code alone (control: without it, the verdict is printed)', () => {
  const busy = run([realRun()], { args: ['--quiet'] });
  assert.equal(busy.code, 1);
  assert.equal(busy.stdout, '');
  const clear = run([], { args: ['--quiet'] });
  assert.equal(clear.code, 0);
  assert.equal(clear.stdout, '');
  assert.match(run([realRun()]).stdout, /heavy-gate: BUSY/);
  /* The seam warning is on stderr, so --quiet cannot hide a seam left set. */
  assert.match(busy.stderr, /test seam active/);
});

test('--quiet-box counts a validation suite while the default remains clear', () => {
  const validation = ['860', WORK, 'bash tools/run-tests.sh', 'zsh'];
  const timed = run([validation], { args: ['--quiet-box'] });
  assert.equal(timed.code, 1, timed.out);
  assert.match(timed.out, /COUNTS 860: a real run/);
  const ordinary = run([validation]);
  assert.equal(ordinary.code, 0, ordinary.out);
  assert.match(ordinary.out, /ignore 860: mentions the name but does not run it/);
});

test('--quiet-box applies --except-cwd to a validation suite, but not to a sibling', (t) => {
  const base = fs.realpathSync(fs.mkdtempSync('/tmp/hg-quiet-box-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const mine = path.join(base, 'kosmos');
  fs.mkdirSync(mine);
  fs.writeFileSync(path.join(mine, '.git'), 'gitdir: /nowhere\n');
  const args = ['--quiet-box', '--except-cwd', mine];
  assert.equal(run([['861', mine, 'bash tools/run-tests.sh', 'zsh']], { args }).code, 0);
  assert.equal(run([['862', mine + '-other', 'bash tools/run-tests.sh', 'zsh']], { args }).code, 1);
});

test('combined flags with c (-lc, -ec) are a command string, a mention (control: -l alone runs the script)', () => {
  const r = run([
    ['501', WORK, 'bash -lc pgrep -f tools/release.sh', 'zsh'],
    ['502', WORK, 'sh -ec grep x tools/browser-checks.sh', 'zsh'],
  ]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /ignore 501: mentions/);
  assert.match(r.out, /ignore 502: mentions/);
  assert.equal(run([['503', WORK, 'bash -l tools/release.sh 0.6.9', 'zsh']]).code, 1);
});

test('./release.sh and an option value before a bare name still count from tools/ (control: outside tools/ a bare name is a mention)', () => {
  const tools = WORK + '/tools';
  const dot = run([['601', tools, 'bash ./release.sh 0.6.9', 'zsh']]);
  assert.equal(dot.code, 1, dot.out);
  const opt = run([['602', tools, 'bash -o pipefail release.sh 0.6.9', 'zsh']]);
  assert.equal(opt.code, 1, opt.out);
  const cluster = run([['604', tools, 'bash -eo pipefail release.sh 0.6.9', 'zsh']]);
  assert.equal(cluster.code, 1, 'a cluster ending in o takes its value: ' + cluster.out);
  assert.equal(run([['603', WORK, 'bash ./release.sh 0.6.9', 'zsh']]).code, 0);
});

test('the sandbox under /tmp (TMPDIR unset) is a fixture too, and only kt plus digits (controls: ktx, kt9release)', () => {
  const r = run([['701', '/private/tmp/kt4242/x', 'bash tools/release.sh 0.6.9', 'zsh']]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /run-tests\.sh sandbox/);
  assert.equal(run([['702', '/private/tmp/ktx/x', 'bash tools/release.sh 0.6.9', 'zsh']]).code, 1);
  assert.equal(run([['703', '/private/var/folders/ab/T/kt9release/x', 'bash tools/release.sh 0.6.9', 'zsh']]).code, 1);
});

test('a kt<digits> folder directly under this shell\'s own TMPDIR is a fixture (controls: kt77x, a sibling folder)', () => {
  const env = { TMPDIR: '/Users/x/scratch/' };
  const r = run([['801', '/Users/x/scratch/kt77/y', 'bash tools/release.sh', 'zsh']], { env });
  assert.equal(r.code, 0, r.out);
  assert.equal(run([['802', '/Users/x/scratch/kt77x/y', 'bash tools/release.sh', 'zsh']], { env }).code, 1);
  assert.equal(run([['803', '/Users/x/other/kt77/y', 'bash tools/release.sh', 'zsh']], { env }).code, 1);
});

test('bash -n (a syntax check) is not a run (control: the same without -n is)', () => {
  assert.equal(run([['851', WORK, 'bash -n tools/release.sh', 'zsh']]).code, 0);
  assert.equal(run([['852', WORK, 'bash tools/release.sh', 'zsh']]).code, 1);
});

test('a KOSMOS_HG_TWICE_SECONDS that is not whole seconds is exit 2, never a quick double read (control: 0 is fine)', () => {
  const r = run([], { args: ['--twice'], env: { KOSMOS_HG_TWICE_SECONDS: 'abc' } });
  assert.equal(r.code, 2, r.out);
  assert.equal(run([], { args: ['--twice'] }).code, 0);
});

test('the free line is the one cut-guard.sh prints, in the tool and in these tests (control: a reworded line is not)', () => {
  const guard = fs.readFileSync(path.join(__dirname, 'tools', 'lib', 'cut-guard.sh'), 'utf8');
  const fn = guard.slice(guard.indexOf('kosmos_machine_claim_status() {'));
  const printed = (fn.match(/echo "(no release holds[^"]*)"/) || [])[1];
  assert.ok(printed, 'kosmos_machine_claim_status no longer prints a "no release holds" line');
  const tool = (fs.readFileSync(TOOL, 'utf8').match(/^FREE_LINE='([^']*)'/m) || [])[1];
  assert.equal(tool, printed, 'heavy-gate.sh FREE_LINE drifted from cut-guard.sh');
  assert.equal(FREE, printed, 'this test file\'s FREE drifted from cut-guard.sh');
  assert.equal(run([], { claim: printed.replace('holds', 'currently holds') }).code, 1);
});

test('the reservation reads free only on the exact free line (control: the phrase inside a held line is held)', () => {
  assert.equal(run([], { claim: FREE }).code, 0);
  const tricky = 'the machine is reserved for a release (no release holds x, pid 1 on this Mac) until 15:19 CDT.';
  assert.equal(run([], { claim: tricky }).code, 1);
  assert.equal(run([], { claim: FREE + '\nwarning: something' }).code, 1);
});

test('stock macOS /bin/bash 3.2 gives the same answers (control: clear stays clear)', () => {
  assert.equal(run([realRun()], { shell: '/bin/bash' }).code, 1);
  assert.equal(run([['901', KT, 'bash ' + KT + '/tools/release.sh', 'zsh']], { shell: '/bin/bash' }).code, 0);
  assert.equal(run([], { shell: '/bin/bash' }).code, 0);
});

test('the LIVE scan (ps, lsof, the ancestor walk) through a fake ps and lsof on PATH (control: without the real run, clear)', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hg-fake-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  /* table: pid, ppid, cwd, command ('|'-separated; the assert below keeps '|' out of every value), read by the fakes below */
  fs.writeFileSync(path.join(bin, 'ps'), `#!/bin/bash
T="$FAKE_PS_TABLE"
if [ -n "\${FAKE_PS_FAIL:-}" ]; then echo "ps: Operation not permitted" >&2; exit 1; fi
if [ "$*" = "-axo pid=,command=" ]; then awk -F'|' '{ print $1 " " $4 }' "$T"; exit 0; fi
field=""; pid=""
while [ $# -gt 0 ]; do case "$1" in -o) field="$2"; shift 2 ;; -p) pid="$2"; shift 2 ;; *) shift ;; esac; done
line="$(awk -F'|' -v p="$pid" '$1 == p' "$T")"
[ -n "$line" ] || exit 1
case "$field" in
  command=) printf '%s\n' "$line" | cut -d'|' -f4 ;;
  ppid=) printf '%s\n' "$line" | cut -d'|' -f2 ;;
  *) printf '  PID\n%s\n' "$pid" ;;
esac
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'lsof'), `#!/bin/bash
pid=""
while [ $# -gt 0 ]; do case "$1" in -p) pid="$2"; shift 2 ;; *) shift ;; esac; done
cwd="$(awk -F'|' -v p="$pid" '$1 == p { print $3 }' "$FAKE_PS_TABLE")"
[ -n "$cwd" ] || exit 1
printf 'p%s\nfcwd\nn%s\n' "$pid" "$cwd"
`, { mode: 0o755 });
  const rows = [
    ['1', '0', '/', '/sbin/launchd'],
    ['900', '1', '/', 'zsh'],
    ['901', '900', WORK, 'bash tools/release.sh 0.6.9'],
    ['910', '1', WORK, 'node --test x.test.js'],
    ['911', '910', WORK, 'bash tools/browser-checks.sh'],
    ['920', '900', WORK, 'zsh -c echo tools/release.sh'],
    ['940', '900', WORK, 'bash tools/run-tests.sh'],
    /* three hops below the runner: node, run-tests.sh, a wrapper shell, the script */
    ['930', '1', WORK, 'node --test y.test.js'],
    ['931', '930', WORK, 'bash tools/run-tests.sh'],
    ['932', '931', WORK, 'sh -c x'],
    ['933', '932', WORK, 'bash tools/release.sh 0.6.9'],
  ];
  assert.ok(rows.every((row) => row.every((v) => !v.includes('|'))), 'a value contains the table separator');
  const live = (table, extra = {}, args = []) => {
    const f = path.join(dir, 'table.txt');
    fs.writeFileSync(f, table.map((r) => r.join('|')).join('\n') + '\n');
    const env = { ...process.env, PATH: bin + ':' + process.env.PATH, FAKE_PS_TABLE: f, KOSMOS_HG_CLAIM: FREE, ...extra };
    delete env.KOSMOS_HG_SNAPSHOT;
    const r = spawnSync('bash', [TOOL, ...args], { encoding: 'utf8', env });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  const r = live(rows);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, new RegExp('COUNTS 901: a real run \\(' + WORK));
  assert.match(r.out, /ignore 911: a unit-test fixture \(node --test ancestor\)/);
  assert.match(r.out, /ignore 920: mentions/);
  assert.match(r.out, /ignore 933: a unit-test fixture \(node --test ancestor\)/);
  const without = live(rows.filter((row) => row[0] !== '901'));
  assert.equal(without.code, 0, without.out);
  const quietBox = live(rows.filter((row) => row[0] !== '901'), {}, ['--quiet-box']);
  assert.equal(quietBox.code, 1, quietBox.out);
  assert.match(quietBox.out, /COUNTS 940: a real run/);
  /* A table that cannot be read must never read as "nothing running". */
  const failed = live(rows, { FAKE_PS_FAIL: '1' });
  assert.equal(failed.code, 2, failed.out);
  assert.match(failed.out, /could not read the process table/);
  assert.equal(live([]).code, 2, 'an empty table (no pid 1) is do-not-start');
});

test('smoke: against the live Mac it gives an answer (0 or 1), never a usage error', () => {
  const r = spawnSync('bash', [TOOL], { encoding: 'utf8', env: { ...process.env, KOSMOS_HG_SNAPSHOT: '', KOSMOS_HG_CLAIM: FREE } });
  assert.ok(r.status === 0 || r.status === 1, 'exit ' + r.status + ': ' + r.stdout + r.stderr);
  assert.match(r.stdout, /^reservation:/m);
});

test('a verdict line prints at most 160 characters of the command (control: a short one prints whole)', () => {
  // Liu Kang's review of #4099: one mention-only shell printed several thousand characters.
  const long = 'sh -c "' + 'bash -n tools/x.sh && '.repeat(200) + 'bash -n tools/release.sh"';
  const cut = run([['501', WORK, long, 'zsh']]);
  assert.equal(cut.code, 0, cut.out);
  const line = cut.stdout.split('\n').find((l) => l.includes('ignore 501: mentions the name'));
  assert.ok(line, cut.out);
  assert.ok(line.includes('(' + long.slice(0, 160) + '...)'), line);
  assert.ok(line.length < 300, `line is ${line.length} characters`);
  const short = run([['502', WORK, 'sh -c "grep release.sh"', 'zsh']]);
  assert.match(short.stdout, /ignore 502: mentions the name but does not run it \(sh -c "grep release\.sh"\)\n/);
});

test('only the printed copy is cut: a real run whose script sits past character 160 still counts', () => {
  const deep = WORK + '/' + 'd/'.repeat(100) + 'tools/release.sh';
  const r = run([['503', WORK, 'bash ' + deep + ' 0.6.99', 'zsh']]);
  assert.equal(r.code, 1, r.out);
  const line = r.stdout.split('\n').find((l) => l.includes('COUNTS 503: a real run ('));
  assert.ok(line, r.out);
  // The deciding word was past the cut: the printed command does not contain it, and the
  // counted line names the script instead.
  const shown = line.slice(line.indexOf(': a real run (') + 14, line.lastIndexOf('), script '));
  assert.ok(shown.endsWith('...') && !shown.includes('tools/release.sh'), shown);
  assert.ok(line.endsWith('), script ' + deep), line);
  // Control: the same command as a -c string only mentions it, however long.
  const c = run([['503', WORK, 'bash -c ' + deep, 'zsh']]);
  assert.equal(c.code, 0, c.out);
});

test('the cut starts after 160 characters: 160 print whole, 161 are cut', () => {
  const pad = (n) => { const head = 'sh -c "grep release.sh '; return head + 'x'.repeat(n - head.length - 1) + '"'; };
  const at = pad(160); const over = pad(161);
  assert.equal(at.length, 160); assert.equal(over.length, 161);
  assert.ok(run([['601', WORK, at, 'zsh']]).stdout.includes('(' + at + ')\n'));
  assert.ok(run([['602', WORK, over, 'zsh']]).stdout.includes('(' + over.slice(0, 160) + '...)\n'));
});
