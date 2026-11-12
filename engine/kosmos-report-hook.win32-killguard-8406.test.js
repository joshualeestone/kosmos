'use strict';
require('../test-support/tmpscope');
/* kosmos#8406: the Windows report hook (engine/kosmos-report-hook.js) refuses a tool call whose text would stop every
 * Kosmos process or end the login session, the Windows twin of #4671s bash guard. "win32" in this name puts it on
 * the Windows CI job (tools/windows-tests.js); it is pure text work, so it runs on any host too.
 *   node --test engine/kosmos-report-hook.win32-killguard-8406.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const guard = require('./winkillguard');
const hook = require('./kosmos-report-hook');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rhk8406-'));
const bash = (command) => ({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } });

const REFUSED = [
  'taskkill /F /IM node.exe',
  'taskkill /im node',
  'TASKKILL /F /IM "claude.exe"',
  'taskkill -f -im claude.exe',
  'taskkill /F /T /IM Kosmos.exe',
  'taskkill /F /IM *',
  'taskkill /F /IM no*',
  'taskkill /F /FI "USERNAME eq me"',
  'taskkill /F /FI "IMAGENAME eq node.exe"',
  'taskkill /F /FI "IMAGENAME ne explorer.exe"',
  'cmd /c "taskkill /F /IM node.exe"',
  'echo hi && taskkill /F /IM node.exe',
  'Stop-Process -Name node -Force',
  'stop-process -name "claude"',
  'Stop-Process -ProcessName node',
  'spps -n node',
  'kill -Name claude',
  'Get-Process | Stop-Process -Force',
  'gps | spps',
  'Get-Process node | Stop-Process',
  'Get-Process -Name claude | Stop-Process -Force',
  'powershell -Command "Get-Process node | Stop-Process"',
  'wmic process where name="node.exe" delete',
  'wmic process where "name=\'claude.exe\'" call terminate',
  'logoff',
  'shutdown /l',
  'shutdown /r /t 0',
  'shutdown -s -t 60',
  'Restart-Computer -Force',
  'Stop-Computer',
  // Git Bash (the Claude Code Bash tool on Windows) doubles the slash so it is not read as a path.
  'taskkill //F //IM node.exe',
  'taskkill //IM node.exe',
  'shutdown //s //t 0',
  'bash -c "taskkill //F //IM claude.exe"',
  // A filter alone ends every process it matches.
  'taskkill /F /FI "STATUS eq RUNNING"',
  'taskkill /F /FI "SESSION eq 1"',
  'taskkill /F /FI "MEMUSAGE gt 0"',
  // Every name in a list, colon syntax and unique prefixes.
  'Stop-Process -Name notepad,node',
  'Stop-Process -Name "notepad","node"',
  'Stop-Process -Name:node',
  'Stop-Process -Nam node',
  // A whole Get-Process with only flags that are not names.
  'Get-Process -ErrorAction SilentlyContinue | Stop-Process',
  'Get-Process -IncludeUserName | Stop-Process -Force',
  'C:\\Windows\\System32\\taskkill.exe /F /IM node.exe',
  // Wrappers and command positions a shell or PowerShell reads as a command.
  'cmd //c "taskkill //F //IM node.exe"',
  'cmd.exe //c taskkill //F //IM node.exe',
  'bash -lc "taskkill //F //IM node.exe"',
  '(taskkill /F /IM node.exe)',
  'if true; then taskkill /F /IM node.exe; fi',
  'powershell -Command "& { taskkill /F /IM node.exe }"',
  'powershell -Command "if ($true) { Stop-Process -Name node }"',
  'start /b taskkill /F /IM node.exe',
  "Get-Process | Where-Object { $_.Name -eq 'node' } | Stop-Process",
  'Get-Process | Sort-Object CPU | Stop-Process',
  // An unclosed apostrophe does not hide what follows; an escaped quote inside a wrapper is read.
  "echo it's && taskkill /F /IM node.exe",
  'bash -c "taskkill //F //IM \\"node.exe\\""',
  'wmic path win32_process where name="node.exe" call terminate',
  `wmic process where "name='node.exe' and ParentProcessId=4" delete`,
  // Each /PID and /IM adds processes, so a /PID does not make a Kosmos /IM safe.
  'taskkill /F /T /PID 4242 /IM node.exe',
  // PowerShell with bare words (no -Command), iex, start "title", prefixes and array names.
  'powershell Stop-Process -Name node',
  'powershell -NoProfile Stop-Process -Name node -Force',
  'powershell -ExecutionPolicy Bypass taskkill /F /IM node.exe',
  'iex "Stop-Process -Name node"',
  'start "kill" taskkill /F /IM node.exe',
  'sudo taskkill /IM node.exe',
  'Stop-Process -Name @("node","claude")',
  'shutdown /s /m \\\\localhost',
  `wmic process where "processid=1 or name='node.exe'" delete`,
  // A Where-Object that keeps everything but one name.
  'Get-Process | Where-Object { $_.Name -ne "notepad" } | Stop-Process',
  'Get-Process | Where-Object { $_.Name -eq "claude" } | Stop-Process -Force',
  'function Stop-All { taskkill /F /IM node.exe }',
  // Command substitution, batch for, tskill, Stop-Process of a Get-Process block, ForEach-Object .Kill().
  'echo $(taskkill /F /IM node.exe)',
  'for %i in (1) do taskkill /f /im node.exe',
  'for /f %i in (x) do taskkill //F //IM claude.exe',
  'tskill node',
  'Stop-Process (Get-Process node)',
  'Stop-Process -InputObject (Get-Process claude) -Force',
  'Stop-Process (Get-Process)',
  'Get-Process node | % { $_.Kill() }',
  'Get-Process | ForEach-Object { $_.Kill() }',
  // An unmatched bracket or an apostrophe inside one does not hide the rest.
  'echo smile :( && taskkill /F /IM node.exe',
  "echo (it's) && taskkill /F /IM node.exe",
  `x.replace(/'/g, "") ; taskkill /F /IM node.exe`,
  // $( ) inside double quotes, and <( ).
  'echo "$(taskkill //F //IM node.exe)"',
  'x="$(taskkill //F //IM node.exe)"',
  'cat <(taskkill //F //IM node.exe)',
  // ForEach-Object forms and .Kill() on a process list.
  'Get-Process node | ForEach-Object { Stop-Process $_ -Force }',
  'Get-Process | ForEach-Object { Stop-Process -Id $_.Id }',
  'gps node | % Kill',
  '(Get-Process node).Kill()',
  // bash if/while, cmd if conditions, @ in batch.
  'if taskkill //F //IM node.exe; then echo ok; fi',
  'while taskkill //F //IM node.exe; do sleep 1; done',
  'if exist x.txt taskkill /F /IM node.exe',
  'if errorlevel 1 taskkill /F /IM node.exe',
  'if not exist x.txt taskkill /F /IM node.exe',
  '@taskkill /F /IM node.exe',
  'taskkill /F /IM ' + '*'.repeat(261),
  'taskkill /F /IM node.exe>nul',
  'taskkill /F /IM claude.exe 2>nul',
  // A heredoc fed to a shell runs; one fed to cat is data, but the text after it is read.
  'cat <<EOF\nlogoff\nEOF\ntaskkill /F /IM node.exe',
  'bash <<EOF\ntaskkill //F //IM node.exe\nEOF',
  'const y = x << 2;\ntaskkill /F /IM node.exe',
  // Broad filters: every process loads ntdll; N/A is every windowless process.
  'taskkill /F /FI "MODULES eq ntdll.dll"',
  'taskkill /F /FI "WINDOWTITLE eq N/A"',
  'echo ${#a}; taskkill /F /IM node.exe',
  '(Get-Process node) | Stop-Process',
  'cmd /c"taskkill /F /IM node.exe"',
  // NAME=value and env before the command (Homer, installed 0.8.04): Git Bash's MSYS_NO_PATHCONV=1 is the usual one.
  'MSYS_NO_PATHCONV=1 taskkill /F /IM node.exe',
  'env MSYS_NO_PATHCONV=1 taskkill /F /IM node.exe',
  'X=1 taskkill /F /IM node.exe',
  'MSYS_NO_PATHCONV=1 taskkill /F /IM claude.exe',
  'A=1 B=2 Stop-Process -Name node',
  'env -i PATH=/c/Windows/System32 taskkill //F //IM node.exe',
  'env -u FOO -- taskkill //F //IM node.exe',
  'env -S "taskkill //F //IM node.exe"',
  'sudo X=1 taskkill //F //IM node.exe',
  'X=1 sudo taskkill //F //IM node.exe',
  'cmd //c "set X=1 && taskkill /F /IM node.exe"',
  'env -S"taskkill //F //IM node.exe"',
  'env -iS "taskkill //F //IM node.exe"',
  "env -S 'taskkill //F' //IM node.exe",
  'winpty taskkill //F //IM node.exe',
  'timeout 5 taskkill //F //IM node.exe',
  'nice -n 5 taskkill //F //IM node.exe',
  'sudo -E taskkill //F //IM node.exe',
  'sudo -u me taskkill //F //IM node.exe',
  'X+=1 taskkill //F //IM node.exe',
  'X[0]=1 taskkill //F //IM node.exe',
  'env -P /bin taskkill //F //IM node.exe',
  'env -a x taskkill //F //IM node.exe',
  'sudo -Eu me taskkill //F //IM node.exe',
  'sudo --user me taskkill //F //IM node.exe',
  'nice -n 5 -- taskkill //F //IM node.exe',
  'timeout -- 5 taskkill //F //IM node.exe',
  'stdbuf -o0 taskkill //F //IM node.exe',
  'setsid taskkill //F //IM node.exe',
  'time -p taskkill //F //IM node.exe',
  'command -p taskkill //F //IM node.exe',
  'exec -a x taskkill //F //IM node.exe',
  'FOO=$(date) taskkill //F //IM node.exe',
  'TIMEOUT 5 TASKKILL /F /IM NODE.EXE',
];
const ALLOWED = [
  'taskkill /PID 4242',          // the card's control: one exact process id
  'taskkill /F /T /PID 4242',
  'taskkill /F /IM notepad.exe',
  'Stop-Process -Id 4242 -Force',
  'Stop-Process -Name notepad',
  'Get-Process | Where-Object { $_.Id -eq 4242 } | Stop-Process',
  'Get-Process node',
  'shutdown /a',
  'wmic process where processid=4242 delete',
  'kill -9 4242',
  'git status',
  'node engine/server.js',
  // Mentions, paths and arguments are not commands.
  'git commit -m "handle logoff"',
  'cat app/logoff/index.js',
  'npm test -- --grep logoff',
  'function logoff() { return 1 }',
  'grep -r shutdown src',
  'rg shutdown -g "*.js"',
  'git log -p -S shutdown',
  'git commit -m "never run taskkill /F /IM node.exe"',
  'kill 4242 && sort -n node_list.txt',
  // Narrowed by /PID, other names, wildcards that cannot match a Kosmos process.
  'taskkill /IM node.exe /FI "PID eq 4242"',
  'taskkill /FI "USERNAME eq me" /IM notepad.exe',
  'taskkill /F /IM chrome*',
  'Get-Process -Id 4242 | Stop-Process',
  'Get-Process notepad | Stop-Process',
  'ps aux | grep node',
  'Get-Process | Where-Object { $_.Id -eq 4242 } | Stop-Process',
  'Get-Process | Select-Object -First 1 | Stop-Process',
  'shutdown /m \\\\host /s',
  "echo it's done",
  // Object.prototype keys as command words must not throw.
  'constructor x',
  '__proto__ x',
  '  constructor = Foo;',
  // Code being written: a logoff or shutdown identifier, a call, a comment, an object literal.
  'promise.then(logoff)',
  'onClick={logoff}',
  'import { logoff } from "./auth"',
  'module.exports = { logoff }',
  '    logoff()',
  'function a() {\n  logoff();\n}',
  'logoff() {}',
  'logoff = true',
  '//logoff',
  'const x = () => { shutdown -s }',
  // Dry runs and named Stop-Process at the end of a list.
  'Get-Process | Stop-Process -WhatIf',
  'Get-Process | Stop-Process -Name notepad',
  "if (a) return R.session('logoff');",
  "if (name === 'logoff') { b('logoff'); }",
  'Stop-Process (Get-Process notepad)',
  'Get-Process node | % { $_.Name }',
  'tskill 4242',
  'for %i in (a b) do echo %i',
  // Filters that name another program, by name or window title.
  'taskkill /F /FI "IMAGENAME eq notepad.exe"',
  'taskkill /F /FI "WINDOWTITLE eq My Dev Server"',
  'wmic process where name="notepad.exe" delete',
  // Help, dry runs and other computers.
  'logoff /?',
  'Restart-Computer -WhatIf',
  'Restart-Computer -ComputerName build01',
  // Comments are not commands.
  '# taskkill /F /IM node.exe',
  '<#\n  Stop-Process -Name node\n#>',
  'echo ok # logoff',
  // The standard commit and PR forms: a heredoc body is data for cat, not commands.
  "git commit -m \"$(cat <<'EOF'\nwinkill\n\nStop-Process -Name node is now refused.\nlogoff\nEOF\n)\"",
  "gh pr create --title x --body \"$(cat <<'EOF'\nlogoff\nEOF\n)\"",
  'logoff (user)',
  '  logoff ();',
  'MSYS_NO_PATHCONV=1 taskkill /F /PID 4242',
  'X=1',
  'env',
  'MSYS_NO_PATHCONV=1 git status',
  'env -S "echo hi"',
  'timeout /t 5',
  'winpty node app.js',
  'timeout /t 5 /nobreak',
  'FOO=$(date) echo shutdown /s',
  'sudo -u me git status',
];

test('#8406: every listed Windows form of "stop everything" is refused, in any case', () => {
  for (const c of REFUSED) assert.ok(guard.reason(c), 'refused: ' + c);
  // cmd and PowerShell read their commands in any case (bash, sh and env do not, so they are not upper-cased here).
  for (const c of ['TASKKILL /F /IM NODE.EXE', 'TaskKill /f /im Claude.EXE', 'STOP-PROCESS -NAME NODE', 'Get-PROCESS | STOP-PROCESS',
    'LOGOFF', 'SHUTDOWN /S /T 0', 'WMIC PROCESS WHERE NAME="NODE.EXE" DELETE', 'TSKILL NODE', 'RESTART-COMPUTER',
    'MSYS_NO_PATHCONV=1 TASKKILL /F /IM NODE.EXE']) assert.ok(guard.reason(c), 'refused in capitals: ' + c);
});

test('#8406: one exact process id, other names and ordinary commands pass (control)', () => {
  for (const c of ALLOWED) assert.equal(guard.reason(c), '', 'allowed: ' + c);   // assert.equal: a throw fails it too
});

test('#8406: long lines stay fast (the hook has a short timeout and a Write can be megabytes on one line)', () => {
  for (const s of ['ps a '.repeat(80000), 'gps '.repeat(100000), 'kill x '.repeat(60000), 'taskkill /IM x '.repeat(30000), '"'.repeat(400000),
    'taskkill /IM ' + '*'.repeat(200000) + 'a', '('.repeat(100000), "it's ".repeat(50000), 'a|'.repeat(500000), 'ps | '.repeat(200000), 'taskkill /FI "PID eq a' + ' '.repeat(200000) + 'b"', 'a <<EOF b '.repeat(40000) + '\n', 'gps a|'.repeat(150000), 'x(' .repeat(50000) + ')'.repeat(50000)]) {
    const t0 = Date.now();
    guard.reason(s);
    assert.ok(Date.now() - t0 < 1500, s.slice(0, 12) + '... took ' + (Date.now() - t0) + ' ms for ' + s.length + ' chars');
  }
});

test('#8406: the hook returns 2 and says why on stderr, before anything is sent to the board', async () => {
  const sent = [];
  const err = [];
  const code = await hook.main({
    input: JSON.stringify(bash('taskkill /F /IM node.exe')), env: { KOSMOS_AGENT_TOKEN: 'ab12' }, url: 'http://127.0.0.1:16180',
    boardToken: 'BT', fetchImpl: async (u) => { sent.push(u); return { ok: true, status: 200, text: async () => '{}' }; },
    throttleDir: path.join(TMP, 't1'), ppid: 4242, now: () => 1000, stdout: () => {}, stderr: (s) => err.push(s), platform: 'win32',
  });
  assert.equal(code, 2);
  assert.match(err.join(''), /Kosmos blocked this Bash call: it contains a taskkill of every node\.exe process/);
  assert.match(err.join(''), /taskkill \/PID <n>/);
  assert.deepEqual(sent, [], 'nothing reaches the board for a refused call');
});

test('#8406: the same hook lets taskkill /PID through: exit 0, not 2 (control)', async () => {
  const sent = [];
  const code = await hook.main({
    input: JSON.stringify(bash('taskkill /PID 4242')), env: { KOSMOS_AGENT_TOKEN: 'ab12' }, url: 'http://127.0.0.1:16180',
    boardToken: 'BT', fetchImpl: async (u) => { sent.push(u); return { ok: true, status: 200, text: async () => '{"recorded":true}' }; },
    throttleDir: path.join(TMP, 't2'), ppid: 4242, now: () => 1000, stdout: () => {}, stderr: () => {}, platform: 'win32',
  });
  assert.equal(code, 0);
  assert.ok(sent.length > 0, 'the control does reach the board, so the refused arm\'s empty send list can fail');
});

test('#8406: KOSMOS_KILL_GUARD=off turns it off, as on the Mac', () => {
  assert.equal(guard.check(bash('taskkill /F /IM node.exe'), { KOSMOS_KILL_GUARD: 'off' }).block, false);
  assert.equal(guard.check(bash('taskkill /F /IM node.exe'), {}).block, true);
});

test('#8406: what is read: command and written code fields; a .md file\'s content and replaced text are not', () => {
  const pre = (tool, input) => ({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input });
  assert.equal(guard.check(pre('Write', { file_path: 'C:\\w\\stop.ps1', content: 'Get-Process | Stop-Process' }), {}).block, true);
  assert.equal(guard.check(pre('Edit', { file_path: 'C:\\w\\x.cmd', old_string: 'a', new_string: 'logoff' }), {}).block, true);
  assert.equal(guard.check(pre('MultiEdit', { file_path: 'C:\\w\\x.cmd', edits: [{ old_string: 'a', new_string: 'shutdown /s' }] }), {}).block, true);
  assert.equal(guard.check(pre('Write', { file_path: 'C:\\w\\notes.md', content: 'never run taskkill /F /IM node.exe' }), {}).block, false);
  assert.equal(guard.check(pre('Edit', { file_path: 'C:\\w\\x.cmd', old_string: 'taskkill /F /IM node.exe', new_string: 'rem gone' }), {}).block, false);
  assert.equal(guard.check({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'logoff' } }, {}).block, false, 'only PreToolUse');
});

test('#8406: a guard that throws fails open, and the hook still reports (the keep-copy and heartbeat are not lost)', async () => {
  const g = require('./winkillguard');
  const was = g.check;
  g.check = () => { throw new Error('boom'); };
  const sent = [];
  try {
    const code = await hook.main({
      input: JSON.stringify(bash('git status')), env: { KOSMOS_AGENT_TOKEN: 'ab12' }, url: 'http://127.0.0.1:16180',
      boardToken: 'BT', fetchImpl: async (u) => { sent.push(u); return { ok: true, status: 200, text: async () => '{"recorded":true}' }; },
      throttleDir: path.join(TMP, 't3'), ppid: 4242, now: () => 1000, stdout: () => {}, stderr: () => {}, platform: 'win32',
    });
    assert.equal(code, 0);
    assert.ok(sent.length > 0, 'the report still went to the board');
  } finally { g.check = was; }
});
