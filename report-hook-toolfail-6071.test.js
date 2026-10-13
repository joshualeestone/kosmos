'use strict';
require('./test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/* #6071 (slice D1): when a Claude tool call fails (PostToolUseFailure), the report hook sends the board a digest
 * (`kosmos tool-failed <tool> <signature> <error line>`), with jq and without it (a clean Mac has none). The real
 * hook, a recording stand-in for the CLI.
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
fs.writeFileSync(CLI, '#!/bin/bash\nprintf "%s|" "$@" >> "' + LOG + '"; printf "\\n" >> "' + LOG + '"\n'
  + '[ "$1" = report ] && [ -z "${2:-}" ] && echo "started working idle needs_you blocked stopped"\nexit 0\n');
fs.chmodSync(CLI, 0o755);

function run(event, env = {}) {
  fs.writeFileSync(LOG, '');
  const r = cp.spawnSync('bash', [HOOK], { input: JSON.stringify(event), encoding: 'utf8', timeout: 20000,
    env: { ...process.env, KOSMOS_REPORT_CLI: CLI, TMPDIR: SB, KOSMOS_KILL_GUARD: 'off', ...env } });
  assert.equal(r.status, 0, 'the hook always exits 0: ' + r.stderr);
  const lines = fs.readFileSync(LOG, 'utf8').split('\n').filter((l) => l.length);
  return { failed: lines.filter((l) => l.startsWith('tool-failed|')).map((l) => l.split('|')), all: lines };
}
const fail = (tool, input, error, extra) => ({ hook_event_name: 'PostToolUseFailure', tool_name: tool, tool_input: input,
  tool_use_id: 'toolu_' + Math.random().toString(36).slice(2), error, error_type: 'error', is_interrupt: false,
  is_timeout: false, session_id: 'sess-1', cwd: '/w/agent', ...(extra || {}) });

for (const [label, env] of [['with jq', {}], ['without jq', { KOSMOS_REPORT_HOOK_NO_JQ: '1' }]]) {
  test('a failed tool call sends the tool, a signature and the error line, and no report (' + label + ')', () => {
    const r = run(fail('Bash', { command: 'make test' }, 'Exit code 2\nmake: *** [test] Error 2'), env);
    assert.equal(r.failed.length, 1, JSON.stringify(r.all));
    const [, tool, sig, error] = r.failed[0];
    assert.equal(tool, 'Bash');
    assert.match(sig, /^[0-9a-f]{64}$/);
    assert.equal(error, 'Exit code 2', 'only the first line of the error');
    assert.ok(!r.all.some((l) => l.startsWith('report|')), 'a failed call writes no report');
    assert.ok(!r.all.join('\n').includes('make test'), 'the input itself never reaches the CLI');
  });

  test('the same failure gives the same signature, whatever its tool_use_id (' + label + ')', () => {
    const a = run(fail('Bash', { command: 'make test' }, 'Exit code 2'), env).failed[0][2];
    const b = run(fail('Bash', { command: 'make test' }, 'Exit code 2'), env).failed[0][2];
    assert.equal(a, b);
  });

  test('a different input or a different error is a different signature (' + label + ')', () => {
    const base = run(fail('Bash', { command: 'make test' }, 'Exit code 2'), env).failed[0][2];
    assert.notEqual(run(fail('Bash', { command: 'make test2' }, 'Exit code 2'), env).failed[0][2], base);
    assert.notEqual(run(fail('Bash', { command: 'make test' }, 'Exit code 1'), env).failed[0][2], base);
  });

  test('an interrupt is the person stopping the call, so nothing is sent (' + label + ')', () => {
    assert.deepEqual(run(fail('Bash', { command: 'sleep 100' }, 'Interrupted', { is_interrupt: true }), env).failed, []);
  });
}

test('with jq, key order in the input does not change the signature', () => {
  const a = run(fail('Edit', { file_path: '/w/a', old_string: 'x', new_string: 'y' }, 'String not found')).failed[0][2];
  const b = run(fail('Edit', { new_string: 'y', file_path: '/w/a', old_string: 'x' }, 'String not found')).failed[0][2];
  assert.equal(a, b);
});

test('a control character in the error does not split the CLI arguments', () => {
  const r = run(fail('Bash', { command: 'x' }, 'bad\tthing'));
  assert.equal(r.failed.length, 1);
  assert.equal(r.failed[0].length, 5, 'tool-failed, tool, sig, error, and the trailing empty field: ' + JSON.stringify(r.failed[0]));
});

test('with no runnable CLI the hook still exits 0 and sends nothing', () => {
  fs.writeFileSync(LOG, '');
  const r = cp.spawnSync('bash', [HOOK], { input: JSON.stringify(fail('Bash', { command: 'x' }, 'e')), encoding: 'utf8', timeout: 20000,
    env: { ...process.env, KOSMOS_REPORT_CLI: path.join(SB, 'missing'), TMPDIR: SB, KOSMOS_KILL_GUARD: 'off' } });
  assert.equal(r.status, 0);
  assert.equal(fs.readFileSync(LOG, 'utf8'), '');
});
