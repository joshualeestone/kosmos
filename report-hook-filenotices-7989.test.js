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
/* One write per call: the hook runs `report` in the background beside `file-notices`, and two writers appending an
   argument at a time interleave their lines. */
fs.writeFileSync(CLI, '#!/bin/bash\nL=$(printf "%s|" "$@")\nprintf "%s\\n" "$L" >> "' + LOG + '"\n'
  + '[ "$1" = report ] && [ -z "${2:-}" ] && echo "started working idle needs_you blocked stopped"\n'
  + 'if [ "$1" = file-notices ]; then cat "' + ANSWER + '"; exit "$(cat "' + ANSWER + '.rc" 2>/dev/null || echo 0)"; fi\nexit 0\n');
fs.chmodSync(CLI, 0o755);

let paneN = 0;
function run(event, answer, rc = 0, pane = '%fn' + (paneN++), token = '') {
  fs.writeFileSync(LOG, '');
  fs.writeFileSync(ANSWER, answer);
  fs.writeFileSync(ANSWER + '.rc', String(rc));
  const r = cp.spawnSync('bash', [HOOK], { input: JSON.stringify(event), encoding: 'utf8', timeout: 20000,
    env: { ...process.env, KOSMOS_REPORT_CLI: CLI, TMPDIR: SB, KOSMOS_KILL_GUARD: 'off', TMUX_PANE: pane, KOSMOS_AGENT_TOKEN: token } });
  assert.equal(r.status, 0, 'the hook always exits 0: ' + r.stderr);
  const calls = fs.readFileSync(LOG, 'utf8').split('\n').filter((l) => l.startsWith('file-notices|'));
  return { out: r.stdout, calls, pane };
}
/* The call the hook makes for `pane`: --hook and its ack file, beside the pane's throttle mark. */
const callFor = (pane) => 'file-notices|--hook|--ack-file|' + path.join(SB, 'kosmos-report-throttle', pane.replace(/[^A-Za-z0-9_-]/g, '_') + '.filenotices-ack') + '|';
const JSONLINE = JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'Kosmos file-owner notice: x' } });
const prompt = { hook_event_name: 'UserPromptSubmit', session_id: 's', cwd: '/w' };

test('UserPromptSubmit prints the CLI\'s hook JSON, and asks with --hook', () => {
  const r = run(prompt, JSONLINE + '\n');
  assert.deepEqual(r.calls, [callFor(r.pane)]);
  assert.equal(r.out, JSONLINE + '\n');
});

test('anything that is not the hook JSON is dropped: nothing, other words, or a failed CLI', () => {
  assert.equal(run(prompt, '').out, '');
  assert.equal(run(prompt, 'Kosmos is not running here\n').out, '');
  assert.equal(run(prompt, JSONLINE + '\n', 1).out, '', 'a failing CLI says nothing even if it printed the JSON');
});

test('a pane asks at most once per FILE_NOTICE_EVERY: a second prompt soon after makes no call; a stale mark asks again', () => {
  const first = run(prompt, JSONLINE + '\n', 0, '%throttle');
  assert.deepEqual(first.calls, [callFor('%throttle')]);
  const second = run(prompt, JSONLINE + '\n', 0, '%throttle');
  assert.deepEqual(second.calls, [], 'the second prompt within the window does not call');
  assert.equal(second.out, '');
  const mark = path.join(SB, 'kosmos-report-throttle', '_throttle.filenotices');
  assert.ok(fs.existsSync(mark), 'control: the mark is where the test looks: ' + mark);
  fs.writeFileSync(mark, String(Math.floor(Date.now() / 1000) - 301) + '\n');
  assert.deepEqual(run(prompt, JSONLINE + '\n', 0, '%throttle').calls, [callFor('%throttle')], 'past the window it asks again');
  fs.writeFileSync(mark, 'garbage\n');
  assert.deepEqual(run(prompt, JSONLINE + '\n', 0, '%throttle').calls, [callFor('%throttle')], 'an unreadable mark is treated as old');
});

test('a mark that cannot be written means no call: the cost would land on the turn every time', () => {
  const dir = path.join(SB, 'kosmos-report-throttle');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, '_nowrite.filenotices'));   // a folder where the mark goes: the write fails
  const r = run(prompt, JSONLINE + '\n', 0, '%nowrite');
  assert.deepEqual(r.calls, []);
  assert.equal(r.out, '');
  assert.deepEqual(run(prompt, JSONLINE + '\n', 0, '%canwrite').calls, [callFor('%canwrite')], 'control: a writable mark does call');
});

test('with an agent token the mark and ack file are the agent\'s, not the pane\'s: one agent on two panes shares them, two agents on one pane do not', () => {
  const T1 = '11'.repeat(16);
  const T2 = '22'.repeat(16);
  const a = run(prompt, JSONLINE + '\n', 0, '%shared', T1);
  assert.equal(a.calls.length, 1);
  assert.match(a.calls[0], /\/agent-[0-9a-f]{16}\.filenotices-ack\|$/, 'keyed by the token\'s hash: ' + a.calls[0]);
  assert.ok(!a.calls[0].includes(T1), 'the token itself is never in a path');
  assert.deepEqual(run(prompt, JSONLINE + '\n', 0, '%other', T1).calls, [], 'the same agent on another pane is throttled with it');
  const b = run(prompt, JSONLINE + '\n', 0, '%shared', T2);
  assert.equal(b.calls.length, 1, 'another agent on the same pane key has its own window');
  assert.notEqual(b.calls[0], a.calls[0], 'and its own ack file');
});

test('no agent token and no pane (the person\'s own session): no call, since the board could never say who is asking', () => {
  assert.deepEqual(run(prompt, JSONLINE + '\n', 0, '', '').calls, []);
  assert.deepEqual(run(prompt, JSONLINE + '\n', 0, '', '33'.repeat(16)).calls.length, 1, 'control: a token alone asks');
});

test('no other event asks for file notices', () => {
  for (const ev of ['Stop', 'SessionEnd', 'PreToolUse']) {
    const r = run({ hook_event_name: ev, session_id: 's', cwd: '/w', tool_name: 'Read', tool_input: {} }, JSONLINE + '\n');
    assert.deepEqual(r.calls, [], ev);
    assert.equal(r.out, '', ev);
  }
});
