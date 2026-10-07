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

function run(tool, toolInput, { event = 'PreToolUse', noJq = false, noPerl = false, env: extra = {}, raw = false } = {}) {
  const payload = JSON.stringify({ hook_event_name: event, tool_name: tool, tool_input: raw ? toolInput : dd(toolInput), session_id: 's' });
  const env = { ...process.env, KOSMOS_REPORT_CLI: STUB, TMPDIR: SANDBOX, HOME: SANDBOX, ...extra };
  delete env.TMUX_PANE; delete env.KOSMOS_AGENT_SESSION; delete env.KOSMOS_AGENT_TOKEN;
  if (!('KOSMOS_KILL_GUARD' in extra)) delete env.KOSMOS_KILL_GUARD;
  if (noJq) env.KOSMOS_REPORT_HOOK_NO_JQ = '1'; else delete env.KOSMOS_REPORT_HOOK_NO_JQ;
  if (noPerl) env.KOSMOS_REPORT_HOOK_NO_PERL = '1'; else delete env.KOSMOS_REPORT_HOOK_NO_PERL;
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
  // round 5: kill as the last word of a pipe
  'PGREP -u $USER | xargs KILL', 'PGREP -f . | xargs KILL',
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
  // round 5: ordinary multi-line scripts (a later `-1` flag is not a kill target)
  'KILL -9 $PID\nsleep 1\ngit log N1', 'KILL -TERM $SERVER_PID\nwait $SERVER_PID\ngit log N1 --stat',
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

test('#4671 maintaining the guard is not refused by it: writing the hook itself, or this test, passes (both paths)', () => {
  for (const noJq of [false, true]) {
    for (const f of [HOOK, __filename]) {
      // raw: the file exactly as it is on disk, placeholders NOT decoded
      const r = run('Write', { file_path: '/tmp/copy', content: fs.readFileSync(f, 'utf8') }, { raw: true, noJq });
      assert.equal(r.code, 0, path.basename(f) + (noJq ? ' (no jq): ' : ': ') + r.stderr);
    }
  }
});

test('#4671 round 5: a multi-line script Write is read as lines on both paths', () => {
  for (const noJq of [false, true]) {
    assert.equal(run('Write', { file_path: '/tmp/stop.sh', content: 'KILL -TERM "$PID"\nwait "$PID"\ngit log N1 --oneline\n' }, { noJq }).code, 0);
  }
});

test('#4671 round 6: a large escape-heavy Write finishes well inside the hook\'s 15 s timeout on both paths', () => {
  // 2 MB of pretty-printed JSON (every quote escaped in the payload) plus backslash-heavy paths.
  const big = JSON.stringify(Array.from({ length: 35000 }, (_, i) => ({ path: 'C:\\Users\\x\\' + i, re: '^a\\d+$' })), null, 2);
  assert.ok(big.length > 2e6, 'the fixture is really over 2 MB: ' + big.length);
  for (const noJq of [false, true]) {
    const t0 = Date.now();
    const r = run('Write', { file_path: '/tmp/big.json', content: big + '\nKILL -9 N1\n' }, { noJq });
    const ms = Date.now() - t0;
    assert.equal(r.code, 2, 'still blocks the line at the end' + (noJq ? ' (no jq)' : ''));
    assert.ok(ms < 12000, `${noJq ? 'no jq' : 'jq'}: took ${ms} ms`);
  }
});

test('#4671 round 6: without jq, an Edit that REPLACES a dangerous line with a safe one is allowed', () => {
  const r = run('Edit', { file_path: '/tmp/x.sh', old_string: 'PKILL -u me', new_string: 'PKILL -u me node' }, { noJq: true });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(run('Edit', { file_path: '/tmp/x.sh', old_string: 'echo', new_string: 'PKILL -u me' }, { noJq: true }).code, 2, 'the new text is still read');
});

test('#4671 round 7: a large multi-line script without jq reads as lines too (no size cap with perl)', () => {
  const pad = '# ' + 'x'.repeat(78) + '\n';
  const content = pad.repeat(3700) + 'KILL -9 $PID\nhead N1 f\n';   // ~300 KB
  assert.ok(content.length > 262144);
  assert.equal(run('Write', { file_path: '/tmp/x.sh', content }, { noJq: true }).code, 0);
  assert.equal(run('Write', { file_path: '/tmp/x.sh', content: content + 'KILL -9 N1\n' }, { noJq: true }).code, 2);
});

test('#4671 round 7: without jq, a .md write and a description are not read, as with jq', () => {
  assert.equal(run('Edit', { file_path: '/t/x.md', old_string: 'a', new_string: 'KILL -9 N1' }, { noJq: true }).code, 0);
  assert.equal(run('Bash', { command: 'echo hi', description: 'never KILL -9 N1' }, { noJq: true }).code, 0);
  assert.equal(run('Task', { description: 'x', prompt: 'Never run KILL -9 N1 or PKILL -u me.' }, { noJq: true }).code, 0, 'a subagent prompt that forbids it');
  assert.equal(run('Bash', { command: 'KILL -9 N1', description: 'x' }, { noJq: true }).code, 2, 'the command is still read');
});

test('#4671 round 8 nits: .MD is a document on both paths; a to-do list is not read; invalid UTF-8 does not fail open', () => {
  for (const noJq of [false, true]) {
    assert.equal(run('Write', { file_path: '/tmp/README.MD', content: 'never KILL -9 N1' }, { noJq }).code, 0);
    assert.equal(run('TodoWrite', { todos: [{ content: 'find why KILL -9 N1 ended the session', status: 'pending', activeForm: 'finding' }] }, { noJq }).code, 0);
  }
  // A raw invalid byte next to a real command: without jq the event is still read and the call still refused.
  const payload = Buffer.concat([Buffer.from('{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"' + d('KILL -9 N1') + ' #'), Buffer.from([0xff, 0xfe]), Buffer.from('"}}')]);
  const env = { ...process.env, KOSMOS_REPORT_CLI: STUB, TMPDIR: SANDBOX, HOME: SANDBOX, KOSMOS_REPORT_HOOK_NO_JQ: '1', LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' };
  delete env.TMUX_PANE; delete env.KOSMOS_KILL_GUARD;
  const r = spawnSync('/bin/bash', [HOOK], { input: payload, env, encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 2, r.stderr);
});

test('#4671 the awk fallback (no perl) blocks and allows like the rest, and stays inside the timeout', () => {
  for (const cmd of ['KILL -9 N1', 'PKILL -u me', 'PGREP -u $USER | xargs KILL']) assert.equal(run('Bash', { command: cmd }, { noJq: true, noPerl: true }).code, 2, cmd);
  assert.equal(run('Bash', { command: 'KILL -9 $PID\nsleep 1\ngit log N1' }, { noJq: true, noPerl: true }).code, 0);
  const big = 'x'.repeat(1_500_000) + '\nKILL -9 N1\n';
  const t0 = Date.now();
  assert.equal(run('Write', { file_path: '/tmp/b', content: big }, { noJq: true, noPerl: true }).code, 2);
  assert.ok(Date.now() - t0 < 12000, 'over the cap it is matched raw, linearly');
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

test('#5420 every grep in the kill guard runs in the locale it picked: C for GNU grep, the caller\'s otherwise', () => {
  // On Linux (GNU grep 3.11, LANG=C.UTF-8) the first pattern took over 60 s on the 1.5 MB case above and the
  // hook's 15 s timeout cut it off; in C it took 0.07 s. BSD grep on a Mac is about twice as slow in C, so the
  // hook picks per grep flavour. The Mac cannot run GNU grep, so the next test fakes one; this pins the source.
  const src = fs.readFileSync(HOOK, 'utf8');
  const start = src.indexOf('_kill_all_reason() {');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  // Any spelling of grep (-qE, -F, bare), not only grep -E; pgrep has no word boundary before its g. The
  // flavour probe (`grep --version`, and the `(GNU grep)` it is matched against) is not a match.
  const greps = body.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n').match(/(\S+=\S+ )?\bgrep\b(?! --version|\))/g) || [];
  assert.equal(greps.length, 6, 'the guard has six greps; a change in that number needs this test read again');
  for (const g of greps) assert.equal(g, 'LC_ALL="$_lc" grep', 'every grep in _kill_all_reason runs in the picked locale');
});

test('#5420 the guard runs its greps in C under GNU grep, and in the caller\'s locale under BSD grep', () => {
  // A fake grep first on PATH: it answers --version as the flavour asked for, records the LC_ALL each guard
  // grep (the -Eq -- calls) ran with, and otherwise runs the real grep, so every decision is real.
  const dir = fs.mkdtempSync(path.join(SANDBOX, 'fakegrep-'));
  const log = path.join(dir, 'log');
  fs.writeFileSync(path.join(dir, 'grep'), [
    '#!/bin/bash',
    'if [ "$1" = --version ]; then',
    '  if [ "$FAKE_GREP_FLAVOUR" = gnu ]; then echo "grep (GNU grep) 3.11"; else echo "grep (BSD grep, GNU compatible) 2.6.0-FreeBSD"; fi',
    '  exit 0',
    'fi',
    'if [ "$1" = -Eq ] && [ "$2" = -- ]; then printf "[%s]\\n" "${LC_ALL-unset}" >> "$FAKE_GREP_LOG"; fi',
    'exec "$FAKE_GREP_REAL" "$@"',
  ].join('\n') + '\n', { mode: 0o755 });
  const real = spawnSync('/bin/sh', ['-c', 'command -v grep'], { encoding: 'utf8' }).stdout.trim();
  for (const [flavour, want] of [['gnu', '[C]'], ['bsd', '[]']]) {
    fs.rmSync(log, { force: true });
    const env = { PATH: `${dir}:${process.env.PATH}`, FAKE_GREP_FLAVOUR: flavour, FAKE_GREP_LOG: log, FAKE_GREP_REAL: real, LC_ALL: '' };
    assert.equal(run('Bash', { command: 'KILL -9 N1' }, { env }).code, 2, `${flavour}: still blocks`);
    const first = fs.readFileSync(log, 'utf8').trim().split('\n');
    assert.equal(first.length, 1, `${flavour}: a blocked command stops at the first guard grep`);
    assert.equal(first[0], want, `${flavour}: that grep ran with LC_ALL ${want}`);
    // A benign command runs the guard's other greps too (all but the kword one, which only follows a pgrep hit).
    fs.rmSync(log, { force: true });
    assert.equal(run('Bash', { command: 'echo hi' }, { env }).code, 0, `${flavour}: a benign command is allowed`);
    const all = fs.readFileSync(log, 'utf8').trim().split('\n');
    assert.equal(all.length, 5, `${flavour}: five guard greps ran for a benign command`);
    for (const s of all) assert.equal(s, want, `${flavour}: every guard grep ran with LC_ALL ${want}`);
  }
});

test('#5420 the code arm still reads Unicode spaces as JavaScript does, now that the greps run in C', () => {
  // In C, [[:space:]] is ASCII only. JavaScript treats these as whitespace, so the minus one below is still a
  // minus one to node; under the UTF-8 locale the old greps caught some of them, and all must still block.
  for (const ws of ['\u00a0', '\u1680', '\u2000', '\u2003', '\u2007', '\u200a', '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff']) {
    const content = `process.KILL(${ws}N1, 9);\n`;
    const name = `U+${ws.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
    assert.equal(run('Write', { file_path: '/tmp/x.js', content }).code, 2, `${name} with jq`);
    assert.equal(run('Write', { file_path: '/tmp/x.js', content }, { noJq: true }).code, 2, `${name} without jq`);
    // In C, as GNU grep runs it, [[:space:]] is ASCII only: only the fold reads this space (review 7).
    assert.equal(run('Write', { file_path: '/tmp/x.js', content }, { env: { LC_ALL: 'C' } }).code, 2, `${name} in C`);
  }
  // Control: a letter that is not whitespace makes an identifier, not a minus one, and stays allowed.
  assert.equal(run('Write', { file_path: '/tmp/x.js', content: 'process.KILL(\u00e9N1, 9);\n' }).code, 0);
});

test('#5420 the argv arm reads Unicode spaces too, and a signal 0 after one stays allowed', () => {
  for (const ws of ['\u00a0', '\u1680', '\u2000', '\u2003', '\u2007', '\u200a', '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff']) {
    const name = `U+${ws.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
    for (const content of [
      `execFileSync('KILL',${ws}['-9', 'N1']);\n`,
      `spawn('KILL',${ws}['-9','N1']);\n`,
      `spawn([${ws}'KILL', 'N1']);\n`,
    ]) {
      assert.equal(run('Write', { file_path: '/tmp/x.js', content }).code, 2, `${name} argv with jq: ${content}`);
      assert.equal(run('Write', { file_path: '/tmp/x.js', content }, { noJq: true }).code, 2, `${name} argv without jq: ${content}`);
      // In C, as GNU grep runs it, [[:space:]] is ASCII only: only the fold reads this space (review 7).
      assert.equal(run('Write', { file_path: '/tmp/x.js', content }, { env: { LC_ALL: 'C' } }).code, 2, `${name} argv in C: ${content}`);
    }
    // Signal 0 sends nothing: a Unicode space before or after the 0 must not turn it into a refusal.
    for (const content of [`process.KILL(N1,${ws}0);\n`, `process.KILL(N1, 0${ws});\n`]) {
      assert.equal(run('Write', { file_path: '/tmp/x.js', content }).code, 0, `${name} signal 0 with jq: ${content}`);
      assert.equal(run('Write', { file_path: '/tmp/x.js', content }, { noJq: true }).code, 0, `${name} signal 0 without jq: ${content}`);
      // In C, as GNU grep runs it, [[:space:]] is ASCII only: only the fold reads this space (review 7).
      assert.equal(run('Write', { file_path: '/tmp/x.js', content }, { env: { LC_ALL: 'C' } }).code, 0, `${name} signal 0 in C: ${content}`);
    }
    // Control for the signal arm: a real signal after the same space still blocks.
    assert.equal(run('Write', { file_path: '/tmp/x.js', content: `process.KILL(N1,${ws}9);\n` }).code, 2, `${name} signal 9`);
  }
  // Control for the other direction: a signal that merely starts with the same lead byte as a JW space (a
  // copyright sign, katakana, an ideographic comma, a hyphen) is a nonzero signal and still blocks.
  for (const sig of ['\u00a9x', '\u30b7\u30b0', '\u3001', '\u2010', '\u1681', '\uff21', '\ufeffx']) {
    const content = `process.KILL(N1, ${sig});\n`;
    assert.equal(run('Write', { file_path: '/tmp/x.js', content }).code, 2, `a non-ASCII signal blocks with jq: ${content}`);
    assert.equal(run('Write', { file_path: '/tmp/x.js', content }, { noJq: true }).code, 2, `a non-ASCII signal blocks without jq: ${content}`);
    // In C, as GNU grep runs it, [[:space:]] is ASCII only: only the fold reads this space (review 7).
    assert.equal(run('Write', { file_path: '/tmp/x.js', content }, { env: { LC_ALL: 'C' } }).code, 2, `a non-ASCII signal blocks in C: ${content}`);
  }
});
