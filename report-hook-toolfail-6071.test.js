'use strict';
require('./test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/* #6071 (slice D1): when a Claude tool call fails (PostToolUseFailure), the report hook sends the board a digest
 * (`kosmos tool-failed <tool> <signature>`, the error line on stdin), with jq and without it (a clean Mac has none).
 * The real hook, a recording stand-in for the CLI. The hook sends it in the background, so each run waits for the
 * stand-in to finish writing.
 *   node --test report-hook-toolfail-6071.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const HOOK = path.join(__dirname, 'install', 'kosmos-report-hook.sh');
const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'rhtf-'));
const LOG = path.join(SB, 'calls.log');
const CLI = path.join(SB, 'kosmos');
/* Speaks `report` (answers with the six words, as the hook's probe expects) and records every call. */
fs.writeFileSync(CLI, '#!/bin/bash\nIN=$(cat)\n{ printf "%s|" "$@"; printf "STDIN=%s\\n" "$IN"; } >> "' + LOG + '"\n'
  + '[ "$1" = report ] && [ -z "${2:-}" ] && echo "started working idle needs_you blocked stopped"\nexit 0\n');
fs.chmodSync(CLI, 0o755);

function sleepMs(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function run(event, env = {}, expect = 1) {
  fs.writeFileSync(LOG, '');
  const r = cp.spawnSync('bash', [HOOK], { input: JSON.stringify(event), encoding: 'utf8', timeout: 20000,
    env: { ...process.env, KOSMOS_REPORT_CLI: CLI, TMPDIR: SB, KOSMOS_KILL_GUARD: 'off', ...env } });
  assert.equal(r.status, 0, 'the hook always exits 0: ' + r.stderr);
  /* The hook backgrounds the call: wait (at most 5 s) for the expected number of lines, then a little longer so a
     line that should NOT be there has had time to appear. */
  const lines = () => fs.readFileSync(LOG, 'utf8').split('\n').filter((l) => l.length);
  for (let i = 0; i < 100 && lines().filter((l) => l.startsWith('tool-failed|')).length < expect; i++) sleepMs(50);
  sleepMs(expect ? 50 : 400);
  const all = lines();
  return { failed: all.filter((l) => l.startsWith('tool-failed|')).map((l) => l.split('|')), all };
}
/* The shape Claude Code 2.1.296 builds: a per-call tool_use_id and duration_ms, which must never split a signature. */
const fail = (tool, input, error, extra) => ({ hook_event_name: 'PostToolUseFailure', tool_name: tool, tool_input: input,
  tool_use_id: 'toolu_' + Math.random().toString(36).slice(2), error, is_interrupt: false,
  duration_ms: Math.floor(Math.random() * 90000) + 10, session_id: 'sess-1', cwd: '/w/agent', ...(extra || {}) });

for (const [label, env] of [['with jq', {}], ['without jq', { KOSMOS_REPORT_HOOK_NO_JQ: '1' }]]) {
  test('a failed tool call sends the tool, a signature and the error line, and no report (' + label + ')', () => {
    const r = run(fail('Bash', { command: 'make test' }, 'Exit code 2\nmake: *** [test] Error 2'), env);
    assert.equal(r.failed.length, 1, JSON.stringify(r.all));
    const [, tool, sig, rest] = r.failed[0];
    assert.equal(tool, 'Bash');
    assert.match(sig, /^[0-9a-f]{64}$/);
    assert.equal(rest, 'STDIN=Exit code 2', 'the error\'s first line, on stdin and not as an argument');
    assert.ok(!r.all.some((l) => l.startsWith('report|')), 'a failed call writes no report');
    assert.ok(!r.all.join('\n').includes('make test'), 'the input itself never reaches the CLI');
  });

  test('the same failure gives the same signature, whatever its tool_use_id (' + label + ')', () => {
    const a = run(fail('Bash', { command: 'make test' }, 'Exit code 2'), env).failed[0][2];
    const b = run(fail('Bash', { command: 'make test' }, 'Exit code 2'), env).failed[0][2];
    assert.equal(a, b);
  });

  test('a different input or a different error, even past its first line, is a different signature (' + label + ')', () => {
    const base = run(fail('Bash', { command: 'make test' }, 'Exit code 2\n3 tests failed'), env).failed[0][2];
    assert.notEqual(run(fail('Bash', { command: 'make test2' }, 'Exit code 2\n3 tests failed'), env).failed[0][2], base);
    assert.notEqual(run(fail('Bash', { command: 'make test' }, 'Exit code 1\n3 tests failed'), env).failed[0][2], base);
    assert.notEqual(run(fail('Bash', { command: 'make test' }, 'Exit code 2\n2 tests failed'), env).failed[0][2], base,
      'a rerun whose output changed is progress, not the same failure');
  });

  test('an interrupt is the person stopping the call, so nothing is sent (' + label + ')', () => {
    assert.deepEqual(run(fail('Bash', { command: 'sleep 100' }, 'Interrupted', { is_interrupt: true }), env, 0).failed, []);
  });
}

test('with jq, key order in the input does not change the signature', () => {
  const a = run(fail('Edit', { file_path: '/w/a', old_string: 'x', new_string: 'y' }, 'String not found')).failed[0][2];
  const b = run(fail('Edit', { new_string: 'y', file_path: '/w/a', old_string: 'x' }, 'String not found')).failed[0][2];
  assert.equal(a, b);
});

for (const [label, env] of [['with jq', {}], ['without jq', { KOSMOS_REPORT_HOOK_NO_JQ: '1' }]]) {
  test('an is_interrupt key inside the tool input or the error does not hide a real failure (' + label + ')', () => {
    assert.equal(run(fail('mcp__x__do', { is_interrupt: true }, 'boom'), env).failed.length, 1, 'in the input');
    assert.equal(run(fail('Bash', { command: 'x' }, 'saw "is_interrupt": true in the log'), env).failed.length, 1, 'in the error');
    assert.deepEqual(run(fail('mcp__x__do', { is_interrupt: false }, 'stop', { is_interrupt: true }), env, 0).failed, [], 'the real top-level key still wins');
  });
}

test('with no runnable CLI the hook still exits 0 and sends nothing', () => {
  fs.writeFileSync(LOG, '');
  const r = cp.spawnSync('bash', [HOOK], { input: JSON.stringify(fail('Bash', { command: 'x' }, 'e')), encoding: 'utf8', timeout: 20000,
    env: { ...process.env, KOSMOS_REPORT_CLI: path.join(SB, 'missing'), TMPDIR: SB, KOSMOS_KILL_GUARD: 'off' } });
  assert.equal(r.status, 0);
  assert.equal(fs.readFileSync(LOG, 'utf8'), '');
});

test('a jq that fails on the signature sends nothing, rather than the one hash of nothing for every failure', () => {
  /* It must fail ONLY on the signature's -cS call: a jq that fails everywhere cannot read the event name, so the hook
     stops before this branch and the test would pass for the wrong reason. */
  const real = cp.execFileSync('/bin/sh', ['-c', 'command -v jq || true'], { encoding: 'utf8' }).trim() || '/usr/bin/jq';
  const bin = path.join(SB, 'badjq');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'jq'), '#!/bin/sh\n[ "$1" = "-cS" ] && exit 1\nexec "' + real + '" "$@"\n');
  fs.chmodSync(path.join(bin, 'jq'), 0o755);
  /* The control: the same fake jq on a call it passes through still reads the event (a failure WITH a signature). */
  assert.ok(fs.existsSync(real), 'no real jq on this machine to pass through to: ' + real);
  const r = run(fail('Bash', { command: 'x' }, 'e'), { PATH: bin + ':' + process.env.PATH }, 0);
  assert.deepEqual(r.failed, []);
});
