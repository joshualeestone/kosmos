'use strict';
require('../test-support/tmpscope');
/* kosmos#8406: the Windows report hook (engine/kosmos-report-hook.js) refuses a tool call whose text would stop every
 * Kosmos process or end the login session, the Windows twin of #4671's bash guard. "win32" in this name puts it on
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
  'taskkill /F /FI "USERNAME eq joshu"',
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
];

test('#8406: every listed Windows form of "stop everything" is refused, in any case', () => {
  for (const c of REFUSED) assert.ok(guard.reason(c), 'refused: ' + c);
});

test('#8406: one exact process id, other names and ordinary commands pass (control)', () => {
  for (const c of ALLOWED) assert.equal(guard.reason(c), '', 'allowed: ' + c);
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
