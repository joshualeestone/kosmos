'use strict';
/**
 * #4317: the test job runs as parallel jobs (the node suite, and test:shell split into shards).
 * A test nothing runs is an unarmed guard, so this proves every test:shell command lands in exactly
 * one shard, that test.yml runs every shard and the node part, and that the job's 70% warning reads
 * the same limit as its timeout. It also pins run-tests.sh's default: `yarn test` runs everything.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const sh = require('./tools/shell-shard');

const ROOT = __dirname;
const WF = path.join(ROOT, '.github', 'workflows', 'test.yml');

/* test.yml, parsed once with ruby's YAML, as ci.main-runs-finish-4021.test.js does (the repo has no
   YAML dependency). Where ruby is missing or broken, the workflow tests skip off CI with the reason,
   and the CI arm below fails, as #4021's does: on CI they must run. */
let WORKFLOW = null;
let RUBY_PROBLEM = null;
try {
  WORKFLOW = JSON.parse(execFileSync('ruby', ['-ryaml', '-rjson', '-e',
    'y = Psych::VERSION.to_i >= 4 ? YAML.load_file(ARGV[0], aliases: true) : YAML.load_file(ARGV[0]); puts JSON.generate(y.transform_keys(&:to_s))', WF],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
} catch (err) {
  RUBY_PROBLEM = err && err.code === 'ENOENT' ? 'ruby is not on this machine' : 'ruby cannot parse test.yml: ' + String((err && err.message) || err).split('\n')[0];
}
const ON_CI = !!process.env.CI && process.env.CI !== 'false' && process.env.CI !== '0';
const NEEDS_RUBY = { skip: RUBY_PROBLEM ? RUBY_PROBLEM + ' (the other #4317 checks still run)' : false };
const workflow = () => WORKFLOW;

test('#4317: on CI, test.yml is parsed, so the workflow checks below run', () => {
  if (ON_CI) assert.equal(RUBY_PROBLEM, null, RUBY_PROBLEM + ' under CI: the shard matrix cannot be checked');
});

test('every test:shell command is in exactly one shard, for the shard count CI uses and for others', () => {
  const all = sh.commands();
  assert.ok(all.length > 100, `only ${all.length} test:shell commands read; the split on ' && ' changed?`);
  for (const n of [sh.SHELL_SHARDS, 2, 3, 4]) {
    const shards = Array.from({ length: n }, (_, k) => sh.select(all, k + 1, n));
    const union = shards.flat();
    assert.equal(union.length, all.length, `n=${n}: a command is missing or doubled`);
    assert.deepEqual([...union].sort(), [...all].sort(), `n=${n}: the union is not the full list`);
    assert.equal(new Set(union).size, new Set(all).size, `n=${n}: a command is in two shards`);
    for (const [k, s] of shards.entries()) assert.ok(s.length > 0, `n=${n}: shard ${k + 1} is empty`);
  }
});

test('a command\'s shard depends on the command alone, not on its place in the list', () => {
  const all = sh.commands();
  const reversed = [...all].reverse();
  assert.equal(sh.shardOf('bash tools/test-run-tests-codexhome-2858.sh', 2), 1, 'a fixed command keeps its fixed shard');
  assert.deepEqual(sh.select(reversed, 1, 2).sort(), sh.select(all, 1, 2).sort());
  assert.deepEqual(sh.commands({ scripts: { 'test:shell': 'bash a.sh && sh -n b.sh' } }), ['bash a.sh', 'sh -n b.sh']);
});

test('every command is one plain script call whose script exists, so the split on && cannot mis-cut one', () => {
  for (const c of sh.commands()) {
    const m = c.match(/^(bash|sh)(?: -n)? (\S+)$|^node (tools\/\S+\.js)(?: \S+)?$/);
    assert.ok(m, `not a plain script call (a quote, a ; or a nested && would be mis-split): ${c}`);
    const file = m[2] || m[3];
    assert.ok(fs.existsSync(path.join(ROOT, file)), `test:shell names ${file}, which does not exist`);
  }
});

test('a shard runs its commands in order and stops at the first failure, with its exit status', () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'shard-4317-'));
  try {
    const ran = path.join(dir, 'ran'); const after = path.join(dir, 'after');
    const code = sh.runShard([`touch '${ran}'`, 'exit 3', `touch '${after}'`], 1, 1, 'ignore');
    assert.equal(code, 3, 'the first failure is the result');
    assert.ok(fs.existsSync(ran), 'the command before the failure ran');
    assert.ok(!fs.existsSync(after), 'the command after the failure did not run');
    assert.equal(sh.runShard(['true', 'true'], 1, 1, 'ignore'), 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a bad shard is refused, not read as a subset', () => {
  for (const [i, n] of [[0, 2], [3, 2], ['x', 2], [1, 0], [1.5, 2]]) assert.throws(() => sh.parseShard(i, n), /shard must be/);
  assert.deepEqual(sh.parseShard('2', '2'), [2, 2]);
  assert.throws(() => sh.commands({ scripts: {} }), /no test:shell commands/);
});

test('test.yml runs the node part once and every shell shard once, and `test` needs them all', NEEDS_RUBY, () => {
  const wf = workflow();
  const suite = wf.jobs.suite;
  assert.ok(suite, 'test.yml has no suite job');
  const include = suite.strategy.matrix.include;
  assert.deepEqual(include.filter((m) => m.part === 'node').length, 1, 'the node part must run exactly once');
  const shards = include.filter((m) => m.part === 'shell').map((m) => m.shard).sort();
  const want = Array.from({ length: sh.SHELL_SHARDS }, (_, k) => `${k + 1}/${sh.SHELL_SHARDS}`).sort();
  assert.deepEqual(shards, want, 'the matrix must run shards 1..SHELL_SHARDS of SHELL_SHARDS, each once');
  assert.equal(include.length, 1 + sh.SHELL_SHARDS, 'nothing else in the matrix');
  assert.equal(suite.strategy['fail-fast'], false, 'one red shard must not cancel the others');
  const run = suite.steps.find((s) => /run-tests\.sh/.test(String(s.run || '')));
  assert.ok(run, 'the suite job runs tools/run-tests.sh');
  assert.equal(run.env.KOSMOS_TEST_PART, '${{ matrix.part }}');
  assert.equal(run.env.KOSMOS_SHELL_SHARD, '${{ matrix.shard }}');
  const agg = wf.jobs.test;
  assert.ok(agg, 'the check named test is gone');
  assert.equal(agg.needs, 'suite');
  assert.equal(agg.if, '${{ !cancelled() }}', 'a failed shard must still give a red test check, and a cancel must read as a cancel');
  assert.match(agg.steps.map((s) => s.run).join('\n'), /needs\.suite\.result \}\}" = success/);
});

test('the 70% warning reads the same limit as the timeout, and fires at 70%', NEEDS_RUBY, () => {
  const suite = workflow().jobs.suite;
  assert.equal(Number(suite.env.SUITE_TIMEOUT_MIN), Number(suite['timeout-minutes']), 'SUITE_TIMEOUT_MIN must equal timeout-minutes');
  const warn = suite.steps.find((s) => /SUITE_TIMEOUT_MIN/.test(String(s.run || '')));
  assert.ok(warn, 'no step reads SUITE_TIMEOUT_MIN');
  assert.equal(warn.if, 'always()', 'the warning must run even after a red suite');
  assert.match(warn.run, /\[ "\$pct" -ge 70 \]/);
  assert.match(warn.run, /::warning /);
  assert.match(warn.run, /GITHUB_STEP_SUMMARY/);
  assert.equal(suite.steps[0].name, 'start the clock', 'the clock must start first');
});

/* Runs the real "how close to the limit" step, as GitHub does (bash -e), with the matrix expressions
   filled in for shell 1/2. The summary file lives in the OS temp dir, never the checkout. */
function runLimitStep(env) {
  const step = workflow().jobs.suite.steps.find((s) => s.name === 'how close to the limit');
  const script = step.run.replace(/\$\{\{ matrix\.part \}\}/g, 'shell').replace(/\$\{\{.*?\}\}/g, ' 1/2');
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'limit-4317-'));
  const summary = path.join(dir, 'summary');
  try {
    const r = require('node:child_process').spawnSync('bash', ['-e', '-c', script], {
      encoding: 'utf8', env: { PATH: process.env.PATH, SUITE_TIMEOUT_MIN: '45', GITHUB_STEP_SUMMARY: summary, ...env },
    });
    return { status: r.status, out: r.stdout, err: r.stderr, summary: fs.existsSync(summary) ? fs.readFileSync(summary, 'utf8') : '' };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('the limit step warns when the job started long ago, and not when it started just now', NEEDS_RUBY, () => {
  const now = Math.floor(Date.now() / 1000);
  const late = runLimitStep({ SUITE_T0: String(now - 40 * 60) });
  assert.equal(late.status, 0, late.err);
  assert.match(late.out, /::warning title=suite near its limit \(#4317\)::suite \(shell 1\/2\): 40m/);
  assert.match(late.summary, /past 70% of the limit/);
  const early = runLimitStep({ SUITE_T0: String(now - 5 * 60) });
  assert.equal(early.status, 0, early.err);
  assert.doesNotMatch(early.out, /::warning/);
  assert.match(early.summary, /suite \(shell 1\/2\): 5m/);
});

test('the limit step fails loudly when the clock never started, instead of reading 0%', NEEDS_RUBY, () => {
  const r = runLimitStep({});
  assert.notEqual(r.status, 0, 'an unset SUITE_T0 must fail the step');
  assert.match(r.err, /the clock step did not run/);
  assert.equal(r.summary, '', 'no percentage may be reported without a clock');
});

test('run-tests.sh refuses a bad part, a bad or misplaced shard, and node arguments to a shell run, first', (t) => {
  const { spawnSync } = require('node:child_process');
  /* Stub node and yarn that exit 97, first on the PATH: if a refusal were missing, the run would
     reach the suite and fail at once with 97, rather than run the real suite on this machine. */
  const stub = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'shard-4317-stub-'));
  for (const bin of ['node', 'yarn']) fs.writeFileSync(path.join(stub, bin), '#!/bin/sh\nexit 97\n', { mode: 0o755 });
  const base = { ...process.env, PATH: stub + path.delimiter + process.env.PATH, GITHUB_ACTIONS: 'true' };
  delete base.KOSMOS_TEST_PART; delete base.KOSMOS_SHELL_SHARD; delete base.KOSMOS_TEST_PART_LOCAL;
  t.after(() => fs.rmSync(stub, { recursive: true, force: true }));
  const cases = [
    [{ KOSMOS_TEST_PART: 'bogus' }, [], /KOSMOS_TEST_PART must be all, node or shell/],
    [{ KOSMOS_SHELL_SHARD: '1/2' }, [], /only with KOSMOS_TEST_PART=shell/],
    [{ KOSMOS_TEST_PART: 'node', KOSMOS_SHELL_SHARD: '1/2' }, [], /only with KOSMOS_TEST_PART=shell/],
    [{ KOSMOS_TEST_PART: 'shell', KOSMOS_SHELL_SHARD: '2' }, [], /must be i\/n/],
    [{ KOSMOS_TEST_PART: 'shell', KOSMOS_SHELL_SHARD: 'x/2' }, [], /must be i\/n/],
    [{ KOSMOS_TEST_PART: 'shell' }, ['engine/store.test.js'], /takes no node --test arguments/],
    /* Outside CI, an inherited part must not narrow a cut's or a validation's `yarn test`. */
    [{ GITHUB_ACTIONS: '', KOSMOS_TEST_PART: 'node' }, [], /outside CI, set KOSMOS_TEST_PART_LOCAL=1/],
    [{ GITHUB_ACTIONS: '', KOSMOS_TEST_PART: 'shell', KOSMOS_SHELL_SHARD: '1/2' }, [], /outside CI, set KOSMOS_TEST_PART_LOCAL=1/],
  ];
  for (const [env, args, reason] of cases) {
    const started = Date.now();
    const r = spawnSync('bash', [path.join(ROOT, 'tools', 'run-tests.sh'), ...args], { cwd: ROOT, env: { ...base, ...env }, encoding: 'utf8', timeout: 30000 });
    const label = JSON.stringify(env) + ' ' + args.join(' ');
    assert.equal(r.status, 2, `${label}: exit ${r.status}, stderr: ${r.stderr}`);
    assert.match(r.stderr, reason, label);
    assert.ok(Date.now() - started < 10000, `${label}: took ${Date.now() - started} ms, so it ran something before refusing`);
  }
});

test('run-tests.sh: the default part is all, so `yarn test` still runs the node suite and all of test:shell', () => {
  const src = fs.readFileSync(path.join(ROOT, 'tools', 'run-tests.sh'), 'utf8');
  assert.match(src, /KOSMOS_TEST_PART="\$\{KOSMOS_TEST_PART:-all\}"/);
  assert.match(src, /echo "run-tests: running ONLY the \$KOSMOS_TEST_PART part of the suite/, 'a part says so in the log');
  assert.match(src, /if \[ "\$NODE_STATUS" -eq 0 \] && \[ "\$KOSMOS_TEST_PART" != node \]; then\n\s+if \[ -n "\$\{KOSMOS_SHELL_SHARD:-\}" \]/, 'the shell half runs for every part but node, so the default all runs it');
  assert.match(src, /\*\) echo "run-tests: KOSMOS_TEST_PART must be all, node or shell/);
  assert.match(src, /if \[ "\$KOSMOS_TEST_PART" != shell \]; then\nnode --test --require/, 'the node --test line must stay flush left (three guards find it by ^node --test)');
  assert.match(src, /else\n\s+yarn -s test:shell\n\s+fi/);
  assert.match(src, /if \[ -n "\$\{KOSMOS_SHELL_SHARD:-\}" \]; then\n\s+node "\$REPO\/tools\/shell-shard\.js" run "\$\{KOSMOS_SHELL_SHARD%\/\*\}" "\$\{KOSMOS_SHELL_SHARD#\*\/\}"/, 'the shard arm must RUN its shard');
  assert.match(src, /grep -Eq '\^\[0-9\]\+\/\[0-9\]\+\$'/, 'a shard that is not i/n is refused');
  assert.match(src, /\[ "\$KOSMOS_TEST_PART" != shell \] \|\|/, 'a shard outside a shell-only run is refused');
});
