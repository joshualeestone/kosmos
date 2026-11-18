'use strict';
/**
 * kosmos#8640 (Windows): the delete guard's folder check on Windows.
 *
 * On Windows the board's roster is the scheduled-task roster (status.setPaneSource(win32roster)), and paneFolders()
 * returned [] whenever a roster source was set, so the "something is working inside the agent's folder" check never
 * ran there: the guard checked names only. Windows has no panes; status.setWin32FolderSource reads what PROCESSES work
 * in instead (a program's folder, and every Windows path its command line names). This file pins the parser, the guard
 * through it, the fail-closed read, and on Windows the live read itself.
 *
 *   node --test engine/delete-leftover.win32folders-8640.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { spawn } = require('node:child_process');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'delete-leftover-w8640-'));
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'LaunchAgents');
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = nodePath.join(SANDBOX, 'LaunchAgents', 'systemd', 'user');
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_TRASH = nodePath.join(SANDBOX, 'Trash');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const create = require('./create');
const remove = require('./remove');
const status = require('./status');
const win32job = require('./win32job');
const leftover = require('./delete-leftover');

const onWin = process.platform === 'win32';
const WIN_ONLY = !onWin && 'win32 only: the agent folder and the process paths are Windows paths';
const OK = 'KOSMOS-FOLDERS-READ-OK';

remove.setRunner(() => ({ ok: true, stdout: '' }));
leftover.setRunner(() => ({ ok: true, stdout: '' }));

function leftoverFolder(name) {
  const dir = create.workerDir(name);
  fs.mkdirSync(nodePath.join(dir, 'notes'), { recursive: true });
  fs.writeFileSync(nodePath.join(dir, 'CLAUDE.md'), 'work\n');
  return dir;
}
const plan = (name) => leftover.plan(name, { platform: 'win32' });
const line = (pid, name, exe, cmd) => `${pid}\t${name}\t${exe}\t${cmd}`;
const read = (...lines) => [...lines, OK, ''].join('\r\n');

test.beforeEach(() => {
  status.setPaneSource(() => '');   // the roster names no agent
  win32job.setRunner(() => ({ ok: false, out: 'ERROR: The system cannot find the file specified.' }));
});
test.afterEach(() => { status.setPaneSource(null); status.setWin32FolderSource(null); win32job.setRunner(null); });

test('win32PathsIn: every Windows path a command line names, quoted or not, with spaces', () => {
  const quoted = status.win32PathsIn('"C:\\Program Files\\x\\a.exe" --dir "D:\\work\\pat doe\\agent1" -v');
  for (const p of ['C:\\Program Files\\x\\a.exe', 'D:\\work\\pat doe\\agent1']) assert.ok(quoted.includes(p), p);
  assert.deepEqual(status.win32PathsIn('node C:\\k\\boot.js C:/w/agent2/notes'), ['C:\\k\\boot.js', 'C:/w/agent2/notes']);
  assert.deepEqual(status.win32PathsIn('svchost -k netsvcs'), []);
  assert.deepEqual(status.win32PathsIn(''), []);
});

test('win32ReadText: only a read that ran and exited 0 is text; not run, killed at its limit, or a failed exit is none', () => {
  assert.equal(status.win32ReadText('as given'), 'as given');
  assert.equal(status.win32ReadText({ ran: true, status: 0, out: 'x' }), 'x');
  for (const got of [{ ran: false, status: null, out: '' }, { ran: true, status: 1, out: `${OK}\n` }, { ran: false, status: null, out: `${OK}\n` }, null, undefined, {}]) {
    assert.equal(status.win32ReadText(got), null, JSON.stringify(got));
  }
  assert.equal(status.readWin32ProcessFolders(status.win32ReadText({ ran: true, status: 1, out: read() })), null,
    'a failed exit with a sentinel in its output is still no answer');
});

test('win32LongForm: an 8.3 spelling on the agents\' drive is read in its long form; another drive is never looked up', { skip: WIN_ONLY }, () => {
  const long = nodePath.join(SANDBOX, 'a long folder name 8640');
  fs.mkdirSync(nodePath.join(long, 'inside'), { recursive: true });
  const short = require('node:child_process').execFileSync(status.win32Powershell(), ['-NoProfile', '-NonInteractive', '-Command',
    '[Console]::Out.Write((New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:KOSMOS_LONG_DIR).ShortPath)'],
  { encoding: 'utf8', env: { ...process.env, KOSMOS_LONG_DIR: long } }).trim();
  if (!short.includes('~')) return;   // 8.3 names are off on this volume: nothing to read
  const got = status.win32LongForm(nodePath.join(short, 'inside', 'not-there.txt'), new Map());
  assert.equal(fs.realpathSync.native(nodePath.dirname(got)).toLowerCase(), fs.realpathSync.native(nodePath.join(long, 'inside')).toLowerCase());
  const drive = String(create.WORKERS_DIR).slice(0, 1).toUpperCase();
  const other = drive === 'Z' ? 'Y' : 'Z';
  assert.equal(status.win32LongForm(`${other}:\\SHARED~1\\x`, new Map()), null, 'a path on another drive was looked up');
  assert.equal(status.win32LongForm('C:\\no tilde here', new Map()), null);
});

test('win32PathsIn: the "p:/" inside a web address is not a drive', () => {
  assert.deepEqual(status.win32PathsIn('chrome.exe --url https://example.com/a http://x/y'), []);
  assert.deepEqual(status.win32PathsIn('x --log=C:\\logs\\a.txt'), ['C:\\logs\\a.txt'], 'a path right after "=" still is');
});

test('Mac and Linux: the page\'s plan hands the listing in even for a leftover with no folder (no tmux read on the board\'s thread)', async () => {
  const realSync = status.paneFolders;
  const realAsync = status.paneFoldersAsync;
  let syncReads = 0;
  status.paneFolders = () => { syncReads += 1; return []; };
  status.paneFoldersAsync = async () => [];
  try {
    for (const platform of ['darwin', 'linux']) await leftover.planAsync('nofolder8640', { platform });
    assert.equal(syncReads, 0, 'a Mac or Linux plan read the listing on the board\'s thread');
  } finally { status.paneFolders = realSync; status.paneFoldersAsync = realAsync; }
});

test('win32PathsIn: a QUOTED path ends at its quote, so a folder with a space is not cut to a sibling\'s name', () => {
  const got = status.win32PathsIn('tool.exe "C:\\w\\agent1 copy\\x" -v');
  assert.ok(got.includes('C:\\w\\agent1 copy\\x'));
  assert.equal(got.includes('C:\\w\\agent1'), false, 'a quoted "agent1 copy" was cut to agent1');
});

test('win32PathsIn: an UNQUOTED path with more arguments after it still gives the bare path (the usual shape)', () => {
  for (const cmd of ['tool.exe --dir C:\\w\\agent1 --verbose', 'x C:\\w\\agent1;D:\\other', 'x C:\\w\\agent1, y', "x 'C:\\w\\agent1' y"]) {
    const got = status.win32PathsIn(cmd);
    assert.ok(got.includes('C:\\w\\agent1'), `${cmd} -> ${JSON.stringify(got)}`);
  }
});

test('readWin32ProcessFolders: rows only with the sentinel; a program folder and each named path per process', () => {
  assert.equal(status.readWin32ProcessFolders(line(1, 'a.exe', 'C:\\a\\a.exe', 'a')), null, 'no sentinel: no answer');
  assert.equal(status.readWin32ProcessFolders(null), null);
  const rows = status.readWin32ProcessFolders(read(line(7, 'tool.exe', 'C:\\t\\tool.exe', 'tool.exe --in "C:\\w\\agent1"'), line(8, 'System', '', '')));
  assert.deepEqual(rows, [
    { session: 'tool.exe (process 7)', folder: 'C:\\t' },
    { session: 'tool.exe (process 7)', folder: 'C:\\w\\agent1' },
  ]);
  assert.deepEqual(status.readWin32ProcessFolders(read()), [], 'nothing running anywhere is still an answer');
});

test('win32: a process naming the agent\'s folder in its command line holds it; a sibling sharing the prefix does not', { skip: WIN_ONLY }, () => {
  const dir = leftoverFolder('agent1');
  status.setWin32FolderSource(() => read(line(4242, 'tool.exe', 'C:\\t\\tool.exe', `tool.exe --work "${dir}"`)));
  const p = plan('agent1');
  assert.equal(p.ok, false, 'a running process in agent1\'s folder was offered for deletion');
  assert.match(p.because, /open and working in agent1's folder right now \(it shows as "tool\.exe \(process 4242\)"\)/);
  leftoverFolder('agent3');
  status.setWin32FolderSource(() => read(line(9, 'tool.exe', 'C:\\t\\tool.exe', `tool.exe "${create.workerDir('agent30')}"`)));
  assert.equal(plan('agent3').ok, true, 'a process in agent30 held agent3 (a prefix match, not a folder match)');
});

test('win32: an unquoted folder with more arguments after it holds the agent', { skip: WIN_ONLY }, () => {
  const dir = leftoverFolder('agent7');
  status.setWin32FolderSource(() => read(line(11, 'tool.exe', 'C:\\t\\tool.exe', `tool.exe --add-dir ${dir} --print`)));
  assert.equal(plan('agent7').ok, false, 'a tool started with --add-dir <folder> --print was not seen');
});

test('win32: the page\'s plan and the delete read the folder list off the board\'s thread, never synchronously', { skip: WIN_ONLY }, async () => {
  const dir = leftoverFolder('agent8');
  status.setWin32FolderSource(() => read(line(12, 'tool.exe', 'C:\\t\\tool.exe', `tool.exe "${dir}"`)));
  const realSync = status.paneFolders;
  let syncReads = 0;
  status.paneFolders = () => { syncReads += 1; return realSync(); };
  try {
    const p = await leftover.planAsync('agent8', { platform: 'win32' });
    assert.equal(p.ok, false, 'PRECONDITION: the process in the folder holds it');
    const d = await leftover.delAsync('agent8', { platform: 'win32', unchecked: true });
    assert.notEqual(d.outcome, leftover.OUTCOME.DELETED);
    assert.equal(syncReads, 0, 'a synchronous read on the board\'s thread');
  } finally { status.paneFolders = realSync; }
});

test('win32: the listing is read only when the plan would use it: not for a name with nothing left over', { skip: WIN_ONLY }, async () => {
  let reads = 0;
  status.setWin32FolderSource(() => { reads += 1; return read(); });
  const p = await leftover.planAsync('nobody-here', { platform: 'win32' });
  assert.equal(p.ok, false, 'PRECONDITION: nothing is left of that name');
  assert.equal(reads, 0, 'a page for a name with nothing to delete started a process read');
  leftoverFolder('agent9');
  await leftover.planAsync('agent9', { platform: 'win32' });
  assert.ok(reads >= 1, 'and a real leftover is read');
});

test('win32: two pages opening together share one read', { skip: WIN_ONLY }, async () => {
  leftoverFolder('agent10');
  let reads = 0;
  const realAsync = status.paneFoldersAsync;
  status.paneFoldersAsync = async () => { reads += 1; await new Promise((r) => setTimeout(r, 50)); return []; };
  try {
    await Promise.all([leftover.planAsync('agent10', { platform: 'win32' }), leftover.planAsync('agent10', { platform: 'win32' })]);
    assert.equal(reads, 1, 'two overlapping reads were started');
  } finally { status.paneFoldersAsync = realAsync; }
});

test('win32: the delete re-reads the listing after the drive probe, so a tool started meanwhile is seen', { skip: WIN_ONLY }, async () => {
  const dir = leftoverFolder('agent11');
  let reads = 0;
  // The first read (before the probe) sees nothing; a tool starts in the folder before the delete's own re-plan.
  status.setWin32FolderSource(() => { reads += 1; return reads === 1 ? read() : read(line(13, 'tool.exe', 'C:\\t\\tool.exe', `tool.exe "${dir}"`)); });
  const d = await leftover.delAsync('agent11', { platform: 'win32', unchecked: true });
  assert.ok(reads >= 2, 'PRECONDITION: read again before the delete');
  assert.notEqual(d.outcome, leftover.OUTCOME.DELETED, 'the delete went ahead over a tool started after the first read');
  assert.ok(fs.existsSync(nodePath.join(dir, 'CLAUDE.md')));
});

test('win32: a program running from inside the agent\'s folder, or a subfolder, holds it', { skip: WIN_ONLY }, () => {
  const dir = leftoverFolder('agent2');
  status.setWin32FolderSource(() => read(line(5, 'x.exe', nodePath.join(dir, 'notes', 'x.exe'), 'x.exe')));
  assert.equal(plan('agent2').ok, false);
});

test('win32 negative control: nothing working in the folder, it is still offered', { skip: WIN_ONLY }, () => {
  leftoverFolder('juan');
  status.setWin32FolderSource(() => read(line(5, 'explorer.exe', 'C:\\Windows\\explorer.exe', 'C:\\Windows\\Explorer.EXE')));
  assert.equal(plan('juan').ok, true, 'a really removed agent is no longer offered');
});

test('win32: a read with no sentinel refuses the plan (fails closed)', { skip: WIN_ONLY }, () => {
  leftoverFolder('agent4');
  status.setWin32FolderSource(() => 'partial output, cut off');
  const p = plan('agent4');
  assert.equal(p.ok, false);
  assert.match(p.because, /Windows would not tell us which programs are running right now, so we could not check whether agent4 is running/);
  assert.doesNotMatch(p.because, /Closing windows/, 'the tmux remedy, which does not help a failed Windows read');
});

test('control: with the Windows source off (the default), the roster alone decides, as before', { skip: WIN_ONLY }, () => {
  const dir = leftoverFolder('agent5');
  status.setWin32FolderSource(null);
  assert.equal(plan('agent5').ok, true, 'PRECONDITION: without the source nothing sees the folder');
  status.setWin32FolderSource(() => read(line(6, 't.exe', 'C:\\t\\t.exe', `t.exe "${dir}"`)));
  assert.equal(plan('agent5').ok, false, 'the same process, seen once the source is on');
});

test('win32 live: a real process started with the agent\'s folder in its command line is seen, sync and async', { skip: WIN_ONLY }, async () => {
  const dir = leftoverFolder('agent6');
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)', dir], { stdio: 'ignore' });
  try {
    await new Promise((r) => setTimeout(r, 500));
    status.setWin32FolderSource(true);
    const p = plan('agent6');
    assert.equal(p.ok, false, 'the live read missed a running process naming agent6\'s folder');
    assert.match(p.because, /working in agent6's folder/);
    const pa = await leftover.planAsync('agent6', { platform: 'win32' });
    assert.equal(pa.ok, false, 'and the off-thread read too');
  } finally { child.kill(); await new Promise((r) => setTimeout(r, 300)); }
  assert.equal(plan('agent6').ok, true, 'and once it has stopped, the leftover is offered again');
});
