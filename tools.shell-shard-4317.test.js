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
const cp = require('node:child_process');
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

test('#6791: linux and mac split test:shell exactly, as the macOS-only list says, and every listed command exists', () => {
  const all = sh.commands();
  const text = fs.readFileSync(sh.MAC_ONLY_FILE, 'utf8');
  const mac = sh.macOnly(text, all);
  const twice = sh.bothOf(text);
  assert.ok(mac.size > 0, 'tools/shell-macos-only.txt lists nothing');
  const linux = sh.forPlatform(all, 'linux');
  const onMac = sh.forPlatform(all, 'mac');
  assert.deepEqual([...new Set([...linux, ...onMac])].sort(), [...all].sort(), 'a command runs on neither platform');
  assert.ok(linux.every((c) => !mac.has(c) || twice.has(c)), 'a listed command not marked both: runs on linux');
  assert.ok([...twice].every((c) => linux.includes(c)), 'a both: command is missing from linux');
  assert.ok([...mac].every((c) => onMac.includes(c)), 'a listed command does not run on mac');
  // Review 3: the only commands on both are syntax-only checks and the `both:` lines (#6799); every syntax check
  // runs on mac (bash 3.2's /bin/sh).
  const both = linux.filter((c) => onMac.includes(c));
  assert.ok(both.length > 50, `only ${both.length} commands on both platforms: the syntax checks are not on mac`);
  assert.ok(both.every((c) => sh.SYNTAX_ONLY.test(c) || twice.has(c)), 'a command neither a syntax check nor marked both: runs on both: ' + both.filter((c) => !sh.SYNTAX_ONLY.test(c) && !twice.has(c)).join('; '));
  assert.deepEqual(all.filter((c) => sh.SYNTAX_ONLY.test(c)).filter((c) => !onMac.includes(c)), [], 'a syntax check is missing from the mac job');
  assert.ok(onMac.includes('sh -n install/setup.sh'), 'CONTROL: the installer\u2019s sh -n runs on mac');
  assert.deepEqual(onMac.filter((c) => !sh.SYNTAX_ONLY.test(c)).sort(), [...mac].sort(), 'mac runs the listed commands and syntax checks, nothing else');
  assert.deepEqual(sh.forPlatform(all, ''), all, 'no platform (a local full run) is the whole list, in order');
  // The linux shards still cover every linux command exactly once.
  const union = Array.from({ length: sh.SHELL_SHARDS }, (_, k) => sh.select(linux, k + 1, sh.SHELL_SHARDS)).flat();
  assert.deepEqual(union.sort(), [...linux].sort());
});

test('#6799: a `both:` line runs on mac and stays on linux; an unmarked line leaves linux; a stale both: line refuses', () => {
  const list = ['bash a.sh', 'bash b.sh', 'bash c.sh'];
  const text = '# why\nbash b.sh\nboth: bash c.sh\n';
  assert.deepEqual([...sh.macOnly(text, list)].sort(), ['bash b.sh', 'bash c.sh']);
  assert.deepEqual([...sh.bothOf(text)], ['bash c.sh']);
  assert.deepEqual(sh.forPlatform(list, 'linux', sh.macOnly(text, list), sh.bothOf(text)), ['bash a.sh', 'bash c.sh']);
  assert.deepEqual(sh.forPlatform(list, 'mac', sh.macOnly(text, list), sh.bothOf(text)), ['bash b.sh', 'bash c.sh']);
  assert.deepEqual(sh.forPlatform(list, 'linux', sh.macOnly(text, list)), ['bash a.sh'], 'CONTROL: without the both set, a listed line leaves linux');
  assert.throws(() => sh.macOnly('both: bash gone.sh\n', list), /does not have: bash gone\.sh/);
});

test('#6791: a stale line in the macOS-only list refuses, and so does an unknown platform; comments and blanks are ignored', () => {
  const list = ['bash a.sh', 'bash b.sh', 'sh -n c.sh'];
  assert.deepEqual([...sh.macOnly('# why\n\nbash b.sh\n  # indented comment\n', list)], ['bash b.sh']);
  assert.throws(() => sh.macOnly('bash gone.sh\n', list), /names commands test:shell does not have: bash gone\.sh/);
  const mac = new Set(['bash b.sh']);
  assert.deepEqual(sh.forPlatform(list, 'linux', mac), ['bash a.sh', 'sh -n c.sh']);
  assert.deepEqual(sh.forPlatform(list, 'mac', mac), ['bash b.sh', 'sh -n c.sh'], 'mac also runs every syntax check');
  assert.throws(() => sh.forPlatform(list, 'bsd', mac), /platform must be linux or mac/);
  // The CLI takes it as a fourth word and refuses a bad one with exit 2.
  const r = cp.spawnSync(process.execPath, [path.join(__dirname, 'tools', 'shell-shard.js'), 'list', '1', '1', 'bsd'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /platform must be linux or mac/);
  const ok = cp.spawnSync(process.execPath, [path.join(__dirname, 'tools', 'shell-shard.js'), 'list', '1', '1', 'mac'], { encoding: 'utf8' });
  assert.equal(ok.status, 0);
  assert.deepEqual(ok.stdout.trim().split('\n').sort(), sh.forPlatform(sh.commands(), 'mac').sort(), 'CONTROL: the CLI lists the mac share');
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
    const quiet = () => {};   // #5907: the timing lines are not this test's subject
    const code = sh.runShard([`touch '${ran}'`, 'exit 3', `touch '${after}'`], 1, 1, 'ignore', quiet);
    assert.equal(code, 3, 'the first failure is the result');
    assert.ok(fs.existsSync(ran), 'the command before the failure ran');
    assert.ok(!fs.existsSync(after), 'the command after the failure did not run');
    assert.equal(sh.runShard(['true', 'true'], 1, 1, 'ignore', quiet), 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('#5907: shard 1 of 1 is the whole list, in the order test:shell lists it', () => {
  const all = sh.commands();
  assert.deepEqual(sh.select(all, 1, 1), all);
});

/* #5907: a runShard whose clock and output are seams. The clock is read once before and once after
   each command, so it moves by that command's step on every second read, and the order of the
   summary is known before the run. */
function timedRun(list, steps) {
  const out = [];
  let now = 0; let reads = 0; let k = 0;
  const clock = () => { reads += 1; if (reads % 2 === 0) now += steps[k++]; return now; };
  const code = sh.runShard(list, 1, 1, 'ignore', (s, fd = 1) => out.push(fd === 1 ? s : `[fd ${fd}] ${s}`), clock);
  return { code, text: out.join('') };
}

test('#5907: each command prints its place and its time, and the shard ends on its slowest, slowest first', () => {
  const steps = [3, 50, 0.25, 12];
  const { code, text } = timedRun(['true', 'true # b', 'true # c', 'true # d'], steps);
  assert.equal(code, 0);
  assert.match(text, /^shell-shard 1\/1: 4 of 4 test:shell commands\n/);
  assert.match(text, /shell-shard 1\/1 \[1\/4\] 3\.0 s: true\n/);
  assert.match(text, /shell-shard 1\/1 \[2\/4\] 50\.0 s: true # b\n/);
  assert.match(text, /shell-shard 1\/1 \[3\/4\] 0\.3 s: true # c\n/);
  assert.match(text, /shell-shard 1\/1 \[4\/4\] 12\.0 s: true # d\n/);
  assert.match(text, /4 commands took 65\.3 s; the slowest:\n\s+50\.0 s  true # b\n\s+12\.0 s  true # d\n\s+3\.0 s  true\n\s+0\.3 s  true # c\nshell-shard 1\/1: all 4 passed\n$/);
});

test('#5907: the summary names only the slowest SLOWEST, and a red shard still prints it before it stops', () => {
  const n = sh.SLOWEST + 3;
  const list = Array.from({ length: n }, (_, i) => `true # c${i}`);
  const { text } = timedRun(list, Array.from({ length: n }, (_, i) => i + 1));
  const named = text.split('the slowest:\n')[1].split('\n').filter((l) => /^\s+\d/.test(l));
  assert.equal(named.length, sh.SLOWEST);
  assert.match(named[0], /# c12$/, 'the slowest is first');
  assert.ok(!named.some((l) => /# c[012]$/.test(l)), 'the three fastest are not named');
  const red = timedRun(['true # a', 'exit 4', 'true # never'], [2, 9, 1]);
  assert.equal(red.code, 4);
  assert.match(red.text, /\[2\/3\] 9\.0 s: exit 4\n/);
  assert.match(red.text, /2 commands took 11\.0 s; the slowest:\n\s+9\.0 s  exit 4\n\s+2\.0 s  true # a\n\[fd 2\] shell-shard 1\/1: FAILED \(exit 4\): exit 4 \(its own output is between its \[2\/3\] start and time lines\)\n$/);
  assert.doesNotMatch(red.text, /# never|all \d+ passed/);
});

test('#5907: a command\'s start line is written before it runs, so a run that hangs names the command it hangs in', () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'shard-5907-'));
  try {
    const log = path.join(dir, 'log');
    const write = (s) => fs.appendFileSync(log, s);
    // Each command passes only if its own start line is already in the log while it runs.
    const list = [1, 2].map((k) => `grep -q '\\[${k}/2\\] start: grep' '${log}' # c${k}`);
    assert.equal(sh.runShard(list, 1, 1, 'ignore', write), 0, fs.readFileSync(log, 'utf8'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('#5907: writeAll finishes a partial write, waits out EAGAIN, and gives up after its bound', () => {
  const eagain = () => { const e = new Error('EAGAIN'); e.code = 'EAGAIN'; throw e; };
  let got = ''; let calls = 0;
  const flaky = (fd, buf, off, len) => {
    calls += 1;
    if (calls <= 2) eagain();
    const n = Math.min(3, len); got += buf.toString('utf8', off, off + n); return n;
  };
  sh.writeAll(1, 'hello world\n', flaky);
  assert.equal(got, 'hello world\n', 'every byte, once, in order');
  assert.equal(calls, 2 + Math.ceil(12 / 3));
  let tries = 0;
  assert.throws(() => sh.writeAll(1, 'x', () => { tries += 1; eagain(); }, 3), (e) => e.code === 'EAGAIN');
  assert.equal(tries, 4, 'three waits, then the fourth EAGAIN is thrown');
  assert.throws(() => sh.writeAll(1, 'x', () => { const e = new Error('EPIPE'); e.code = 'EPIPE'; throw e; }), (e) => e.code === 'EPIPE');
});

test('#5907: a shard line that cannot be written never changes the status or stops the commands', () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'shard-5907-'));
  try {
    for (const badFd of [1, 2]) {
      for (const [list, want] of [[['true', 'exit 127'], 127], [['true', 'true'], 0]]) {
        const ran = path.join(dir, `ran-${badFd}-${want}`);
        const calls = { 1: 0, 2: 0 };
        const broken = (s, fd = 1) => {
          calls[fd] += 1;
          if (fd === badFd) { const e = new Error('EPIPE'); e.code = 'EPIPE'; throw e; }
        };
        const code = sh.runShard([`touch '${ran}'`, ...list], 1, 1, 'ignore', broken);
        const label = `fd ${badFd} broken, want ${want}`;
        assert.equal(code, want, label);
        assert.ok(fs.existsSync(ran), `${label}: the commands still ran`);
        // fd 2 is written only on a red, so a broken fd 2 on a green shard is never touched.
        assert.ok(calls[badFd] <= 1, `${label}: ${calls[badFd]} writes to a broken fd; one failure must stop them`);
        if (badFd === 2) assert.ok(calls[1] > 3, `${label}: stdout lines stopped with stderr`);
      }
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('#5907: the real clock: a command that sleeps is timed at least as long as it slept', () => {
  const out = [];
  assert.equal(sh.runShard(['sleep 0.3'], 1, 1, 'ignore', (s) => out.push(s)), 0);
  const m = out.join('').match(/\[1\/1\] (\d+\.\d) s: sleep 0\.3/);
  assert.ok(m, out.join(''));
  assert.ok(Number(m[1]) >= 0.3, `timed ${m[1]} s`);
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
  // #6791: the Linux-safe commands in shards 1..SHELL_SHARDS, and the macOS-only ones in one job of their own.
  const shards = include.filter((m) => m.part === 'shell' && m.platform === 'linux').map((m) => m.shard).sort();
  const want = Array.from({ length: sh.SHELL_SHARDS }, (_, k) => `${k + 1}/${sh.SHELL_SHARDS}`).sort();
  assert.deepEqual(shards, want, 'the matrix must run linux shards 1..SHELL_SHARDS of SHELL_SHARDS, each once');
  assert.deepEqual(include.filter((m) => m.part === 'shell' && m.platform === 'mac').map((m) => m.shard), ['1/1'], 'the macOS-only commands run in exactly one job, whole');
  assert.equal(include.length, 2 + sh.SHELL_SHARDS, 'nothing else in the matrix');
  assert.equal(include.find((m) => m.part === 'node').platform, undefined, 'the node part takes no platform');
  assert.equal(suite.strategy['fail-fast'], false, 'one red shard must not cancel the others');
  const run = suite.steps.find((s) => /run-tests\.sh/.test(String(s.run || '')));
  assert.ok(run, 'the suite job runs tools/run-tests.sh');
  assert.equal(run.env.KOSMOS_TEST_PART, '${{ matrix.part }}');
  assert.equal(run.env.KOSMOS_SHELL_SHARD, '${{ matrix.shard }}');
  assert.equal(run.env.KOSMOS_SHELL_PLATFORM, '${{ matrix.platform }}');
  const agg = wf.jobs.test;
  assert.ok(agg, 'the check named test is gone');
  // #5488: `test` also needs `scope`, which may name a green run whose verdict a plans-only push reuses.
  assert.deepEqual([].concat(agg.needs).sort(), ['scope', 'suite']);
  assert.equal(agg.if, '${{ !cancelled() }}', 'a failed shard must still give a red test check, and a cancel must read as a cancel');
  // #5488: the result arrives through env (never pasted into the script), and success is still required.
  const step = agg.steps.find((s) => s.env && s.env.SUITE_RESULT);
  assert.ok(step, 'the test job reads the suite result');
  assert.equal(step.env.SUITE_RESULT, '${{ needs.suite.result }}');
  assert.match(step.run, /\[ "\$SUITE_RESULT" = success \]\s*$/);
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
  delete base.KOSMOS_TEST_PART; delete base.KOSMOS_SHELL_SHARD; delete base.KOSMOS_TEST_PART_LOCAL; delete base.KOSMOS_SHELL_PLATFORM;
  t.after(() => fs.rmSync(stub, { recursive: true, force: true }));
  const cases = [
    [{ KOSMOS_TEST_PART: 'bogus' }, [], /KOSMOS_TEST_PART must be all, node or shell/],
    [{ KOSMOS_SHELL_SHARD: '1/2' }, [], /only with KOSMOS_TEST_PART=shell/],
    [{ KOSMOS_TEST_PART: 'node', KOSMOS_SHELL_SHARD: '1/2' }, [], /only with KOSMOS_TEST_PART=shell/],
    [{ KOSMOS_TEST_PART: 'shell', KOSMOS_SHELL_SHARD: '2' }, [], /must be i\/n/],
    [{ KOSMOS_TEST_PART: 'shell', KOSMOS_SHELL_SHARD: 'x/2' }, [], /must be i\/n/],
    /* #6791: a platform only with a shard, and only linux or mac. */
    [{ KOSMOS_TEST_PART: 'shell', KOSMOS_SHELL_PLATFORM: 'linux' }, [], /KOSMOS_SHELL_PLATFORM must be linux or mac and only with KOSMOS_SHELL_SHARD/],
    [{ KOSMOS_TEST_PART: 'shell', KOSMOS_SHELL_SHARD: '1/2', KOSMOS_SHELL_PLATFORM: 'bsd' }, [], /KOSMOS_SHELL_PLATFORM must be linux or mac/],
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
  // #6977: the cut-shape wrap's setup sits between the two: at most 20 lines, none of which exits, returns, sets
  // NODE_STATUS or runs a shard, so none of them can end or stand in for the shell part.
  assert.match(src, /if \[ "\$NODE_STATUS" -eq 0 \] && \[ "\$KOSMOS_TEST_PART" != node \]; then\n(?:[ \t]+(?!if \[ -n "\$\{KOSMOS_SHELL_SHARD)(?![^\n]*(?:\b(?:exit|return)\b|\bNODE_STATUS=|shell-shard\.js))[^\n]*\n){0,20}[ \t]+if \[ -n "\$\{KOSMOS_SHELL_SHARD:-\}" \]/, 'the shell half runs for every part but node, so the default all runs it');
  assert.match(src, /\*\) echo "run-tests: KOSMOS_TEST_PART must be all, node or shell/);
  assert.match(src, /if \[ "\$KOSMOS_TEST_PART" != shell \]; then\nnode --test --require/, 'the node --test line must stay flush left (three guards find it by ^node --test)');
  // #5907: an unsharded run is the whole list as shard 1 of 1, through the runner that times each command.
  assert.match(src, /else\n(\s+#.*\n)*\s+(\$\{_rt_shell_wrap\[@\]\+"\$\{_rt_shell_wrap\[@\]\}"\} )?node "\$REPO\/tools\/shell-shard\.js" run 1 1\n\s+fi/, 'an unsharded run must run the whole list as shard 1 of 1');
  assert.doesNotMatch(src, /^\s*yarn\b/m, 'no line of run-tests.sh may run yarn: the shell part goes through shell-shard.js');
  assert.match(src, /if \[ -n "\$\{KOSMOS_SHELL_SHARD:-\}" \]; then\n\s+(\$\{_rt_shell_wrap\[@\]\+"\$\{_rt_shell_wrap\[@\]\}"\} )?node "\$REPO\/tools\/shell-shard\.js" run "\$\{KOSMOS_SHELL_SHARD%\/\*\}" "\$\{KOSMOS_SHELL_SHARD#\*\/\}"/, 'the shard arm must RUN its shard');
  assert.match(src, /grep -Eq '\^\[0-9\]\+\/\[0-9\]\+\$'/, 'a shard that is not i/n is refused');
  assert.match(src, /\[ "\$KOSMOS_TEST_PART" != shell \] \|\|/, 'a shard outside a shell-only run is refused');
});

test('#6799: the list header states how many commands it lists (test.yml points readers to it)', () => {
  // Only the listed count is asserted: an edit to this list is the only thing that changes it. The Linux share moves
  // with every test:shell command added anywhere, so pinning it here would red unrelated PRs (it did, on #6814).
  const text = fs.readFileSync(sh.MAC_ONLY_FILE, 'utf8');
  const all = sh.commands();
  const listed = (t) => {
    const m = t.match(/That is (\d+) here\./);
    assert.ok(m, 'the header no longer says "That is N here."');
    return Number(m[1]);
  };
  assert.equal(listed(text), sh.macOnly(text, all).size, 'the header\'s count differs from the list');
  const off = text.replace(/That is (\d+) here/, (_, n) => `That is ${Number(n) + 1} here`);
  assert.notEqual(listed(off), sh.macOnly(text, all).size, 'CONTROL: a header one count off must not match');
});

test('#6791 review 2: run-tests.sh hands its platform to shell-shard.js (a lost forward would turn the macOS job into all of test:shell, green)', () => {
  const stub = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'shard-6791-stub-'));
  const log = path.join(stub, 'argv.log');
  fs.writeFileSync(path.join(stub, 'node'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nexit 0\n`, { mode: 0o755 });
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(KOSMOS|AGENT_WORKFORCE)_/.test(k)));
  const seen = (env) => {
    fs.writeFileSync(log, '');
    const r = cp.spawnSync('bash', [path.join(ROOT, 'tools', 'run-tests.sh')], {
      cwd: ROOT, env: { ...base, PATH: stub + path.delimiter + base.PATH, GITHUB_ACTIONS: 'true', KOSMOS_TEST_PART: 'shell',
        // the forward under test does not depend on the suite wait; another agent's suite on the same Mac must not
        // hold this run past its timeout (as test-runner-scale-export-5727 runs it)
        KOSMOS_IGNORE_MACHINE_CLAIM: '1', KOSMOS_TESTS_IGNORE_SUITE: '1', KOSMOS_TESTS_IGNORE_HARNESS: '1', ...env }, encoding: 'utf8', timeout: 120000,
    });
    assert.equal(r.status, 0, `${JSON.stringify(env)}: exit ${r.status}: ${r.stderr.slice(-400)}`);
    return fs.readFileSync(log, 'utf8').split('\n').filter((l) => /shell-shard\.js/.test(l));
  };
  try {
    const shardJs = path.join(ROOT, 'tools', 'shell-shard.js');
    assert.deepEqual(seen({ KOSMOS_SHELL_SHARD: '1/1', KOSMOS_SHELL_PLATFORM: 'mac' }), [`${shardJs} run 1 1 mac`]);
    assert.deepEqual(seen({ KOSMOS_SHELL_SHARD: '2/2', KOSMOS_SHELL_PLATFORM: 'linux' }), [`${shardJs} run 2 2 linux`]);
    assert.deepEqual(seen({ KOSMOS_SHELL_SHARD: '1/2' }), [`${shardJs} run 1 2`], 'CONTROL: no platform, no fourth word');
  } finally { fs.rmSync(stub, { recursive: true, force: true }); }
});
