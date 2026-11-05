'use strict';
require('./test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/* kosmos#7989 slice 3: on UserPromptSubmit the Mac report hook runs `kosmos file-notices --hook` and prints what it says
 * only when it is the hook's JSON, so Claude Code hands the notice to the model and nothing reaches the person. The
 * real hook, a stand-in for the CLI.
 *   node --test report-hook-filenotices-7989.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const HOOK = path.join(__dirname, 'install', 'kosmos-report-hook.sh');
const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'rhfn-'));
const LOG = path.join(SB, 'calls.log');
const ANSWER = path.join(SB, 'answer.txt');
const CLI = path.join(SB, 'kosmos');
/* Speaks `report` (the six words, as the hook's probe expects), records every call, and answers `file-notices` with the
   contents of ANSWER and the exit code in ANSWER.rc. */
fs.writeFileSync(CLI, '#!/bin/bash\n{ printf "%s|" "$@"; printf "\\n"; } >> "' + LOG + '"\n'
  + '[ "$1" = report ] && [ -z "${2:-}" ] && echo "started working idle needs_you blocked stopped"\n'
  + 'if [ "$1" = file-notices ]; then cat "' + ANSWER + '"; exit "$(cat "' + ANSWER + '.rc" 2>/dev/null || echo 0)"; fi\nexit 0\n');
fs.chmodSync(CLI, 0o755);

function run(event, answer, rc = 0) {
  fs.writeFileSync(LOG, '');
  fs.writeFileSync(ANSWER, answer);
  fs.writeFileSync(ANSWER + '.rc', String(rc));
  const r = cp.spawnSync('bash', [HOOK], { input: JSON.stringify(event), encoding: 'utf8', timeout: 20000,
    env: { ...process.env, KOSMOS_REPORT_CLI: CLI, TMPDIR: SB, KOSMOS_KILL_GUARD: 'off' } });
  assert.equal(r.status, 0, 'the hook always exits 0: ' + r.stderr);
  const calls = fs.readFileSync(LOG, 'utf8').split('\n').filter((l) => l.startsWith('file-notices|'));
  return { out: r.stdout, calls };
}
const JSONLINE = JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'Kosmos file-owner notice: x' } });
const prompt = { hook_event_name: 'UserPromptSubmit', session_id: 's', cwd: '/w' };

test('UserPromptSubmit prints the CLI\'s hook JSON, and asks with --hook', () => {
  const r = run(prompt, JSONLINE + '\n');
  assert.deepEqual(r.calls, ['file-notices|--hook|']);
  assert.equal(r.out, JSONLINE + '\n');
});

test('anything that is not the hook JSON is dropped: nothing, other words, or a failed CLI', () => {
  assert.equal(run(prompt, '').out, '');
  assert.equal(run(prompt, 'Kosmos is not running here\n').out, '');
  assert.equal(run(prompt, JSONLINE + '\n', 1).out, '', 'a failing CLI says nothing even if it printed the JSON');
});

test('no other event asks for file notices', () => {
  for (const ev of ['Stop', 'SessionEnd', 'PreToolUse']) {
    const r = run({ hook_event_name: ev, session_id: 's', cwd: '/w', tool_name: 'Read', tool_input: {} }, JSONLINE + '\n');
    assert.deepEqual(r.calls, [], ev);
    assert.equal(r.out, '', ev);
  }
});
