'use strict';
/**
 * #4671: the report hook refuses a tool call that would stop EVERY process the person owns.
 *
 * On 2026-09-29 a review subagent on a Kosmos Mac ran a script that signalled pid -1, which ended the
 * person's whole login session. The hook (install/kosmos-report-hook.sh) runs on every PreToolUse, so it
 * blocks the LITERAL shapes: exit 2 with the reason on stderr, which Claude Code shows the agent instead
 * of running the tool. These strings are only ever fed to the hook as JSON TEXT; nothing here runs them.
 *
 * Every case drives the REAL hook with a hook payload on stdin. The CLI it would report through is a stub
 * (KOSMOS_REPORT_CLI), so no case reaches a real board. Each block case also runs with jq disabled
 * (KOSMOS_REPORT_HOOK_NO_JQ), the path a clean Mac takes.
 *
 * CONTROLS: the allowed cases (a named pid, SIGHUP to one pid, a group kill, killall by name, a mention in
 * a description, deleting the dangerous line) must exit 0, so a guard that blocks everything cannot pass.
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

function run(tool, toolInput, { event = 'PreToolUse', noJq = false } = {}) {
  const payload = JSON.stringify({ hook_event_name: event, tool_name: tool, tool_input: toolInput, session_id: 's' });
  const env = { ...process.env, KOSMOS_REPORT_CLI: STUB, TMPDIR: SANDBOX, HOME: SANDBOX };
  delete env.TMUX_PANE; delete env.KOSMOS_AGENT_SESSION; delete env.KOSMOS_AGENT_TOKEN;
  if (noJq) env.KOSMOS_REPORT_HOOK_NO_JQ = '1'; else delete env.KOSMOS_REPORT_HOOK_NO_JQ;
  const r = spawnSync('/bin/bash', [HOOK], { input: payload, env, encoding: 'utf8', timeout: 20000 });
  return { code: r.status, stderr: r.stderr || '' };
}

const BLOCKED_BASH = [
  'kill -9 -1',
  'kill -KILL -1',
  'kill -SIGKILL -1',
  'kill -- -1',
  'kill -9 -- -1',
  'kill -s KILL -1',
  '/bin/kill -9 -1',
  'sudo kill -9 -1',
  'kill -1 -1',
  'kill -9 "-1"',
  "kill -9 '-1'",
  'kill\t-9\t-1',
  'x=`kill -9 -1`',
  'kill -9 -1>/dev/null',
  'sleep 1; kill -9 -1 && echo done',
  'cd /tmp\nkill -9 -1\necho after',
  'echo -1 | xargs kill -9',
  'killall -u "$USER"',
  'killall -m .',
  'pkill -u "$(whoami)"',
  'pkill -9 -u 501 node',
  'pkill -U 501',
  'pkill -u501',
  'pkill -f .',
  "pkill -9 -f ''",
  'kill -9 $(pgrep -u "$USER")',
  'pgrep -u "$USER" | xargs kill -9',
  `node -e "process.kill(-1, 'SIGKILL')"`,
  'node -e "process.kill(- 1, 9)"',
  'node -e "process.kill(-1)"',
  "python3 -c 'import os, signal; os.kill(-1, signal.SIGKILL)'",
  `ruby -e 'Process.kill("KILL", -1)'`,
  "perl -e 'kill 9, -1'",
  `node -e "require('child_process').spawnSync('kill', ['-9', '-1'])"`,
  `python3 -c "import subprocess; subprocess.run(['kill', '-9', '-1'])"`,
  'launchctl bootout gui/501',
  'launchctl bootout gui/$(id -u)',
  'launchctl reboot userspace',
];
const ALLOWED_BASH = [
  'kill -9 12345',
  'kill -1 12345',          // SIGHUP to ONE process
  'kill -TERM -- -4242',    // one process group, bounded
  'kill 0',
  'killall Dock',           // by name, not everything
  'killall -HUP mDNSResponder',
  'which killall && man pkill',
  'pkill -f "^/bin/sleep 9$"',
  'pgrep -u "$USER" node',  // lists, kills nothing
  'echo skill-1 && ls ./killall-notes',
  'git log --oneline -1',
  `node -e "process.kill(12345, 'SIGTERM')"`,
  'node -e "process.kill(-1, 0)"',   // signal 0 sends nothing
  'node -e "player.kill(-1)"',
  'launchctl bootout gui/501/com.example.job',
  'launchctl bootout gui/$(id -u)/com.example.job',
];

for (const noJq of [false, true]) {
  const how = noJq ? ' (no jq)' : '';
  for (const cmd of BLOCKED_BASH) {
    test(`#4671 blocks Bash${how}: ${JSON.stringify(cmd)}`, () => {
      const r = run('Bash', { command: cmd }, { noJq });
      assert.equal(r.code, 2, 'must block (exit 2): ' + r.stderr);
      assert.match(r.stderr, /kosmos#4671/);
      assert.match(r.stderr, /Kosmos blocked this Bash call/);
    });
  }
  for (const cmd of ALLOWED_BASH) {
    test(`#4671 CONTROL allows Bash${how}: ${JSON.stringify(cmd)}`, () => {
      const r = run('Bash', { command: cmd }, { noJq });
      assert.equal(r.code, 0, 'must not block: ' + r.stderr);
    });
  }
}

test('#4671 guards any tool that runs a command (Monitor) and the tools that write code', () => {
  assert.equal(run('Monitor', { command: 'kill -9 -1' }).code, 2);
  assert.equal(run('Write', { file_path: '/tmp/x.js', content: "process.kill(-1, 'SIGKILL');\n" }).code, 2);
  assert.equal(run('Write', { file_path: '/tmp/x.sh', content: '#!/bin/sh\nkill -9 -1\n' }).code, 2);
  assert.equal(run('Edit', { file_path: '/tmp/x.sh', old_string: 'echo hi', new_string: 'kill -9 -1' }).code, 2);
  assert.equal(run('MultiEdit', { file_path: '/tmp/x.sh', edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'killall -u me' }] }).code, 2);
  assert.equal(run('NotebookEdit', { notebook_path: '/tmp/n.ipynb', new_source: 'import os\nos.kill(-1, 9)' }).code, 2);
});

test('#4671 CONTROL: only what runs or is written is read (with jq)', () => {
  assert.equal(run('Bash', { command: 'echo ok', description: 'kill stale pkill -u runs, kill -9 -1' }).code, 0, 'a description is not run');
  assert.equal(run('Edit', { file_path: '/tmp/x.sh', old_string: 'kill -9 -1', new_string: '' }).code, 0, 'deleting the line must be allowed');
  assert.equal(run('Write', { file_path: '/tmp/x.js', content: "child.kill('SIGKILL');\nprocess.kill(pid, 0);\n" }).code, 0);
  assert.equal(run('Read', { file_path: '/tmp/kill -9 -1.txt' }).code, 0, 'a path argument is not a command');
});

test('#4671 only PreToolUse is guarded: the same payload on another event is not blocked', () => {
  assert.equal(run('Bash', { command: 'kill -9 -1' }, { event: 'PostToolUse' }).code, 0);
});

test('#4671 KNOWN GAP, pinned so it is not mistaken for coverage: a pid computed at run time passes', () => {
  // The 2026-09-29 script itself: -1 sat in a list, and the call took a variable. A text match cannot
  // see that; the card records the runtime guard that could, and why it is a separate decision.
  const r = run('Write', { file_path: '/tmp/t.js', content: "const pids = [-1, 999999];\nfor (const pid of pids) process.kill(pid, 'SIGKILL');\n" });
  assert.equal(r.code, 0);
});
