'use strict';
/**
 * #4671: the report hook refuses a tool call that would stop EVERY process the person owns.
 *
 * On 2026-09-29 a review subagent on a Kosmos Mac ran a script that sent SIGKILL to process id minus one,
 * which ended the person's whole login session. The hook (install/kosmos-report-hook.sh) runs on every
 * PreToolUse, so it blocks the LITERAL shapes: exit 2 with the reason on stderr, which Claude Code shows the
 * agent instead of running the tool. These strings are only ever fed to the hook as JSON TEXT; nothing here
 * runs them.
 *
 * ⚠️ The cases are written with UPPERCASE placeholders (KILL, PKILL, KILLALL, PGREP, LAUNCHCTL, N1) and
 * decoded at run time. The guard is case-sensitive on purpose, so this file never holds a literal shape
 * and an agent maintaining it is not refused by the guard it is testing.
 *
 * Every case drives the REAL hook with a hook payload on stdin. The CLI it would report through is a stub
 * (KOSMOS_REPORT_CLI), so no case reaches a real board. Each Bash case also runs with jq disabled
 * (KOSMOS_REPORT_HOOK_NO_JQ), the path a clean Mac takes.
 *
 * CONTROLS: the allowed cases (a named pid, SIGHUP to one pid, a group kill, pkill/killall by name, a
 * reload signal, bootout of one service, a mention in a description, deleting the dangerous line) must
 * exit 0, so a guard that blocks everything cannot pass.
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

const WORDS = { KILLALL: 'killall', PKILL: 'pkill', PGREP: 'pgrep', LAUNCHCTL: 'launchctl', KILL: 'kill', N1: '-1' };
const d = (s) => s.replace(/KILLALL|PKILL|PGREP|LAUNCHCTL|KILL|N1/g, (w) => WORDS[w]);
const dd = (v) => (typeof v === 'string' ? d(v) : Array.isArray(v) ? v.map(dd)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, dd(x)])) : v);

function run(tool, toolInput, { event = 'PreToolUse', noJq = false, env: extra = {}, raw = false } = {}) {
  const payload = JSON.stringify({ hook_event_name: event, tool_name: tool, tool_input: raw ? toolInput : dd(toolInput), session_id: 's' });
  const env = { ...process.env, KOSMOS_REPORT_CLI: STUB, TMPDIR: SANDBOX, HOME: SANDBOX, ...extra };
  delete env.TMUX_PANE; delete env.KOSMOS_AGENT_SESSION; delete env.KOSMOS_AGENT_TOKEN;
  if (!('KOSMOS_KILL_GUARD' in extra)) delete env.KOSMOS_KILL_GUARD;
  if (noJq) env.KOSMOS_REPORT_HOOK_NO_JQ = '1'; else delete env.KOSMOS_REPORT_HOOK_NO_JQ;
  const r = spawnSync('/bin/bash', [HOOK], { input: payload, env, encoding: 'utf8', timeout: 20000 });
  return { code: r.status, stderr: r.stderr || '' };
}

const BLOCKED_BASH = [
  'KILL -9 N1', 'KILL -KILL N1', 'KILL -SIGKILL N1', 'KILL -- N1', 'KILL -9 -- N1', 'KILL -s KILL N1',
  '/bin/KILL -9 N1', 'sudo KILL -9 N1', 'KILL -1 N1', 'KILL -9 "N1"', "KILL -9 'N1'", 'KILL\t-9\tN1',
  'x=`KILL -9 N1`', 'KILL -9 N1>/dev/null', 'sleep 1; KILL -9 N1 && echo done', 'cd /tmp\nKILL -9 N1\necho after',
  'echo N1 | xargs KILL -9', "printf -- 'N1' | xargs KILL", 'xargs KILL -9 <<< N1',
  'KILLALL -u "$USER"', 'KILLALL -m .', 'PKILL -u "$(whoami)"', 'PKILL -9 -u 501', 'PKILL -U 501', 'PKILL -u501',
  'PKILL -f .', "PKILL -9 -f ''", 'PKILL .', 'PKILL -f ^',
  'KILL -9 $(PGREP -u "$USER")', 'PGREP -u "$USER" | xargs KILL -9',
  'PGREP -u $USER -l node; node -e "process.KILL(N1, 9)"',   // round 2 B1: a benign pgrep must not hide another arm
  'PGREP -u $USER; PKILL -f .',
  `node -e "process.KILL(N1, 'SIGKILL')"`, 'node -e "process.KILL(- 1, 9)"', 'node -e "process.KILL(N1)"',
  "node -e \"require('process').KILL(N1, 9)\"",
  "python3 -c 'import os, signal; os.KILL(N1, signal.SIGKILL)'",
  `ruby -e 'Process.KILL("KILL", N1)'`, "perl -e 'KILL 9, N1'", "perl -e 'KILL KILL => N1'",
  `node -e "require('child_process').spawnSync('KILL', ['-9', 'N1'])"`,
  `python3 -c "import subprocess; subprocess.call(['/bin/KILL', '-9', 'N1'])"`,
  'LAUNCHCTL bootout gui/501', 'LAUNCHCTL bootout gui/$(id -u)', 'LAUNCHCTL bootout gui/"$(id -u)"',
  'LAUNCHCTL bootout gui/$UID', 'LAUNCHCTL reboot userspace',
  // round 3: a signal NAME before the user flag, and a flag after the user operand
  'PKILL -TERM -u 501', 'PKILL -HUP -U "$USER"', 'KILLALL -TERM -u $USER', 'KILLALL -SIGTERM -m .', 'PKILL -TERM -f .',
  'KILLALL -u me -v', 'PKILL -u 501 -x',
  // round 4: a redirect after the command; a pgrep feeding a kill through a loop, a variable or backticks
  'PKILL -u $USER 2>/dev/null', 'PKILL -u $USER >/dev/null 2>&1', 'KILLALL -9 -u "$USER" 2>/dev/null',
  'PKILL -f . 2>/dev/null', 'LAUNCHCTL bootout gui/501 2>/dev/null', 'LAUNCHCTL bootout gui/$(id -u) 2>&1 | tail',
  'for p in $(PGREP -u $USER); do KILL -9 $p; done', 'PIDS=$(PGREP -u $USER); KILL -9 $PIDS',
  'PGREP -u $USER | while read p; do KILL -9 $p; done', 'KILL -9 `PGREP -u $USER`', 'xargs KILL -9 < <(PGREP -u $USER)',
  'PGREP -f . | xargs KILL -9', 'KILL -9 $(PGREP -f .)',
  'node -e "globalThis.process.KILL(N1, 9)"', 'KILL -9 "$pid" N1', 'KILL -9 $PID N1',
  'LAUNCHCTL bootout "gui/$(id -u)"',
  "perl -e 'KILL(9, N1)'", "perl -e 'KILL -9, N1'", "perl -e 'KILL(\"KILL\", N1)'", "perl -e 'KILL \"KILL\", N1'",
  'KILLALL loginwindow', 'KILLALL -9 WindowServer', 'PKILL -x loginwindow',
];
const ALLOWED_BASH = [
  'KILL -9 12345', 'KILL -1 12345', 'KILL -TERM -- -4242', 'KILL 0',
  'KILLALL Dock', 'KILLALL -HUP mDNSResponder', 'KILLALL -term node', 'KILLALL -u $USER node', "KILLALL -m 'Chrome Helper.*'",
  'PKILL -HUP nginx', 'PKILL -USR1 node', 'PKILL -QUIT nginx', 'PKILL -u $USER node', "PKILL -U $USER -f 'sleep 99'",
  'PKILL -f "^/bin/sleep 9$"', 'which KILLALL && man PKILL',
  'PGREP -u "$USER" node', 'PGREP -u $USER -f myjob | xargs KILL', 'PGREP -u $USER node && KILL 1234',
  'echo skill-1 && ls ./KILLALL-notes', 'git log --oneline -1',
  `node -e "process.KILL(12345, 'SIGTERM')"`, 'node -e "process.KILL(N1, 0)"', 'node -e "player.KILL(N1)"',
  'LAUNCHCTL bootout gui/501/com.example.job', 'LAUNCHCTL bootout gui/$(id -u)/com.example.job',
  'LAUNCHCTL bootout gui/501 /Library/LaunchAgents/com.x.plist',
  'LAUNCHCTL bootout gui/$(id -u) ~/Library/LaunchAgents/com.kosmos.agent.x.plist',
  // round 3: a pgrep whose output nothing kills; signal 0; unrelated commands on one line
  'ps -p $(PGREP -u $USER)', 'echo $(PGREP -u $USER)', 'for p in $(PGREP -u "$USER"); do ps -o comm= -p $p; done',
  'KILL -0 N1', 'KILL -s 0 N1', 'echo N1 > f; ls | xargs rm; KILL 1234',
  'node -e "chaos.KILL(N1)"', 'node -e "tween().KILL(N1)"',
  // round 4 controls
  'PKILL -u "$USER" -f x', 'KILLALL -u $USER -v node', 'lsof -t -i :3000 | xargs KILL', 'docker KILL web', 'tmux KILL-session -t x',
  'KILLALL Dock 2>/dev/null', 'PGREP -u $USER -l',
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

test('#4671 the reason names what was matched', () => {
  assert.match(run('Bash', { command: 'KILL -9 N1' }).stderr, /a signal to process id -1/);
  assert.match(run('Bash', { command: 'PKILL -u 501' }).stderr, /matches every process you own/);
  assert.match(run('Bash', { command: 'LAUNCHCTL reboot' }).stderr, /launchctl command/);
});

test('#4671 guards any tool with a runnable field, and the tools that write code', () => {
  assert.equal(run('Monitor', { command: 'KILL -9 N1' }).code, 2);
  assert.equal(run('mcp__x__run', { script: 'KILL -9 N1' }).code, 2);
  assert.equal(run('mcp__x__py', { code: 'import os\nos.KILL(N1, 9)' }).code, 2);
  assert.equal(run('mcp__x__exec', { args: ['KILL', '-9', 'N1'] }).code, 2);
  assert.equal(run('Write', { file_path: '/tmp/x.js', content: "process.KILL(N1, 'SIGKILL');\n" }).code, 2);
  assert.equal(run('Write', { file_path: '/tmp/x.sh', content: '#!/bin/sh\nKILL -9 N1\n' }).code, 2);
  assert.equal(run('Edit', { file_path: '/tmp/x.sh', old_string: 'echo hi', new_string: 'KILL -9 N1' }).code, 2);
  assert.equal(run('MultiEdit', { file_path: '/tmp/x.sh', edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'KILLALL -u me' }] }).code, 2);
  assert.equal(run('NotebookEdit', { notebook_path: '/tmp/n.ipynb', new_source: 'import os\nos.KILL(N1, 9)' }).code, 2);
});

test('#4671 CONTROL: only what runs or is written is read (with jq), and documents are not checked', () => {
  assert.equal(run('Bash', { command: 'echo ok', description: 'KILL stale PKILL -u runs, KILL -9 N1' }).code, 0, 'a description is not run');
  assert.equal(run('Edit', { file_path: '/tmp/x.sh', old_string: 'KILL -9 N1', new_string: '' }).code, 0, 'deleting the line must be allowed');
  assert.equal(run('Write', { file_path: '/tmp/x.js', content: "child.KILL('SIGKILL');\nprocess.KILL(pid, 0);\n" }).code, 0);
  assert.equal(run('Write', { file_path: '/tmp/NOTES.md', content: 'Never run `KILL -9 N1` or `PKILL -u me`.' }).code, 0, 'a document is not run');
  assert.equal(run('Edit', { file_path: '/tmp/notes.markdown', old_string: 'a', new_string: 'KILLALL -u agent' }).code, 0);
  assert.equal(run('Edit', { file_path: '/tmp/run.txt', old_string: 'a', new_string: 'KILLALL -u agent' }).code, 2, 'a .txt can be run with sh, so it is checked');
  assert.equal(run('Read', { file_path: '/tmp/KILL -9 N1.txt' }).code, 0, 'a path argument is not a command');
});

test('#4671 round 3: a document path skips only written content, never a runnable field; CRLF is an end', () => {
  assert.equal(run('mcp__x', { file_path: 'a.md', command: 'KILL -9 N1' }).code, 2, 'with jq');
  assert.equal(run('mcp__x', { file_path: 'a.md', command: 'KILL -9 N1' }, { noJq: true }).code, 2, 'without jq');
  assert.equal(run('Bash', { command: 'PKILL -u $USER\r\n' }).code, 2);
  assert.equal(run('Bash', { command: 'PKILL -u $USER\r\n' }, { noJq: true }).code, 2);
  assert.equal(run('Write', { file_path: '/tmp/x.js', content: "const a = { action: 'KILL', delta: 'N1' };\n" }).code, 0, 'an object is not an argv');
  assert.equal(run('mcp__x', { file_path: 3, command: 'KILL -9 N1' }).code, 2, 'a non-string path must not hide the command');
  assert.equal(run('mcp__x', { cmd: 'KILL -9 N1' }).code, 2, 'the cmd key is read');
  assert.equal(run('mcp__x', { args: 'KILL -9 N1' }).code, 2, 'a string args is read');
});

test('#4671 CONTROL: malformed tool_input fails open, never blocks everything or crashes', () => {
  assert.equal(run('mcp__x', { command: 'ls', edits: [3, 'x', { new_string: 'ok' }] }).code, 0);
  assert.equal(run('mcp__x', { command: 'KILL -9 N1', edits: ['x'] }).code, 2, 'a bad sibling field must not hide the command');
  assert.equal(run('mcp__x', 'just a string').code, 0);
});

test('#4671 the operator can turn it off for an agent (KOSMOS_KILL_GUARD=off in the agent\'s launch environment)', () => {
  assert.equal(run('Bash', { command: 'KILL -9 N1' }, { env: { KOSMOS_KILL_GUARD: 'off' } }).code, 0);
  assert.equal(run('Bash', { command: 'KILL -9 N1' }, { env: { KOSMOS_KILL_GUARD: 'on' } }).code, 2, 'any other value keeps it on');
});

test('#4671 maintaining the guard is not refused by it: writing the hook itself, or this test, passes (with jq)', () => {
  for (const f of [HOOK, __filename]) {
    // raw: the file exactly as it is on disk, placeholders NOT decoded
    const r = run('Write', { file_path: '/tmp/copy', content: fs.readFileSync(f, 'utf8') }, { raw: true });
    assert.equal(r.code, 0, path.basename(f) + ': ' + r.stderr);
  }
});

test('#4671 only PreToolUse is guarded: the same payload on another event is not blocked', () => {
  assert.equal(run('Bash', { command: 'KILL -9 N1' }, { event: 'PostToolUse' }).code, 0);
});

test('#4671 KNOWN GAP, pinned so it is not mistaken for coverage: a pid computed at run time passes', () => {
  // The 2026-09-29 script itself: minus one sat in a list, and the call took a variable. A text match
  // cannot see that; the card records the runtime guard that could, and why it is a separate decision.
  const r = run('Write', { file_path: '/tmp/t.js', content: "const pids = [N1, 999999];\nfor (const pid of pids) process.KILL(pid, 'SIGKILL');\n" });
  assert.equal(r.code, 0);
});
