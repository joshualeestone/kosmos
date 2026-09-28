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
const sh = require('../tools/shell-shard');

const ROOT = path.join(__dirname, '..');
const WF = path.join(ROOT, '.github', 'workflows', 'test.yml');

function workflow() {
  const out = execFileSync('ruby', ['-ryaml', '-rjson', '-e',
    'y = Psych::VERSION.to_i >= 4 ? YAML.load_file(ARGV[0], aliases: true) : YAML.load_file(ARGV[0]); puts JSON.generate(y.transform_keys(&:to_s))', WF],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(out);
}

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
  for (const c of all.slice(0, 20)) assert.equal(sh.shardOf(c, 2), sh.shardOf(c, 2));
  assert.deepEqual(sh.select(reversed, 1, 2).sort(), sh.select(all, 1, 2).sort());
  assert.deepEqual(sh.commands({ scripts: { 'test:shell': 'bash a.sh && sh -n b.sh' } }), ['bash a.sh', 'sh -n b.sh']);
});

test('a bad shard is refused, not read as a subset', () => {
  for (const [i, n] of [[0, 2], [3, 2], ['x', 2], [1, 0], [1.5, 2]]) assert.throws(() => sh.parseShard(i, n), /shard must be/);
  assert.deepEqual(sh.parseShard('2', '2'), [2, 2]);
  assert.throws(() => sh.commands({ scripts: {} }), /no test:shell commands/);
});

test('test.yml runs the node part once and every shell shard once, and `test` needs them all', () => {
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
  assert.equal(agg.if, 'always()', 'a failed shard must still produce a red test check, not a skipped one');
  assert.match(agg.steps.map((s) => s.run).join('\n'), /needs\.suite\.result \}\}" = success/);
});

test('the 70% warning reads the same limit as the timeout, and fires at 70%', () => {
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

test('run-tests.sh: the default part is all, so `yarn test` still runs the node suite and all of test:shell', () => {
  const src = fs.readFileSync(path.join(ROOT, 'tools', 'run-tests.sh'), 'utf8');
  assert.match(src, /KOSMOS_TEST_PART="\$\{KOSMOS_TEST_PART:-all\}"/);
  assert.match(src, /\*\) echo "run-tests: KOSMOS_TEST_PART must be all, node or shell/);
  assert.match(src, /if \[ "\$KOSMOS_TEST_PART" != shell \]; then\n\s+node --test --require/);
  assert.match(src, /else\n\s+yarn -s test:shell\n\s+fi/);
});
