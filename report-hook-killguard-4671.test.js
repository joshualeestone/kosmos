'use strict';
/**
 * #4671: the report hook refuses a tool call that would signal EVERY process the person owns.
 *
 * On 2026-09-29 a review subagent on a Kosmos Mac ran a script that signalled pid -1, which ended the
 * person's whole login session. The hook (install/kosmos-report-hook.sh) runs on every PreToolUse, so it
 * blocks the literal shapes: exit 2 with the reason on stderr, which Claude Code shows the agent instead
 * of running the tool.
 *
 * Every case drives the REAL hook with a hook payload on stdin. The CLI it would report through is a stub
 * (KOSMOS_REPORT_CLI) that only records that it ran, so no case reaches a real board.
 *
 * CONTROLS: the allowed cases (kill of a named pid, SIGHUP to one pid, a group kill, a word that merely
 * contains "kill") must exit 0, so a guard that blocks everything cannot pass.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOK = path.join(__dirname, 'install', 'kosmos-report-hook.sh');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-4671-'));
const STUB = path.join(SANDBOX, 'kosmos');
fs.writeFileSync(STUB, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

function run(tool, toolInput, event = 'PreToolUse') {
  const payload = JSON.stringify({ hook_event_name: event, tool_name: tool, tool_input: toolInput, session_id: 's' });
  const env = { ...process.env, KOSMOS_REPORT_CLI: STUB, TMPDIR: SANDBOX, HOME: SANDBOX };
  delete env.TMUX_PANE; delete env.KOSMOS_AGENT_SESSION; delete env.KOSMOS_AGENT_TOKEN;
  const r = spawnSync('/bin/bash', [HOOK], { input: payload, env, encoding: 'utf8', timeout: 20000 });
  return { code: r.status, stderr: r.stderr || '' };
}

const BLOCKED_BASH = [
  'kill -9 -1',
  'kill -KILL -1',
  'kill -- -1',
  'kill -s KILL -1',
  '/bin/kill -9 -1',
  'kill -1 -1',
  'sleep 1; kill -9 -1 && echo done',
  'cd /tmp\nkill -9 -1\necho after',
  'killall node',
  'pkill -u "$(whoami)"',
  'pkill -9 -u 501 node',
  `node -e "process.kill(-1, 'SIGKILL')"`,
  "python3 -c 'import os, signal; os.kill(-1, signal.SIGKILL)'",
];
const ALLOWED_BASH = [
  'kill -9 12345',
  'kill -1 12345',          // SIGHUP to ONE process
  'kill -TERM -- -4242',    // one process group, bounded
  'kill 0',
  'pkill -f "^/bin/sleep 9$"',
  'echo skill-1 && ls ./killall-notes',
  'git log --oneline -1',
  `node -e "process.kill(12345, 'SIGTERM')"`,
];

for (const cmd of BLOCKED_BASH) {
  test(`#4671 blocks Bash: ${JSON.stringify(cmd)}`, () => {
    const r = run('Bash', { command: cmd });
    assert.equal(r.code, 2, 'must block (exit 2): ' + r.stderr);
    assert.match(r.stderr, /kosmos#4671/);
    assert.match(r.stderr, /EVERY process you own/);
  });
}
for (const cmd of ALLOWED_BASH) {
  test(`#4671 CONTROL allows Bash: ${JSON.stringify(cmd)}`, () => {
    const r = run('Bash', { command: cmd });
    assert.equal(r.code, 0, 'must not block: ' + r.stderr);
  });
}

test('#4671 blocks a Write of code that signals pid -1, and an Edit that adds it', () => {
  const w = run('Write', { file_path: '/tmp/x.js', content: "for (const p of ps) {}\nprocess.kill(-1, 'SIGKILL');\n" });
  assert.equal(w.code, 2, w.stderr);
  const e = run('Edit', { file_path: '/tmp/x.sh', old_string: 'echo hi', new_string: 'kill -9 -1' });
  assert.equal(e.code, 2, e.stderr);
});

test('#4671 CONTROL: a Write of ordinary kill code, and a Read of anything, pass', () => {
  assert.equal(run('Write', { file_path: '/tmp/x.js', content: "child.kill('SIGKILL');\nprocess.kill(pid, 0);\n" }).code, 0);
  assert.equal(run('Read', { file_path: '/tmp/kill -9 -1.txt' }).code, 0, 'only tools that run or write code are checked');
});

test('#4671 only PreToolUse is guarded: the same payload on another event is not blocked', () => {
  assert.equal(run('Bash', { command: 'kill -9 -1' }, 'PostToolUse').code, 0);
});

test('#4671 KNOWN GAP, pinned so it is not mistaken for coverage: a pid computed at run time passes', () => {
  // The 2026-09-29 script itself: -1 sat in a list, and the call took a variable. A text match cannot
  // see that; the card records the runtime guard that could, and why it is a separate decision.
  const r = run('Write', { file_path: '/tmp/t.js', content: "const pids = [-1, 999999];\nfor (const pid of pids) process.kill(pid, 'SIGKILL');\n" });
  assert.equal(r.code, 0);
});
