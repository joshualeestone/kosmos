'use strict';
/*
 * #7257: on Windows, tools/run-tests.sh runs its one node --test over every test file in chunks, because Windows caps a
 * command line at about 32K characters and one call stopped with "Argument list too long". The chunking is a node()
 * shell function defined only under the Windows flag, so the node --test line stays flush left for the guards that find
 * it (#1934, #3605, #4273, #4317). This cuts that block out of run-tests.sh and runs it in bash with a stand-in node.
 *
 *   node --test tools.run-tests-chunks-7257.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const SRC = fs.readFileSync(path.join(__dirname, 'tools', 'run-tests.sh'), 'utf8');
const BASH = (() => { try { cp.execFileSync('bash', ['-c', 'exit 0'], { stdio: 'ignore' }); return true; } catch { return false; } })();

/* The Windows node() block: from its if line to the fi before NODE_STATUS=0. */
function block() {
  const start = SRC.indexOf('if [ "${_RT_WIN:-0}" = 1 ]; then\n  node() {');
  const end = SRC.indexOf('\nfi\nNODE_STATUS=0', start);
  assert.ok(start > 0 && end > start, 'the Windows node() block was not found in run-tests.sh');
  return SRC.slice(start, end + 4);
}

/* Runs the block in bash with a stand-in node that logs each call (one line of arguments per call, NUL-separated) and
   exits with the status named by a file whose name it sees, else 0. */
function run(files, opts, extra, statusFor) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-chunks-7257-'));
  const log = path.join(dir, 'calls.log');
  const stub = path.join(dir, 'node');
  const st = statusFor ? Object.entries(statusFor).map(([f, c]) => `  case " $* " in *" ${f} "*) code=${c};; esac`).join('\n') : '';
  fs.writeFileSync(stub, `#!/bin/bash\nprintf '%s\\0' "$@" >> "${log.replace(/\\/g, '/')}"\necho >> "${log.replace(/\\/g, '/')}"\ncode=0\n${st}\nexit $code\n`);
  fs.chmodSync(stub, 0o755);
  // A PATH entry for bash: on Windows C:\x is /c/x, since the colon in C: would end the entry.
  const bashDir = dir.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (m, d) => '/' + d.toLowerCase());
  const script = [
    `export PATH="${bashDir}:$PATH"`,
    'set -uo pipefail',   // as run-tests.sh runs (review 2: an unset variable passed here and ended the real script)
    'REPO=/no/such/repo',   // node() reads it to spell a listed file
    '_RT_WIN=1',
    'KOSMOS_TEST_FILES=(' + files.map((f) => `'${f}'`).join(' ') + ')',
    block(),
    `node --test ${opts.map((o) => `'${o}'`).join(' ')} "\${KOSMOS_TEST_FILES[@]}" ${extra.map((o) => `'${o}'`).join(' ')}`,
    'echo "STATUS=$?"',
    'node -e 1; echo "PLAIN=$?"',
  ].join('\n');
  // From a file: a script naming 1500 files is itself over Windows' command-line cap as one bash -c argument.
  const scriptFile = path.join(dir, 'run.sh');
  fs.writeFileSync(scriptFile, script);
  const r = cp.spawnSync('bash', [scriptFile.replace(/\\/g, '/')], { encoding: 'utf8' });
  if (r.error) throw r.error;
  const raw = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
  fs.rmSync(dir, { recursive: true, force: true });
  const calls = raw.split('\n').filter(Boolean).map((l) => l.split('\0').filter((x) => x !== ''));
  return { calls, out: r.stdout, err: r.stderr };
}

const FILES = Array.from({ length: 1500 }, (_, i) => `engine/some-fairly-long-test-file-name-number-${String(i).padStart(4, '0')}.test.js`);
const OPTS = ['--require', '/repo/test-support/launch-guard.js', '--test-timeout=600000'];
const EXTRA = ['--test-name-pattern', 'x'];

test('#7257: on Windows node --test runs every file once, in order, in chunks under the cap, with the same options', { skip: !BASH && 'no bash' }, () => {
  const { calls, out, err } = run(FILES, OPTS, EXTRA);
  const tests = calls.filter((c) => c[0] === '--test');
  assert.ok(tests.length > 1, 'expected several chunks, got ' + tests.length);
  const seen = [];
  for (const c of tests) {
    assert.deepEqual(c.slice(1, 1 + OPTS.length), OPTS, 'each chunk keeps the options');
    assert.deepEqual(c.slice(-EXTRA.length), EXTRA, 'each chunk keeps the trailing arguments');
    assert.ok(c.slice(1).reduce((n, a) => n + a.length + 3, 0) <= 24000, 'a chunk is over the cap');
    seen.push(...c.slice(1 + OPTS.length, -EXTRA.length));
  }
  assert.deepEqual(seen, FILES, 'every file exactly once, in order');
  assert.match(out, /STATUS=0/);
  assert.match(err, new RegExp(`ran in ${tests.length} chunk\\(s\\) over ${FILES.length} file\\(s\\)`));
  // CONTROL: a node call that is not the one over KOSMOS_TEST_FILES goes to node itself, once
  assert.ok(calls.some((c) => c[0] === '-e' && c[1] === '1'));
  assert.match(out, /PLAIN=0/);
});

test('#7257: the worst exit status of any chunk is the node part\'s; one small run is one chunk', { skip: !BASH && 'no bash' }, () => {
  const { out } = run(FILES, OPTS, [], { [FILES[1400]]: 1 });
  assert.match(out, /STATUS=1/, 'a failing file in a later chunk must make the run red');
  const small = run(FILES.slice(0, 5), OPTS, []);
  assert.equal(small.calls.filter((c) => c[0] === '--test').length, 1);
  assert.match(small.err, /ran in 1 chunk\(s\) over 5 file\(s\)/);
});

test('#7257: the node --test line itself is unchanged and the chunking exists only under the Windows flag', () => {
  assert.match(SRC, /if \[ "\$KOSMOS_TEST_PART" != shell \]; then\nnode --test --require/, 'the node --test line must stay flush left');
  assert.match(SRC, /MINGW\*\|MSYS\*\|CYGWIN\*\)\n {4}_RT_WIN=1/, 'the flag is set only in the Windows case');
  assert.equal((SRC.match(/^\s*node\(\) \{/gm) || []).length, 1, 'one node() function');
});

test('#7257 review 1: a test failure outranks a 126/127 from another chunk; a chunk ended by a signal stops the rest', { skip: !BASH && 'no bash' }, () => {
  // chunk A fails a test (1), chunk B cannot start node (127): the run reports the test failure, not "not a failing test"
  assert.match(run(FILES, OPTS, [], { [FILES[10]]: 1, [FILES[1400]]: 127 }).out, /STATUS=1\b/);
  assert.match(run(FILES, OPTS, [], { [FILES[1400]]: 127 }).out, /STATUS=127/, 'CONTROL: 127 alone is still 127');
  // a Ctrl-C (130) in the first chunk: no later chunk starts
  const r = run(FILES, OPTS, [], { [FILES[10]]: 130 });
  assert.match(r.out, /STATUS=130/);
  assert.equal(r.calls.filter((c) => c[0] === '--test').length, 1, 'chunks after an interrupted one must not start');
  assert.match(r.err, /stopped after 1 chunk\(s\) \(exit 130\): \d+ of 1500 file\(s\) not run/, 'an interrupted run must not read as complete');
});

test('#7257 review 1: the Windows flag is reset before the case, so the environment cannot set it', () => {
  assert.match(SRC, /\n_RT_WIN=0 [^\n]*\ncase "\$\(uname -s/);
});

test('#7257 review 2: a run that fits in one chunk (every --only run) runs under set -u, once', { skip: !BASH && 'no bash' }, () => {
  const r = run(FILES.slice(0, 3), OPTS, EXTRA);
  assert.match(r.out, /STATUS=0/, 'the one-chunk run must reach its status: ' + r.err.slice(0, 300));
  assert.doesNotMatch(r.err, /unbound variable/);
  assert.equal(r.calls.filter((c) => c[0] === '--test').length, 1);
});

test('#7257 review 4: after the suite\'s files, a listed file in any spelling is dropped, anything else is refused, options pass', { skip: !BASH && 'no bash' }, () => {
  // a listed file, as written and as ./written: dropped (it runs in its own chunk, once)
  for (const again of [FILES[3], './' + FILES[3]]) {
    const r = run(FILES, OPTS, [again]);
    assert.match(r.out, /STATUS=0/, again);
    assert.equal(r.calls.filter((c) => c[0] === '--test').flat().filter((x) => x === FILES[3] || x === './' + FILES[3]).length, 1, again);
  }
  // another file, a glob, a folder: refused before any chunk runs (they would run once per chunk)
  for (const other of ['engine/not-in-the-list.test.js', 'engine/tasks.test*.js', 'engine']) {
    const r = run(FILES, OPTS, [other]);
    assert.match(r.out, /STATUS=2/, other);
    assert.match(r.err, /Name them with --only/, other);
    assert.equal(r.calls.filter((c) => c[0] === '--test').length, 0, 'nothing runs: ' + other);
  }
  // an option and its value go to every chunk, even when the value names a file
  const r = run(FILES, OPTS, ['--test-name-pattern', 'x', '--import', './tools/x.mjs']);
  const tests = r.calls.filter((c) => c[0] === '--test');
  assert.ok(tests.length > 1);
  for (const c of tests) assert.deepEqual(c.slice(-4), ['--test-name-pattern', 'x', '--import', './tools/x.mjs']);
});

test('#7257 review 4: one file over the cap never leaves a call with no files (node --test would run every test)', { skip: !BASH && 'no bash' }, () => {
  const huge = 'engine/' + 'x'.repeat(24100) + '.test.js';
  const r = run([huge], OPTS, []);
  const tests = r.calls.filter((c) => c[0] === '--test');
  assert.equal(tests.length, 1);
  assert.ok(tests[0].includes(huge));
  assert.match(r.err, /ran in 1 chunk\(s\) over 1 file\(s\)/);
});

test('#7257 review 3: node() expands no array the way bash before 4.4 calls unbound under set -u, and stops after 126/127', { skip: !BASH && 'no bash' }, () => {
  const fn = block();
  assert.doesNotMatch(fn.replace(/\$\{(\w+)\[@\]\+"\$\{\1\[@\]\}"\}/g, ''), /"\$\{(opts|extra|chunk|files)\[@\]\}"/, 'opts, extra, chunk and files are read as ${x[@]+"${x[@]}"}');
  const r = run(FILES, OPTS, [], { [FILES[0]]: 127 });
  assert.match(r.out, /STATUS=127/);
  assert.equal(r.calls.filter((c) => c[0] === '--test').length, 1, 'node cannot run: no later chunk is tried');
});
