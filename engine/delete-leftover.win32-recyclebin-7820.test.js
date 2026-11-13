'use strict';
/**
 * kosmos#7820: on Windows, "Delete what is left" sends the agent's folder to the Recycle Bin when it can, and says
 * "deleted for good" when it cannot. Driven from any platform: the win32 arm is injected, and PowerShell is a stub
 * behind this module's run() seam, so nothing here touches a real Recycle Bin. Sandboxed like delete-leftover.test.js,
 * because this module MOVES OR DELETES FOLDERS.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'delete-leftover-7820-'));
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

remove.setRunner(() => ({ ok: true, stdout: '' }));

/* What the stubbed PowerShell was asked, and how it answers. `drive` is the DriveType it reports (UNKNOWN and '' are
   printed raw, as the script does when it cannot look), `bin` the volume's Recycle Bin settings; `recycle` acts on the
   folder (or not) and returns the script's word. */
const calls = [];
let drive = 'Fixed';
let bin = {};
const driveAnswer = () => (drive === 'UNKNOWN' || drive === ''
  ? drive
  : JSON.stringify({ type: drive, total: 500 * 1024 ** 3, policy: false, nuke: 0, maxMB: 20000, ...bin }));
let recycle = (p) => { fs.rmSync(p, { recursive: true, force: true }); return 'RECYCLED'; };
function stub(file, args, opts) {
  calls.push({ file, args, env: (opts && opts.env) || {}, opts: opts || {} });
  const script = args[args.length - 1];
  const p = opts && opts.env && opts.env.KOSMOS_RECYCLE_PATH;
  if (script === leftover.DRIVE_SCRIPT) return { ok: true, stdout: driveAnswer() + '\r\n' };
  if (script === leftover.RECYCLE_SCRIPT) return { ok: true, stdout: recycle(p) + '\r\n' };
  return { ok: true, stdout: '' };
}
leftover.setRunner(stub);

function leftoverFolder(name) {
  const dir = create.workerDir(name);
  fs.mkdirSync(nodePath.join(dir, 'notes'), { recursive: true });
  fs.writeFileSync(nodePath.join(dir, 'CLAUDE.md'), 'work\n');
  fs.writeFileSync(nodePath.join(dir, 'notes', '1.md'), 'more\n');
  fs.writeFileSync(nodePath.join(dir, 'notes', '2.md'), 'more\n');
  return dir;
}
const win = {
  plan: (name) => leftover.plan(name, { platform: 'win32' }),
  del: (name, o) => leftover.del(name, { platform: 'win32', ...(o || {}) }),
};
const trashEntries = () => { try { return fs.readdirSync(process.env.AGENT_WORKFORCE_TRASH); } catch { return []; } };

test.beforeEach(() => {
  leftover.setRunner(stub);   // also forgets the cached drive answers
  calls.length = 0;
  drive = 'Fixed';
  bin = {};
  recycle = (p) => { fs.rmSync(p, { recursive: true, force: true }); return 'RECYCLED'; };
  status.setPaneSource(() => '');
  /* Task Scheduler answers "no such task": a folder-only Windows leftover. */
  win32job.setRunner(() => ({ ok: false, out: 'ERROR: The system cannot find the file specified.' }));
});
test.afterEach(() => { status.setPaneSource(null); win32job.setRunner(null); });

test('#7820 on a fixed drive the plan offers the Recycle Bin, in Windows words, with no name to type', () => {
  const dir = leftoverFolder('rb7820a');
  const p = win.plan('rb7820a');
  assert.equal(p.ok, true, p.because);
  assert.equal(p.toTrash, true, 'a folder on a fixed drive was not offered the Recycle Bin');
  assert.equal(p.typeToConfirm, null, 'an undoable delete asked for the name to be typed');
  assert.equal(p.verb, 'Move 3 files to the Recycle Bin');
  assert.match(p.reassurance, /Recycle Bin, where you can get (it|them) back until you empty it/);
  assert.doesNotMatch([p.verb, p.reassurance, p.hint, ...p.loses].join(' '), /Trash/, 'a Windows sentence named the Mac\'s Trash');
  /* 🛑 the path travels in the environment, never in the script or its arguments. */
  const asked = calls.filter((c) => c.args.includes(leftover.DRIVE_SCRIPT));
  assert.ok(asked.length >= 1, 'the drive was never asked about');
  for (const c of asked) {
    assert.equal(c.env.KOSMOS_RECYCLE_PATH, fs.realpathSync.native(dir), 'the drive was asked about a path, not where the folder is');
    assert.equal(c.opts.timeout, 5000, 'the drive probe can hold the board for the default 20 s');
    assert.ok(!c.args.some((a) => a.includes(dir)), 'the folder path was put into the PowerShell command line');
    assert.match(c.file, /powershell\.exe$/);
  }
});

for (const answer of ['Removable', 'Network', 'UNKNOWN', '']) {
  test(`#7820 a drive that answers "${answer}" keeps the honest "deleted for good" sentence (Done when 2)`, () => {
    drive = answer;
    leftoverFolder('rb7820b');
    const p = win.plan('rb7820b');
    assert.equal(p.ok, true, p.because);
    assert.equal(p.toTrash, false, `a "${answer}" drive was promised the Recycle Bin`);
    assert.equal(p.verb, 'Delete 3 files for good');
    assert.match(p.reassurance, /^This cannot be undone: the Recycle Bin cannot take these files, so they will be deleted for good/);
    assert.equal(p.typeToConfirm, 'rb7820b');
    fs.rmSync(create.workerDir('rb7820b'), { recursive: true, force: true });
  });
}

test('#7820 PowerShell that fails outright is "cannot take", not a promise', () => {
  leftoverFolder('rb7820c');
  leftover.setRunner((file, args) => (args.includes(leftover.DRIVE_SCRIPT) ? { ok: false, code: 1, stderr: 'boom' } : { ok: true, stdout: '' }));
  try {
    assert.equal(win.plan('rb7820c').toTrash, false);
  } finally {
    leftover.setRunner(stub);
    fs.rmSync(create.workerDir('rb7820c'), { recursive: true, force: true });
  }
});

test('#7820 a UNC folder is never offered the Recycle Bin, and PowerShell is not even asked', () => {
  assert.equal(leftover.recycleBinCanTake('\\\\server\\share\\workers\\x'), false);
  assert.equal(calls.length, 0, 'PowerShell was asked about a network path');
  // CONTROL: the same call on a drive path does ask, and a Fixed answer is a yes, so the zero above can fail.
  assert.equal(leftover.recycleBinCanTake('E:\\Users\\x\\workers\\x'), true);
  assert.equal(calls.length, 1);
});

test('#7820 the delete sends the folder to the Recycle Bin and says the files are there (Done when 1)', () => {
  const dir = leftoverFolder('rb7820d');
  const real = fs.realpathSync.native(dir);   // before the delete: afterwards there is nothing to resolve
  const done = win.del('rb7820d');
  assert.equal(done.outcome, leftover.OUTCOME.DELETED, done.because);
  assert.equal(done.toTrash, true);
  assert.equal(done.said, 'rb7820d\'s files are in the Recycle Bin. The name is free.');
  assert.equal(fs.existsSync(dir), false);
  const sent = calls.filter((c) => c.args.includes(leftover.RECYCLE_SCRIPT));
  assert.equal(sent.length, 1, 'the folder was not sent through the Recycle Bin call exactly once');
  assert.equal(sent[0].env.KOSMOS_RECYCLE_PATH, real);
  assert.equal(sent[0].opts.timeout, 120000);
  assert.ok(!sent[0].args.some((a) => a.includes(dir)), 'the folder path was put into the PowerShell command line');
  assert.deepEqual(trashEntries().filter((e) => e.startsWith('rb7820d')), [], 'the folder went to a home-made Trash folder on Windows');
});

test('#7820 deleted but NOT found in the Recycle Bin says so, and does not promise it back', () => {
  recycle = (p) => { fs.rmSync(p, { recursive: true, force: true }); return 'GONE'; };
  leftoverFolder('rb7820e');
  const done = win.del('rb7820e');
  assert.equal(done.outcome, leftover.OUTCOME.DELETED, done.because);
  assert.equal(done.toTrash, false, 'the outcome claimed the Recycle Bin for files Windows did not keep');
  assert.equal(done.said, 'rb7820e\'s files are gone from its folder. Kosmos could not find its files in the Recycle Bin afterwards, so Windows may have deleted them for good. The name is free.');
  assert.doesNotMatch(done.said, /are in the Recycle Bin/);
});

test('#7820 a folder still there after the call is a failure, whatever the script said', () => {
  for (const word of ['RECYCLED', 'STILL', 'FAILED Access to the path is denied.']) {
    recycle = () => word;
    const dir = leftoverFolder('rb7820f');
    const done = win.del('rb7820f');
    assert.notEqual(done.outcome, leftover.OUTCOME.DELETED, `"${word}" with the folder still there read as deleted`);
    assert.match(String(done.because), /could not move its folder/);
    assert.doesNotMatch(String(done.said || ''), /The name is free/);
    assert.equal(fs.existsSync(dir), true);
    const step = (done.steps || []).find((s) => s.step === 'its folder');
    assert.ok(step && step.ok === false, 'the folder step was not recorded as failed');
    if (word.startsWith('FAILED ')) assert.equal(step.because, 'Access to the path is denied.');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('#7820 a folder AND its registered startup task (the usual removed Windows agent) still goes to the Recycle Bin', () => {
  const dir = leftoverFolder('rb7820h');
  const tasks = [];
  win32job.setRunner((args) => {
    tasks.push(args.join(' '));
    if (args[0] === '/Query') return { ok: true, out: 'TaskName: Kosmos\\agent-rb7820h\r\nStatus: Disabled\r\n' };
    return { ok: true, out: 'SUCCESS' };
  });
  const p = win.plan('rb7820h');
  assert.equal(p.ok, true, p.because);
  assert.equal(p.job && p.job.task, true, 'the fixture did not register a task, so this test would not test the case');
  assert.equal(p.toTrash, true, 'a folder with a registered task was denied the Recycle Bin');
  assert.equal(p.verb, 'Move 3 files to the Recycle Bin');
  assert.match(p.reassurance, /^Its files go to the Recycle Bin, where you can get them back until you empty it, and its startup job is removed/);
  assert.equal(p.typeToConfirm, null);
  const done = win.del('rb7820h');
  assert.equal(done.outcome, leftover.OUTCOME.DELETED, done.because);
  assert.equal(done.said, 'rb7820h\'s files are in the Recycle Bin. The name is free.');
  assert.equal(fs.existsSync(dir), false);
  assert.ok(tasks.some((c) => c.startsWith('/Delete')), 'the startup task was not unregistered');
});

test('#7820 gone, but the Recycle Bin could not be read: says it could not check, never that the files are lost', () => {
  recycle = (p) => { fs.rmSync(p, { recursive: true, force: true }); return 'UNVERIFIED'; };
  leftoverFolder('rb7820i');
  const done = win.del('rb7820i');
  assert.equal(done.outcome, leftover.OUTCOME.DELETED, done.because);
  assert.equal(done.toTrash, false);
  assert.match(done.said, /could not check that Windows put its files in the Recycle Bin, so look there before you empty it/);
  assert.doesNotMatch(done.said, /deleted them for good/);
});

test('#7820 a later step failing still says the files did not land in the Recycle Bin', (t) => {
  recycle = (p) => { fs.rmSync(p, { recursive: true, force: true }); return 'GONE'; };
  t.mock.method(require('./communitysend'), 'requestRetire', () => { throw new Error('community store locked'); });
  leftoverFolder('rb7820k');
  const done = win.del('rb7820k');
  assert.equal(done.outcome, leftover.OUTCOME.PARTIAL, done.because);
  assert.match(String(done.because), /could not retire its community account yet/, 'the fixture did not reach the partial path');
  assert.match(String(done.because), /Kosmos could not find its files in the Recycle Bin afterwards, so Windows may have deleted them for good\.$/);
});

test('#7820 a move that stops partway says some files may be in the Recycle Bin', () => {
  recycle = () => 'FAILED The process cannot access the file because it is being used by another process.';
  const dir = leftoverFolder('rb7820j');
  const done = win.del('rb7820j');
  assert.match(String(done.because), /Some of its files may already be in the Recycle Bin\.$/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('#7820 the drive answer is asked once per drive, and a new runner is heard', () => {
  assert.equal(leftover.recycleBinCanTake('D:\\Agents\\a'), true);
  assert.equal(leftover.recycleBinCanTake('d:\\Agents\\b'), true);
  assert.equal(calls.filter((c) => c.args.includes(leftover.DRIVE_SCRIPT)).length, 1, 'the same drive was asked twice');
  drive = 'Removable';
  leftover.setRunner(stub);
  assert.equal(leftover.recycleBinCanTake('D:\\Agents\\a'), false, 'a stale cached answer outlived setRunner');
});

test('#7820 a failed drive look is kept a minute, then asked again; a dry run is never kept', (t) => {
  leftover.setRunner((file, args, opts) => { calls.push({ file, args, opts }); return { ok: false, code: 1, stderr: 'boom' }; });
  const now = Date.now();
  t.mock.method(Date, 'now', () => now);
  assert.equal(leftover.recycleBinCanTake('F:\\Agents\\a'), false);
  assert.equal(leftover.recycleBinCanTake('F:\\Agents\\a'), false);
  assert.equal(calls.length, 1, 'a failed look was asked again at once (every agent page would start PowerShell)');
  Date.now.mock.mockImplementation(() => now + 61000);
  assert.equal(leftover.recycleBinCanTake('F:\\Agents\\a'), false);
  assert.equal(calls.length, 2, 'a failed look was kept for good, so a PowerShell that recovers is never heard');
  calls.length = 0;
  leftover.setRunner((file, args, opts) => { calls.push({ file, args, opts }); return { ok: true, stdout: '', dryRun: true }; });
  leftover.recycleBinCanTake('G:\\Agents\\a');
  leftover.recycleBinCanTake('G:\\Agents\\a');
  assert.equal(calls.length, 2, 'a dry-run answer was remembered as the drive\'s real type');
});

test('#7820 a failed delete reads "remove its startup job", never "move" it', () => {
  leftoverFolder('rb7820l');
  win32job.setRunner((args) => {
    if (args[0] === '/Query') return { ok: true, out: 'Status: Disabled\r\n' };
    if (args[0] === '/Delete') return { ok: false, out: 'ERROR: Access is denied.' };
    return { ok: true, out: 'SUCCESS' };
  });
  const done = win.del('rb7820l');
  assert.notEqual(done.outcome, leftover.OUTCOME.DELETED);
  // kosmos#8471: the task that would not go now keeps the folder too, said in the sentence a Linux unit uses.
  assert.match(String(done.because), /Task Scheduler would not remove rb7820l's startup job/, 'the fixture did not make the task removal fail');
  assert.doesNotMatch(String(done.because), /move its startup job/);
});

/* Both scripts parse as PowerShell. Runs wherever pwsh is installed (the fleet's Macs have it); on Windows the board
   runs them under Windows PowerShell 5.1, whose parser this does not prove. */
const PWSH = ['/opt/homebrew/bin/pwsh', '/usr/local/bin/pwsh', '/usr/bin/pwsh'].find((p) => fs.existsSync(p));
test('#7820 the PowerShell scripts parse', { skip: PWSH ? false : 'no pwsh on this machine' }, () => {
  const { execFileSync } = require('node:child_process');
  for (const script of [leftover.DRIVE_SCRIPT, leftover.RECYCLE_SCRIPT]) {
    const out = execFileSync(PWSH, ['-NoProfile', '-NonInteractive', '-Command',
      '$e=$null; [void][System.Management.Automation.Language.Parser]::ParseInput($env:K7820, [ref]$null, [ref]$e); if ($e.Count) { $e | ForEach-Object { $_.Message } } else { "PARSED" }'],
    { encoding: 'utf8', env: { ...process.env, K7820: script }, timeout: 60000 }).trim();
    assert.equal(out, 'PARSED', script);
  }
  // CONTROL: a broken script is reported, so PARSED above can fail.
  const bad = execFileSync(PWSH, ['-NoProfile', '-NonInteractive', '-Command',
    '$e=$null; [void][System.Management.Automation.Language.Parser]::ParseInput($env:K7820, [ref]$null, [ref]$e); if ($e.Count) { "BROKEN" } else { "PARSED" }'],
  { encoding: 'utf8', env: { ...process.env, K7820: 'if ($x { "y" }' }, timeout: 60000 }).trim();
  assert.equal(bad, 'BROKEN');
});

test('#7820 a dry run never promises the Recycle Bin, so it never reaches the move', () => {
  leftover.setRunner((file, args, opts) => { calls.push({ file, args, opts }); return { ok: true, stdout: '', dryRun: true }; });
  leftoverFolder('rb7820m');
  const p = win.plan('rb7820m');
  assert.equal(p.ok, true, p.because);
  assert.equal(p.toTrash, false, 'a dry run, which ran no PowerShell, was taken as a fixed drive');
  assert.equal(calls.filter((c) => c.args.includes(leftover.RECYCLE_SCRIPT)).length, 0);
  fs.rmSync(create.workerDir('rb7820m'), { recursive: true, force: true });
});

test('#7820 a fixed drive set to delete at once, or a policy that turns the Recycle Bin off, keeps "for good" and the typed name', () => {
  for (const setting of [{ nuke: 1 }, { policy: true }, { globalNuke: 1 }]) {
    bin = setting;
    leftover.setRunner(stub);
    leftoverFolder('rb7820n');
    const p = win.plan('rb7820n');
    assert.equal(p.ok, true, p.because);
    assert.equal(p.toTrash, false, `${JSON.stringify(setting)} was promised the Recycle Bin`);
    assert.equal(p.typeToConfirm, 'rb7820n');
    assert.match(p.reassurance, /^This cannot be undone: the Recycle Bin cannot take these files/);
    fs.rmSync(create.workerDir('rb7820n'), { recursive: true, force: true });
  }
});

test('#7820 the folder must fit in the Recycle Bin, with room to spare', () => {
  const info = { type: 'Fixed', total: 1000 * 1024 * 1024, policy: false, nuke: 0, maxMB: 100 };
  const MB = 1024 * 1024;
  assert.equal(leftover.binVerdict(info, { bytes: 89 * MB }), true);
  assert.equal(leftover.binVerdict(info, { bytes: 91 * MB }), false, 'a folder over 90% of the limit was promised the Recycle Bin');
  assert.equal(leftover.binVerdict(info, { bytes: 1, capped: true }), false, 'a folder too big to count was promised the Recycle Bin');
  // No limit recorded for the volume: 5% of the drive stands in (50 MB here).
  const noKey = { ...info, nuke: null, maxMB: null };
  assert.equal(leftover.binVerdict(noKey, { bytes: 44 * MB }), true);
  assert.equal(leftover.binVerdict(noKey, { bytes: 46 * MB }), false);
  assert.equal(leftover.binVerdict({ ...noKey, total: 0 }, { bytes: 1 }), false, 'with no limit and no size known it guessed');
  assert.equal(leftover.binVerdict(null, { bytes: 0 }), false);
  assert.equal(leftover.binVerdict({ ...info, maxMB: 0 }, { bytes: 0 }), false, 'a Recycle Bin with no room was offered an empty folder');
  // The smaller of the volume's limit and the all-drives one decides.
  assert.equal(leftover.binVerdict({ ...info, maxMB: 100, globalMaxMB: 10 }, { bytes: 50 * MB }), false, 'the all-drives limit was ignored');
  assert.equal(leftover.binVerdict({ ...info, maxMB: null, globalMaxMB: 100 }, { bytes: 50 * MB }), true);
  // Through the plan: a folder bigger than the volume's limit keeps "for good".
  bin = { maxMB: 0 };
  leftover.setRunner(stub);
  leftoverFolder('rb7820o');
  assert.equal(win.plan('rb7820o').toTrash, false);
  fs.rmSync(create.workerDir('rb7820o'), { recursive: true, force: true });
});

test('#7820 an answer that is not the probe\'s JSON is a no', () => {
  leftover.setRunner(() => ({ ok: true, stdout: 'Fixed\r\n' }));
  assert.equal(leftover.recycleBinCanTake('J:\\Agents\\a', { bytes: 1 }), false);
});

test('#7820 a test with no runner is refused loudly, not answered "cannot take"', () => {
  leftover.resetForTests();
  try {
    assert.throws(() => leftover.recycleBinCanTake('K:\\Agents\\a', { bytes: 1 }), (e) => e && e.code === 'LIVE_EXECUTION_REFUSED');
  } finally { leftover.setRunner(stub); }
});

test('#7820 a PowerShell that timed out says so in the step, not a bare "still there"', () => {
  const dir = leftoverFolder('rb7820p');
  leftover.setRunner((file, args, opts) => {
    if (args.includes(leftover.DRIVE_SCRIPT)) return stub(file, args, opts);
    return { ok: false, code: null, stderr: 'spawnSync powershell.exe ETIMEDOUT\r\nmore' };
  });
  const done = win.del('rb7820p');
  const step = (done.steps || []).find((x) => x.step === 'its folder');
  assert.ok(step && step.ok === false, 'the folder step was not recorded as failed');
  assert.equal(step.because, 'Windows PowerShell did not finish: spawnSync powershell.exe ETIMEDOUT');
  assert.match(String(done.because), /Some of its files may already be in the Recycle Bin\.$/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('#7820 a delete whose re-plan now asks for the name refuses WITH that plan, so the page can show it', () => {
  leftoverFolder('rb7820q');
  const seen = win.plan('rb7820q');
  assert.equal(seen.typeToConfirm, null, 'the fixture did not start from a Recycle Bin plan');
  drive = 'UNKNOWN';   // the probe now fails, as a minute-old answer that expired could
  leftover.setRunner(stub);
  const done = win.del('rb7820q');
  assert.equal(done.outcome, leftover.OUTCOME.REFUSED);
  assert.match(done.because, /^type rb7820q to confirm; nothing was deleted$/);
  assert.ok(done.plan && done.plan.ok, 'the refusal did not carry the plan the page needs');
  assert.equal(done.plan.typeToConfirm, 'rb7820q');
  assert.equal(done.plan.name, 'rb7820q');
  assert.ok(fs.existsSync(create.workerDir('rb7820q')), 'a refused delete removed the folder');
  fs.rmSync(create.workerDir('rb7820q'), { recursive: true, force: true });
});

test('#7820 the page repaints the dialog from a refusal that carries a plan', () => {
  const html = fs.readFileSync(nodePath.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  const at = html.indexOf("document.getElementById('del-go').addEventListener('click'");
  assert.ok(at > 0, 'the delete button handler moved; this test no longer reads it');
  // The handler alone, by its balanced braces (it holds no brace in a string): an anchor on a line inside it goes -1
  // when that line moves, and slice(at, -1) then reads the rest of the page, where any match passes.
  const from = html.indexOf('async () => {', at);
  let i = html.indexOf('{', from), depth = 0;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}' && --depth === 0) break; }
  assert.ok(i < html.length && i - from < 20000, 'the delete button handler did not close where expected');
  const handler = html.slice(from, i + 1);
  assert.match(handler, /openDeleteModal\(body\.plan\);\s*DEL_RETURN = back;\s*repainted = true;/,
    'a refusal with a plan does not repaint the dialog, so a person shown no name box stays stuck');
  // kosmos#8477 review 2: compared with the plan the dialog shows (onScreen), not DEL_PLAN, which a poll can replace.
  assert.match(handler, /onScreen\.typeToConfirm === body\.plan\.typeToConfirm/, 'a differently spelled name on screen is not repainted');
  assert.match(handler, /\.toLowerCase\(\) === String\(DEL_FOR\)\.toLowerCase\(\)/, 'a name that differs only in case is not repainted');
  assert.match(handler, /if \(!repainted\) go\.disabled = false;/, 'the button can stay off with no box to type in');
});

test('#7820 its settings go to the Recycle Bin with the folder, never to a home-made Trash folder', () => {
  const store = require('./store');
  const dir = leftoverFolder('rb7820r');
  fs.mkdirSync(nodePath.dirname(store.profilePath('rb7820r')), { recursive: true });
  fs.writeFileSync(store.profilePath('rb7820r'), '{}');
  const profile = fs.realpathSync.native(store.profilePath('rb7820r'));
  const p = win.plan('rb7820r');
  assert.equal(p.ok, true, p.because);
  assert.equal(p.records && p.records.files.length, 1, 'the fixture did not leave a settings record, so this test would not test the case');
  assert.equal(p.records.trash, true, 'its settings were not offered the Recycle Bin with the folder');
  assert.match(p.loses.join(' | '), /Its settings: to the Recycle Bin with the files/);
  assert.equal(p.typeToConfirm, null);
  const done = win.del('rb7820r');
  assert.equal(done.outcome, leftover.OUTCOME.DELETED, done.because);
  assert.equal(done.said, 'rb7820r\'s files are in the Recycle Bin. The name is free.');
  const sent = calls.filter((c) => c.args.includes(leftover.RECYCLE_SCRIPT)).map((c) => c.env.KOSMOS_RECYCLE_PATH);
  assert.ok(sent.includes(profile), 'its settings file was not sent through the Recycle Bin call');
  assert.equal(fs.existsSync(store.profilePath('rb7820r')), false);
  assert.equal(fs.existsSync(dir), false);
  assert.deepEqual(trashEntries().filter((e) => e.startsWith('rb7820r')), [], 'something went to a home-made Trash folder on Windows');
});

test('#7820 a settings record the Recycle Bin did not keep is named in the outcome, not blamed on the folder', () => {
  const store = require('./store');
  leftoverFolder('rb7820s');
  fs.mkdirSync(nodePath.dirname(store.profilePath('rb7820s')), { recursive: true });
  fs.writeFileSync(store.profilePath('rb7820s'), '{}');
  const profile = fs.realpathSync.native(store.profilePath('rb7820s'));
  recycle = (q) => { fs.rmSync(q, { recursive: true, force: true }); return q === profile ? 'GONE' : 'RECYCLED'; };
  const done = win.del('rb7820s');
  assert.equal(done.outcome, leftover.OUTCOME.DELETED, done.because);
  assert.equal(done.toTrash, false);
  assert.match(done.said, /Kosmos could not find its settings in the Recycle Bin afterwards, so Windows may have deleted them for good/);
  assert.doesNotMatch(done.said, /could not find its files/, 'the folder, which WAS in the Recycle Bin, was blamed');
  assert.match(done.said, /^rb7820s's files are in the Recycle Bin\. /, 'the folder that did land there was not said to be there');
});

test('#7820 only settings left (no folder, no job): a record the Recycle Bin did not keep is never said to be there', () => {
  const store = require('./store');
  fs.mkdirSync(nodePath.dirname(store.profilePath('rb7820t')), { recursive: true });
  fs.writeFileSync(store.profilePath('rb7820t'), '{}');
  const p = win.plan('rb7820t');
  assert.equal(p.ok, true, p.because);
  assert.equal(p.folder, null, 'the fixture left a folder, so this is not the records-only case');
  assert.equal(p.records.trash, true, 'the fixture did not offer the Recycle Bin');
  for (const [word, says] of [['GONE', /could not find its settings in the Recycle Bin afterwards/], ['UNVERIFIED', /could not check that Windows put its settings in the Recycle Bin/]]) {
    fs.writeFileSync(store.profilePath('rb7820t'), '{}');
    recycle = (q) => { fs.rmSync(q, { force: true }); return word; };
    const done = win.del('rb7820t');
    assert.equal(done.outcome, leftover.OUTCOME.DELETED, done.because);
    assert.doesNotMatch(done.said, /are in the Recycle Bin/, `${word}: the records-only outcome promised the Recycle Bin`);
    assert.match(done.said, says);
  }
  // CONTROL: a record that did land there says so, so the doesNotMatch above can fail.
  fs.writeFileSync(store.profilePath('rb7820t'), '{}');
  recycle = (q) => { fs.rmSync(q, { force: true }); return 'RECYCLED'; };
  assert.equal(win.del('rb7820t').said, 'rb7820t\'s settings are in the Recycle Bin. The name is free.');
});

test('#7820 the Recycle Bin count also matches a file shown without its extension (Explorer hides known ones)', () => {
  assert.match(leftover.RECYCLE_SCRIPT, /\$i\.Name -eq \$leaf -or \(\$isFile -and \$i\.Name -eq \$stem\)/, 'the extension-less name is matched for a folder too');
  assert.match(leftover.RECYCLE_SCRIPT, /\$stem=\[System\.IO\.Path\]::GetFileNameWithoutExtension\(\$p\)/);
  // The original folder is compared with trailing backslashes trimmed on both sides (-eq already ignores case).
  assert.match(leftover.RECYCLE_SCRIPT, /\.TrimEnd\(\[char\]92\) -eq \$dir\.TrimEnd\(\[char\]92\)/);
});

test('#7820 a settings file that is a link sends the LINK to the Recycle Bin, never the file it points at', (t) => {
  const store = require('./store');
  leftoverFolder('rb7820u');
  const outside = nodePath.join(SANDBOX, 'not-kosmos-data.json');
  fs.writeFileSync(outside, 'someone else\'s file');
  fs.mkdirSync(nodePath.dirname(store.profilePath('rb7820u')), { recursive: true });
  try { fs.symlinkSync(outside, store.profilePath('rb7820u')); } catch (e) {
    if (e && e.code === 'EPERM') { t.skip('this host does not let a test make a link (Windows without the privilege)'); fs.rmSync(create.workerDir('rb7820u'), { recursive: true, force: true }); return; }
    throw e;
  }
  const link = nodePath.join(fs.realpathSync.native(nodePath.dirname(store.profilePath('rb7820u'))), nodePath.basename(store.profilePath('rb7820u')));
  recycle = (q) => { fs.rmSync(q, { force: true, recursive: true }); return 'RECYCLED'; };   // rmSync on a link removes the link
  const done = win.del('rb7820u');
  assert.equal(done.outcome, leftover.OUTCOME.DELETED, done.because);
  const sent = calls.filter((c) => c.args.includes(leftover.RECYCLE_SCRIPT)).map((c) => c.env.KOSMOS_RECYCLE_PATH);
  assert.ok(sent.includes(link), 'the link itself was not what went to the Recycle Bin: ' + JSON.stringify(sent));
  assert.ok(!sent.includes(fs.realpathSync.native(outside)), 'the file the link points at, outside Kosmos, was sent to the Recycle Bin');
  assert.equal(fs.readFileSync(outside, 'utf8'), 'someone else\'s file', 'the file the link points at was touched');
});

test('#7820 neither PowerShell script contains a double quote (they cross the Windows command line)', () => {
  for (const [name, script] of [['DRIVE_SCRIPT', leftover.DRIVE_SCRIPT], ['RECYCLE_SCRIPT', leftover.RECYCLE_SCRIPT]]) {
    assert.equal(script.includes('"'), false, `${name} holds a double quote, which Windows' command-line quoting can strip`);
    assert.ok(script.length > 100, `${name} is empty, so the check above could not fail`);
  }
});

test('#7820 a failed token revoke beside a stuck folder reads "revoke", never "move"', (t) => {
  recycle = () => 'FAILED Access to the path is denied.';
  const dir = leftoverFolder('rb7820v');
  t.mock.method(require('./sendertoken'), 'revoke', () => ({ ok: false, because: 'token store locked' }));
  const done = win.del('rb7820v');
  assert.match(String(done.because), /we could not move its folder or revoke its sender tokens/, 'the fixture did not make both steps fail');
  assert.doesNotMatch(String(done.because), /move its sender tokens/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('#7820 a startup task plus settings, no folder: the settings are never promised the Recycle Bin', () => {
  /* So the outcome can never stand over a record that was promised the Recycle Bin and not kept: a task is removed, not
     moved, so with no folder nothing goes to the Recycle Bin. kosmos#8475: the settings are not touched at all (the task
     goes alone, nothing is lost for good, so no name is asked); they are a settings-only leftover afterwards. */
  const store = require('./store');
  fs.mkdirSync(nodePath.dirname(store.profilePath('rb7820w')), { recursive: true });
  fs.writeFileSync(store.profilePath('rb7820w'), '{}');
  win32job.setRunner((args) => (args[0] === '/Query' ? { ok: true, out: 'Status: Disabled\r\n' } : { ok: true, out: 'SUCCESS' }));
  const p = win.plan('rb7820w');
  assert.equal(p.ok, true, p.because);
  // kosmos#8475: records.files is what the delete moves, and a task with no folder moves nothing.
  assert.ok(p.job && p.job.task && !p.folder && p.records.files.length === 0 && fs.existsSync(store.profilePath('rb7820w')), 'the fixture is not a task plus settings with no folder');
  assert.equal(p.records.trash, false, 'settings beside a task-only leftover were promised the Recycle Bin');
  assert.equal(p.typeToConfirm, null);
  const done = win.del('rb7820w');
  assert.equal(done.outcome, leftover.OUTCOME.DELETED, done.because);
  assert.equal(calls.filter((c) => c.args.includes(leftover.RECYCLE_SCRIPT)).length, 0, 'something was sent to the Recycle Bin');
  assert.equal(fs.existsSync(store.profilePath('rb7820w')), true, 'the settings went with the task (kosmos#8475)');
});

test('#7820 CONTROL: the Mac still says the Trash and never asks PowerShell', () => {
  fs.mkdirSync(process.env.AGENT_WORKFORCE_TRASH, { recursive: true });
  leftoverFolder('rb7820g');
  const p = leftover.plan('rb7820g', { platform: 'darwin' });
  assert.equal(p.ok, true, p.because);
  assert.equal(p.verb, 'Move 3 files to the Trash');
  assert.doesNotMatch(p.reassurance, /Recycle Bin/);
  assert.equal(calls.filter((c) => /powershell/i.test(c.file)).length, 0, 'the Mac arm spawned PowerShell');
  const done = leftover.del('rb7820g', { platform: 'darwin' });
  assert.equal(done.said, 'rb7820g\'s files are in the Trash. The name is free.');
});
