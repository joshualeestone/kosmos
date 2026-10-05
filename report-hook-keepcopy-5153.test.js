'use strict';
require('./test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/* #5153 slice 4: just before Claude edits a file, the report hook asks the board to keep a copy (`kosmos keep-copy`),
 * for the four editing tools only, with jq and without it (a clean Mac has none). The real hook, a recording stand-in
 * for the CLI.
 *   node --test report-hook-keepcopy-5153.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const HOOK = path.join(__dirname, 'install', 'kosmos-report-hook.sh');
const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'rhkc-'));
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
  assert.equal(r.status, 0, 'the hook must let the edit go ahead: ' + r.stderr);
  return fs.readFileSync(LOG, 'utf8').split('\n').filter((l) => l.startsWith('keep-copy|'));
}
const pre = (tool, input) => ({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, cwd: '/w/agent', session_id: 'sess-1' });

for (const [label, env] of [['with jq', {}], ['without jq', { KOSMOS_REPORT_HOOK_NO_JQ: '1' }]]) {
  test('an Edit or a Write asks the board to keep a copy first, with the session\'s folder and id (' + label + ')', () => {
    assert.deepEqual(run(pre('Edit', { file_path: '/w/agent/notes.md', old_string: 'a', new_string: 'b' }), env),
      ['keep-copy|/w/agent/notes.md|/w/agent|sess-1|']);
    assert.deepEqual(run(pre('Write', { file_path: '/w/agent/new file.md', content: 'x' }), env),
      ['keep-copy|/w/agent/new file.md|/w/agent|sess-1|'], 'a path with a space stays one argument');
  });
  test('a command, a read or a search asks for no copy (' + label + ')', () => {
    assert.deepEqual(run(pre('Bash', { command: 'rm notes.md' }), env), []);
    assert.deepEqual(run(pre('Read', { file_path: '/w/agent/notes.md' }), env), []);
  });
}

test('a NotebookEdit keeps a copy of the notebook (its path field differs)', () => {
  assert.deepEqual(run(pre('NotebookEdit', { notebook_path: '/w/agent/a.ipynb', new_source: 'x' })), ['keep-copy|/w/agent/a.ipynb|/w/agent|sess-1|']);
});
